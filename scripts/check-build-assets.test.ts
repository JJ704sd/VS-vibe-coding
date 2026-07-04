import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCheck, inspectPath } from './check-build-assets.js';

/**
 * Build a fake `dist/` tree under a unique tmp dir. Returns the root.
 * @param {Record<string, string | { type: 'dir' }>} layout
 * @returns {string}
 */
function makeFakeDist(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecg-check-assets-'));
  for (const [rel, value] of Object.entries(layout)) {
    const full = path.join(root, rel);
    if (typeof value === 'string') {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, value);
    } else if (value && value.type === 'dir') {
      fs.mkdirSync(full, { recursive: true });
    }
  }
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('runCheck passes on a complete dist/ tree', () => {
  const root = makeFakeDist({
    'index.html': '<html></html>',
    'models': { type: 'dir' },
    'models/ecg-classifier': { type: 'dir' },
    'models/ecg-classifier/model.json': '{"modelTopology":{}}',
  });

  try {
    const summary = runCheck({ root });
    assert.equal(summary.failures, 0, JSON.stringify(summary.results, null, 2));
    assert.equal(summary.warnings, 0);
    const indexResult = summary.results.find((r) => r.label === 'dist/index.html');
    assert.equal(indexResult.status, 'ok');
    const modelResult = summary.results.find((r) => r.label === 'dist/models/ecg-classifier/model.json');
    assert.equal(modelResult.status, 'ok');
  } finally {
    cleanup(root);
  }
});

test('runCheck warns (does not fail) when model.json is missing in non-strict mode', () => {
  // Reproduces the historical regression: webpack never copied public/
  // into dist/, so the only thing missing is model.json. The build is
  // still considered "ok" because the UI falls back to mock inference.
  const root = makeFakeDist({
    'index.html': '<html></html>',
    'models': { type: 'dir' },
    'models/ecg-classifier': { type: 'dir' },
  });

  try {
    const summary = runCheck({ root, strict: false });
    assert.equal(summary.failures, 0);
    assert.equal(summary.warnings, 1);
    const modelResult = summary.results.find((r) => r.label === 'dist/models/ecg-classifier/model.json');
    assert.equal(modelResult.status, 'warn');
  } finally {
    cleanup(root);
  }
});

test('runCheck fails when model.json is missing in --strict mode', () => {
  const root = makeFakeDist({
    'index.html': '<html></html>',
    'models': { type: 'dir' },
    'models/ecg-classifier': { type: 'dir' },
  });

  try {
    const summary = runCheck({ root, strict: true });
    assert.equal(summary.failures, 1);
    const modelResult = summary.results.find((r) => r.label === 'dist/models/ecg-classifier/model.json');
    assert.equal(modelResult.status, 'fail');
  } finally {
    cleanup(root);
  }
});

test('runCheck fails when dist/models/ is missing entirely (CopyWebpackPlugin skipped)', () => {
  // This is the exact failure mode the script exists to catch.
  const root = makeFakeDist({
    'index.html': '<html></html>',
  });

  try {
    const summary = runCheck({ root });
    assert.ok(summary.failures >= 2, `expected at least 2 failures, got ${summary.failures}`);
    const modelsRoot = summary.results.find((r) => r.label === 'dist/models/');
    assert.equal(modelsRoot.status, 'fail');
    const modelDir = summary.results.find((r) => r.label === 'dist/models/ecg-classifier/');
    assert.equal(modelDir.status, 'fail');
  } finally {
    cleanup(root);
  }
});

test('runCheck fails when dist/ itself is missing', () => {
  // Use a non-existent path; do NOT mkdtempSync because that would
  // create an empty directory and `inspectPath` only checks existence,
  // not non-emptiness.
  const root = path.join(os.tmpdir(), `ecg-check-assets-nonexistent-${Date.now()}-${Math.random()}`);
  assert.equal(fs.existsSync(root), false, 'precondition: tmp path should not exist');

  const summary = runCheck({ root });
  assert.ok(summary.failures >= 1);
  const distRoot = summary.results.find((r) => r.label === 'dist/');
  assert.equal(distRoot.status, 'fail');
});

test('inspectPath treats a soft-spec missing file as a warning (not a failure)', () => {
  const root = makeFakeDist({
    'index.html': '<html></html>',
    'models': { type: 'dir' },
    'models/ecg-classifier': { type: 'dir' },
  });

  try {
    const result = inspectPath(
      { label: 'model.json', required: false, soft: true },
      path.join(root, 'models', 'ecg-classifier', 'model.json')
    );
    assert.equal(result.status, 'warn');
  } finally {
    cleanup(root);
  }
});

test('inspectPath reports directory entry counts in the detail line', () => {
  const root = makeFakeDist({
    'models/ecg-classifier': { type: 'dir' },
    'models/ecg-classifier/weights.bin': 'x',
  });

  try {
    const result = inspectPath(
      { label: 'dir', required: true },
      path.join(root, 'models', 'ecg-classifier')
    );
    assert.equal(result.status, 'ok');
    assert.match(result.detail, /1 项/);
  } finally {
    cleanup(root);
  }
});