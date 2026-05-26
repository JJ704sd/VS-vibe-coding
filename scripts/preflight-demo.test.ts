import assert from 'node:assert/strict';
import test from 'node:test';
import preflightDemo from './preflight-demo.js';

const {
  buildProcessSearchCommand,
  formatExecFileError,
  isPermissionDenied,
  parseListeningPids,
  parseProcessIds,
} = preflightDemo;

test('parseListeningPids returns distinct PIDs for a target port', () => {
  const output = [
    '  TCP    0.0.0.0:4000           0.0.0.0:0              LISTENING       1234',
    '  TCP    [::]:4000              [::]:0                 LISTENING       1234',
    '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       5678',
  ].join('\n');

  assert.deepEqual(parseListeningPids(output, 4000), ['1234']);
});

test('parseProcessIds ignores empty and nonnumeric lines', () => {
  assert.deepEqual(parseProcessIds('1234\r\n\r\nnot-a-pid\r\n5678'), ['1234', '5678']);
});

test('buildProcessSearchCommand does not put semicolons after pipes', () => {
  const command = buildProcessSearchCommand('finetune_runner.py');
  assert.equal(command.includes('|;'), false);
  assert.equal(command.includes("finetune_runner.py"), true);
});

test('isPermissionDenied detects blocked system process inspection', () => {
  assert.equal(isPermissionDenied('spawn EPERM'), true);
  assert.equal(isPermissionDenied('Access is denied'), true);
  assert.equal(isPermissionDenied('process is not running'), false);
});

test('formatExecFileError includes stderr access-denied details', () => {
  const message = formatExecFileError({
    message: 'Command failed: powershell.exe -NoProfile -Command ...',
    stderr: 'Get-CimInstance : 拒绝访问',
  });

  assert.equal(isPermissionDenied(message), true);
});
