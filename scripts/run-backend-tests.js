const { mkdirSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const rootDir = join(__dirname, '..');
const proxyDir = join(rootDir, 'proxy-server');
const runId = `${process.pid}-${Date.now()}`;
const testTempRoot = join(rootDir, '.pytest-tmp', runId);
const baseTemp = join(testTempRoot, 'basetemp');
const cacheDir = join(testTempRoot, 'cache');

mkdirSync(baseTemp, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

const result = spawnSync(
  'python',
  ['-m', 'pytest', 'tests', '--basetemp', baseTemp, '-o', `cache_dir=${cacheDir}`],
  {
    cwd: proxyDir,
    stdio: 'inherit',
    shell: false,
  }
);

process.exit(result.status ?? 1);
