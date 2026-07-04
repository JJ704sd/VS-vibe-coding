/**
 * Post-build resource-existence check.
 *
 * After `npm run build` writes the production bundle to `./dist/`, this
 * script verifies the artefacts that the GitHub Pages deploy actually
 * serves. Designed to catch silent regressions like the historical
 * "dist/models/ is missing because webpack never copied public/" bug.
 *
 * Checks (in order):
 *   1. dist/ exists and is a directory        — hard fail
 *   2. dist/index.html exists                 — hard fail
 *   3. dist/models/ exists                    — hard fail (CopyWebpackPlugin ran)
 *   4. dist/models/ecg-classifier/ exists     — hard fail
 *   5. dist/models/ecg-classifier/model.json  — soft warn (mock fallback is
 *                                                the documented default state;
 *                                                pass `--strict` to require it)
 *
 * Exit codes:
 *   0  — every check passed (or only soft warnings)
 *   1  — at least one hard check failed (build is broken)
 *
 * Pure CommonJS, no external deps, runs on Node 22+.
 */

const fs = require('node:fs');
const path = require('node:path');

const DIST_ROOT = path.resolve(__dirname, '..', 'dist');
const MODEL_DIR = path.join(DIST_ROOT, 'models', 'ecg-classifier');
const MODEL_JSON = path.join(MODEL_DIR, 'model.json');

/**
 * Decide the severity of a missing path. Returns one of:
 *   'ok'      — not required, just informational
 *   'warn'    — required for "real model" mode but currently expected to be absent
 *   'fail'    — build is broken without this
 * @param {{label: string, required: boolean, soft?: boolean}} spec
 * @param {string} fullPath
 * @returns {{status: 'ok'|'warn'|'fail', detail: string}}
 */
function inspectPath(spec, fullPath) {
  const exists = fs.existsSync(fullPath);
  if (exists) {
    let detail = fullPath;
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(fullPath);
        detail = `${fullPath} (${entries.length} 项)`;
      } else {
        detail = `${fullPath} (${stat.size} 字节)`;
      }
    } catch {
      // best-effort detail
    }
    return { status: 'ok', detail };
  }

  if (spec.soft) {
    return {
      status: 'warn',
      detail: `${fullPath} 缺失（已预期，UI 会 fallback 到 mock 推理）`,
    };
  }
  if (!spec.required) {
    return { status: 'ok', detail: `${fullPath} 不存在（可选项）` };
  }
  return { status: 'fail', detail: `${fullPath} 缺失` };
}

/**
 * Run the full check suite. Pure function so the unit test can drive it
 * without spawning a child process.
 * @param {{root?: string, strict?: boolean}} [opts]
 * @returns {{failures: number, warnings: number, results: Array<{label: string, status: string, detail: string}>}}
 */
function runCheck(opts = {}) {
  const root = opts.root ?? DIST_ROOT;
  const strict = Boolean(opts.strict);
  const modelJsonPath = path.join(root, 'models', 'ecg-classifier', 'model.json');
  const modelDir = path.join(root, 'models', 'ecg-classifier');
  const modelsRoot = path.join(root, 'models');
  const indexHtml = path.join(root, 'index.html');

  const specs = [
    { label: 'dist/', required: true },
    { label: 'dist/index.html', required: true },
    { label: 'dist/models/', required: true },
    { label: 'dist/models/ecg-classifier/', required: true },
    {
      label: 'dist/models/ecg-classifier/model.json',
      // Soft warning by default: the committed repo intentionally has no
      // real model. `--strict` flips it to a hard failure so future
      // deployments that DO ship a model cannot regress silently.
      required: strict,
      soft: !strict,
    },
  ];

  const pathLookup = {
    'dist/': root,
    'dist/index.html': indexHtml,
    'dist/models/': modelsRoot,
    'dist/models/ecg-classifier/': modelDir,
    'dist/models/ecg-classifier/model.json': modelJsonPath,
  };

  const results = specs.map((spec) => {
    const inspected = inspectPath(spec, pathLookup[spec.label]);
    return { label: spec.label, status: inspected.status, detail: inspected.detail };
  });

  const failures = results.filter((r) => r.status === 'fail').length;
  const warnings = results.filter((r) => r.status === 'warn').length;

  return { failures, warnings, results };
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function printResults({ failures, warnings, results }) {
  console.log('构建后资源存在性检查');
  console.log('------------------');
  for (const result of results) {
    const tag = result.status === 'ok' ? 'OK' : result.status === 'warn' ? 'WARN' : 'FAIL';
    console.log(`${pad(tag, 5)}${pad(result.label, 38)}${result.detail}`);
  }
  console.log('------------------');
  console.log(`failures=${failures}  warnings=${warnings}`);
  if (failures > 0) {
    console.log('构建产物不完整，请先跑 `npm run build`，再确认 CopyWebpackPlugin 配置。');
  } else if (warnings > 0) {
    console.log('构建产物可用，但部分可选资源缺失（详见 WARN）。');
  } else {
    console.log('构建产物完整。');
  }
}

function printHelp() {
  console.log([
    '用法: npm run check:assets [-- --strict]',
    '',
    '检查 dist/ 下构建产物的关键资源是否存在。',
    '',
    '选项:',
    '  --strict   把 model.json 视为必选（CI 在接入真实模型后启用）',
    '  --help     显示本帮助',
    '',
    '退出码: 0 = 通过, 1 = 关键资源缺失',
  ].join('\n'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const strict = args.includes('--strict');
  try {
    const summary = runCheck({ strict });
    printResults(summary);
    process.exitCode = summary.failures > 0 ? 1 : 0;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

module.exports = { runCheck, inspectPath, DIST_ROOT, MODEL_DIR, MODEL_JSON };