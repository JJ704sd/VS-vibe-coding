const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const CHECKS = [
  { name: '前端', port: 3000, url: 'http://localhost:3000/' },
  { name: '模拟接口', port: 4000, url: 'http://localhost:4000/api/health' },
  { name: 'Sidecar', port: 6090, url: 'http://localhost:6090/health' },
];

function parseListeningPids(output, port) {
  const target = `:${port}`;
  const pids = new Set();
  for (const rawLine of String(output).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.includes(target) || !/\bLISTENING\b/i.test(line)) continue;
    const parts = line.split(/\s+/);
    const pid = parts.at(-1);
    if (/^\d+$/.test(pid || '')) pids.add(pid);
  }
  return [...pids].sort((a, b) => Number(a) - Number(b));
}

function parseProcessIds(output) {
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

function isPermissionDenied(message) {
  return /eperm|access is denied|拒绝访问/i.test(String(message));
}

function formatExecFileError(error) {
  return [error?.message, error?.stdout, error?.stderr].filter(Boolean).join('\n');
}

async function checkHttp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: response.status >= 200 && response.status < 500, status: response.status };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getListeningPids(port) {
  if (process.platform !== 'win32') {
    return { pids: [], error: 'port listener scan is only implemented for Windows' };
  }
  try {
    const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true });
    return { pids: parseListeningPids(stdout, port), error: null };
  } catch (error) {
    return { pids: [], error: formatExecFileError(error) };
  }
}

function buildProcessSearchCommand(scriptName) {
  const escaped = scriptName.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop';",
    `$pattern = '${escaped}';`,
    'Get-CimInstance Win32_Process |',
    'Where-Object { $_.CommandLine -and $_.CommandLine.Contains($pattern) } |',
    'ForEach-Object { $_.ProcessId }',
  ].join(' ');
}

async function findProcessIds(scriptName) {
  if (process.platform !== 'win32') return { pids: [], error: 'process scan is only implemented for Windows' };
  const command = buildProcessSearchCommand(scriptName);

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
      windowsHide: true,
      timeout: 5000,
    });
    return { pids: parseProcessIds(stdout), error: null };
  } catch (error) {
    return { pids: [], error: formatExecFileError(error) };
  }
}

function printResult(status, label, detail) {
  console.log(`${status.padEnd(5)} ${label.padEnd(18)} ${detail}`);
}

async function runPreflight({ live = false } = {}) {
  let failures = 0;

  console.log('ECG 演示预检');
  console.log('------------');

  for (const check of CHECKS) {
    const [http, portScan] = await Promise.all([checkHttp(check.url), getListeningPids(check.port)]);
    const pids = portScan.pids;
    if (!http.ok) {
      failures += 1;
      printResult('FAIL', check.name, `${check.url} 不可访问${http.error ? ` (${http.error})` : ''}`);
    } else {
      printResult('OK', check.name, `${check.url} 返回 ${http.status}`);
    }

    if (portScan.error) {
      printResult('WARN', `${check.name}:端口`, `无法检查端口 ${check.port}: ${portScan.error}`);
    } else if (pids.length > 1) {
      failures += 1;
      printResult('FAIL', `${check.name}:端口`, `端口 ${check.port} 有多个监听进程: ${pids.join(', ')}`);
    } else if (pids.length === 1) {
      printResult('OK', `${check.name}:端口`, `端口 ${check.port} 监听 PID ${pids[0]}`);
    } else {
      printResult('WARN', `${check.name}:端口`, `未找到端口 ${check.port} 的 LISTENING 记录`);
    }
  }

  const processes = [
    { label: '训练调度器', script: 'finetune_runner.py' },
    { label: '参数观察器', script: 'param_observer.py' },
  ];
  for (const processCheck of processes) {
    const result = await findProcessIds(processCheck.script);
    if (result.pids.length > 0) {
      printResult('OK', processCheck.label, `PID ${result.pids.join(', ')}`);
    } else if (result.error && isPermissionDenied(result.error)) {
      printResult('WARN', processCheck.label, `无法检查进程列表: ${result.error}`);
    } else if (live) {
      failures += 1;
      printResult('FAIL', processCheck.label, result.error || `${processCheck.script} 未运行`);
    } else {
      printResult('WARN', processCheck.label, result.error || `${processCheck.script} 未运行；仅实时训练需要`);
    }
  }

  return failures;
}

function printHelp() {
  console.log([
    '用法: npm run preflight:demo -- [--live]',
    '',
    '检查项:',
    '  前端      http://localhost:3000/',
    '  模拟接口  http://localhost:4000/api/health',
    '  Sidecar   http://localhost:6090/health',
    '  端口 3000、4000、6090 是否重复监听',
    '  finetune_runner.py 和 param_observer.py 是否存在',
    '',
    '选项:',
    '  --live    要求训练调度器和参数观察器必须运行',
  ].join('\n'));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  runPreflight({ live: args.includes('--live') })
    .then((failures) => {
      process.exitCode = failures > 0 ? 1 : 0;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  buildProcessSearchCommand,
  formatExecFileError,
  isPermissionDenied,
  parseListeningPids,
  parseProcessIds,
  runPreflight,
};
