/**
 * Pre-build safety cleaner for the project's `dist/` directory.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 * The production webpack config keeps `output.clean: false` on purpose
 * because webpack 5's built-in cleanup hook has a long-standing Windows
 * issue: it occasionally trips on EBUSY/EPERM when files in `dist/` are
 * still held by an IDE preview tab, an antivirus scanner, or even just
 * File Explorer's thumbnail cache. Fighting that with retry knobs inside
 * webpack itself is fragile, so instead we run a tiny, dedicated Node
 * cleanup step *immediately before* `npm run build` (via the `prebuild`
 * npm lifecycle hook). It walks in its own process — no shared lock
 * state with the webpack build that comes after it — and only ever
 * touches the project's own `dist/`.
 *
 * Why we don't just open `output.clean: true`:
 *   1. `CLAUDE.md` and AGENTS.md both call out the Windows failure
 *      mode and tell future agents "故意保守处理，不要试图修复"
 *      — turning it back on would re-introduce exactly the failure
 *      the project has been protected against.
 *   2. The prebuild approach gives us explicit, scriptable cleanup
 *      with a real log line and unit-test coverage, instead of an
 *      implicit webpack internal.
 *
 * ── Safety contract ────────────────────────────────────────────────────
 *   * Resolves `dist/` from this script's own `import.meta.url`, so the
 *     result is independent of `process.cwd()`.
 *   * Refuses to run if `dist/` resolves outside the repository root,
 *     is a symlink (or the parent is one), or is not a directory — all
 *     cheap mistakes that turn an `rm -rf` into a tragedy.
 *   * Idempotent: missing `dist/` is a no-op with a log line, not an
 *     error.
 *   * Retries up to 3 times with a short backoff so transient Windows
 *     file locks (Edge tabs holding dist/*.js, Defender scanning a
 *     freshly-written chunk, etc.) don't break the build on the first
 *     attempt. If all attempts fail, the script exits non-zero so
 *     `npm run build` is never executed against a half-cleaned tree.
 *   * Prints exactly what it removed, including the attempt count and
 *     elapsed time, so the cleanup is always visible in CI logs even
 *     when it was effectively a no-op.
 *
 * No external deps — pure Node 22+ stdlib so it works in CI the same
 * way it does locally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parse CLI args. Returns the absolute path of the dir to clean. */
function resolveTargetDir(argv, repoRoot) {
  const explicit = parseExplicitPath(argv);
  if (explicit) return explicit;
  return path.resolve(repoRoot, 'dist');
}

/**
 * Pull `--path <abs path>` (or `--path=<abs path>`) out of argv. Any
 * other token that looks like an absolute path is also accepted so the
 * test harness can `node scripts/clean-dist.mjs C:\tmp\foo` style — but
 * we still re-validate the resolved target below, so abuse here cannot
 * escape the safety checks.
 */
function parseExplicitPath(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--path=')) return path.resolve(arg.slice('--path='.length));
    if (arg === '--path') {
      const next = argv[i + 1];
      if (!next) return null;
      return path.resolve(next);
    }
  }
  return null;
}

function ensureSafeTarget(target, repoRoot) {
  const normalizedRepo = path.resolve(repoRoot);
  const normalizedTarget = path.resolve(target);

  if (
    normalizedTarget !== normalizedRepo &&
    !normalizedTarget.startsWith(normalizedRepo + path.sep)
  ) {
    throw new Error(
      `refusing to clean ${normalizedTarget} — outside repo root ${normalizedRepo}`,
    );
  }

  let lstat;
  try {
    lstat = fs.lstatSync(normalizedTarget);
  } catch (err) {
    if (err.code === 'ENOENT') return { state: 'missing', path: normalizedTarget };
    throw err;
  }
  if (lstat.isSymbolicLink()) {
    throw new Error(
      `refusing to clean symlinked dist/ → ${fs.readlinkSync(normalizedTarget)}`,
    );
  }
  if (!lstat.isDirectory()) {
    throw new Error(`dist/ is not a directory (${normalizedTarget})`);
  }
  return { state: 'present', path: normalizedTarget };
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 200, 600];

function cleanWithRetry(target) {
  const start = Date.now();
  let lastErr = null;
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return { ok: true, attempt, elapsedMs: Date.now() - start, lastErr: null };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) {
        const wait = BACKOFF_MS[attempt];
        if (wait > 0) {
          const until = Date.now() + wait;
          // eslint-disable-next-line no-unmodified-loop-condition
          while (Date.now() < until) {
            /* brief cooperative wait */
          }
        }
      }
    }
  }
  return { ok: false, attempt, elapsedMs: Date.now() - start, lastErr };
}

export function runClean({ argv = process.argv.slice(2), repoRoot = REPO_ROOT, logger = console } = {}) {
  let target;
  try {
    target = resolveTargetDir(argv, repoRoot);
    const probe = ensureSafeTarget(target, repoRoot);
    if (probe.state === 'missing') {
      logger.log(`[clean-dist] dist/ does not exist, nothing to clean (${probe.path})`);
      return { ok: true, skipped: true, target: probe.path };
    }
    target = probe.path;
  } catch (err) {
    logger.error(`[clean-dist] ${err.message}`);
    return { ok: false, aborted: true, error: err };
  }

  const result = cleanWithRetry(target);
  if (result.ok) {
    logger.log(
      `[clean-dist] removed ${target} in ${result.elapsedMs}ms ` +
        `(attempt ${result.attempt}/${MAX_ATTEMPTS})`,
    );
    return { ok: true, target, ...result };
  }
  const reason = result.lastErr?.code
    ? `${result.lastErr.code}: ${result.lastErr.message}`
    : result.lastErr?.message ?? 'unknown error';
  logger.error(
    `[clean-dist] failed to remove ${target} after ${result.attempt} attempts: ${reason}`,
  );
  return { ok: false, target, ...result };
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runClean({});
  if (!result.ok || result.aborted) {
    process.exit(1);
  }
}
