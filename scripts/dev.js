const { spawn } = require('child_process');

const npmCmd = 'npm';

const api = spawn(npmCmd, ['run', 'dev:api'], {
  stdio: 'inherit',
  shell: true,
});

const web = spawn(npmCmd, ['run', 'dev:web'], {
  stdio: 'inherit',
  shell: true,
});

const shutdown = () => {
  if (!api.killed) {
    api.kill();
  }
  if (!web.killed) {
    web.kill();
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

api.on('exit', (code) => {
  if (code && code !== 0) {
    web.kill();
    process.exitCode = code;
  }
});

web.on('exit', (code) => {
  if (code && code !== 0) {
    api.kill();
    process.exitCode = code;
  }
});
