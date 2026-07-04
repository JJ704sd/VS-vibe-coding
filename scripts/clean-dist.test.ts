/**
 * Tests for scripts/clean-dist.mjs.
 *
 * Each test forks a Node child pointed at a fresh tmp dir so we can
 * drive the script's real CLI entry point without ever touching the
 * repo's actual dist/ tree.
 *
 * Run with the project's test:unit runner, e.g.:
 *   npm run test:unit -- --test-name-pattern=clean-dist
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'clean-dist.mjs');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clean-dist-test-'));
}

function runScript(cwd, extraArgs = []) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...extraArgs], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString?.() ?? '',
      stderr: err.stderr?.toString?.() ?? err.message,
    };
  }
}

test('clean-dist: no-op when target dir does not exist', () => {
  // Use a sub-directory inside repoRoot so it passes the
  // "must be inside the repo root" safety check.
  const tmp = path.join(repoRoot, `.clean-dist-test-noop-${process.pid}-${Date.now()}`);
  try {
    const dist = path.join(tmp, 'dist'); // intentionally not created
    const res = runScript(repoRoot, ['--path', dist]);
    assert.equal(res.code, 0, `unexpected non-zero exit: ${res.stderr}`);
    assert.match(res.stdout, /nothing to clean/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clean-dist: removes only files inside dist/, leaves siblings alone', () => {
  const tmp = path.join(repoRoot, `.clean-dist-test-happy-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const dist = path.join(tmp, 'dist');
    fs.mkdirSync(path.join(dist, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'a.js'), 'a');
    fs.writeFileSync(path.join(dist, 'sub', 'b.js'), 'b');
    fs.writeFileSync(path.join(tmp, 'keep.txt'), 'keep');

    const res = runScript(repoRoot, ['--path', dist]);
    assert.equal(res.code, 0, `unexpected non-zero exit: ${res.stderr}`);
    assert.match(res.stdout, new RegExp(`removed ${dist.replace(/\\/g, '\\\\')}`));

    assert.equal(fs.existsSync(dist), false, 'dist/ should be removed');
    assert.equal(
      fs.readFileSync(path.join(tmp, 'keep.txt'), 'utf8'),
      'keep',
      'sibling file outside dist/ should survive',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clean-dist: refuses when target is outside the repo root', () => {
  // tmp is *outside* repoRoot, so passing an absolute path that's not
  // underneath repoRoot must be rejected with non-zero exit.
  const tmp = makeTmp();
  try {
    const res = runScript(repoRoot, ['--path', tmp]);
    assert.notEqual(res.code, 0, 'must refuse out-of-repo target');
    assert.match(
      res.stderr + res.stdout,
      /outside repo root|refusing/i,
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clean-dist: refuses symlinked dist/ (POSIX only)', { skip: process.platform === 'win32' }, () => {
  const tmp = path.join(repoRoot, `.clean-dist-test-symlink-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const real = path.join(tmp, 'real');
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, 'x.txt'), 'x');
    const link = path.join(tmp, 'dist');
    fs.symlinkSync(real, link, 'dir');

    const res = runScript(repoRoot, ['--path', link]);
    assert.notEqual(res.code, 0, 'must refuse symlinked target');
    assert.match(res.stderr + res.stdout, /symlink|refusing/i);
    // real/ contents should still be intact
    assert.equal(fs.readFileSync(path.join(real, 'x.txt'), 'utf8'), 'x');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('clean-dist: errors (non-zero) when target path is a regular file, not a dir', () => {
  const tmp = path.join(repoRoot, `.clean-dist-test-file-${process.pid}-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const victim = path.join(tmp, 'not-a-dir.txt');
    fs.writeFileSync(victim, 'x');
    const res = runScript(repoRoot, ['--path', victim]);
    assert.notEqual(res.code, 0);
    assert.match(res.stderr + res.stdout, /not a directory|refusing/i);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'x');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
