import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveLayerStatRows } from './paramStatsViewModel.ts';

test('buildLiveLayerStatRows omits gradient rows when checkpoint stats have no gradients', () => {
  const rows = buildLiveLayerStatRows({
    name: 'encoder.block.weight',
    shape: [2, 2],
    mean: 0.12,
    std: 0.34,
    min: -0.5,
    max: 0.8,
  });

  assert.deepEqual(rows, [
    { label: 'Mean', value: '0.120000' },
    { label: 'Std', value: '0.340000' },
    { label: 'Min', value: '-0.500000' },
    { label: 'Max', value: '0.800000' },
  ]);
});

test('buildLiveLayerStatRows includes gradient rows when observer provides them', () => {
  const rows = buildLiveLayerStatRows({
    name: 'encoder.block.weight',
    shape: [2, 2],
    mean: 0.12,
    std: 0.34,
    min: -0.5,
    max: 0.8,
    grad_mean: 0.01,
    grad_std: 0.02,
  });

  assert.equal(rows.at(-2)?.label, 'Grad Mean');
  assert.equal(rows.at(-2)?.value, '0.010000');
  assert.equal(rows.at(-1)?.label, 'Grad Std');
  assert.equal(rows.at(-1)?.value, '0.020000');
});

test('buildLiveLayerStatRows emits only Grad Mean when grad_std is absent', () => {
  const rows = buildLiveLayerStatRows({
    name: 'encoder.block.weight',
    shape: [2, 2],
    mean: 0,
    std: 0,
    min: 0,
    max: 0,
    grad_mean: 0.5,
  });

  // 4 base rows + 1 grad mean, no grad std
  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1)?.label, 'Grad Mean');
  assert.equal(rows.at(-1)?.value, '0.500000');
  assert.equal(
    rows.find((r) => r.label === 'Grad Std'),
    undefined
  );
});

test('buildLiveLayerStatRows emits only Grad Std when grad_mean is absent', () => {
  const rows = buildLiveLayerStatRows({
    name: 'encoder.block.weight',
    shape: [2, 2],
    mean: 0,
    std: 0,
    min: 0,
    max: 0,
    grad_std: -0.25,
  });

  assert.equal(rows.length, 5);
  assert.equal(rows.at(-1)?.label, 'Grad Std');
  assert.equal(rows.at(-1)?.value, '-0.250000');
  assert.equal(
    rows.find((r) => r.label === 'Grad Mean'),
    undefined
  );
});

test('buildLiveLayerStatRows formats very small values with 6 decimal precision', () => {
  const rows = buildLiveLayerStatRows({
    name: 'encoder.block.weight',
    shape: [64, 64],
    mean: 1e-9,
    std: 1e-7,
    min: -1e-9,
    max: 1e-7,
  });

  // Protects the toFixed(6) contract — UI relies on it for stable column widths
  assert.deepEqual(
    rows.map((r) => r.value),
    ['0.000000', '0.000000', '-0.000000', '0.000000']
  );
});
