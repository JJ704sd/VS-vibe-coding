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
