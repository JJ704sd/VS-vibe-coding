// Regression coverage for the lead-aware geometry helpers in constants.ts.
//
// These helpers back both the canvas polyline rendering and the auto R-peak
// annotation generator. A divergence between them silently moves auto R-peak
// markers off the waveform — exactly the bug P2 in this round.
//
// Tests cover:
//   - band height for varying lead counts (matches ECGCanvas.renderWaveforms)
//   - amplitude scale stable on silent / zero data (no NaN / Infinity)
//   - the composite (x, y) lands inside the lead's band for each sample
//   - the documented defaults ECG_CANVAS_VIEW_WIDTH and
//     ECG_CANVAS_DEFAULT_HEIGHT pin constant drift

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeAmplitudeScale,
  computeCanvasPointForSample,
  computeLeadBandHeight,
  ECG_CANVAS_DEFAULT_HEIGHT,
  ECG_CANVAS_VIEW_WIDTH,
} from './constants.ts';

test('computeLeadBandHeight: equals canvasHeight / leadCount for the same math ECGCanvas uses', () => {
  assert.equal(computeLeadBandHeight(600, 6), 100);
  assert.equal(computeLeadBandHeight(ECG_CANVAS_DEFAULT_HEIGHT, 6), ECG_CANVAS_DEFAULT_HEIGHT / 6);
});

test('computeLeadBandHeight: clamps a zero leadCount to canvasHeight/1 (no divide-by-zero)', () => {
  // ECGCanvas uses Math.max(1, leads.length) for the same reason. We keep
  // the contract identical so the auto R-peak helper never sees Infinity.
  assert.equal(computeLeadBandHeight(600, 0), 600);
});

test('computeAmplitudeScale: stable on silent / zero data (no NaN / Infinity)', () => {
  const silent = { data: new Array(200).fill(0) };
  const scale = computeAmplitudeScale(silent, 100);

  assert.ok(Number.isFinite(scale));
  // 0.01 fallback maxAbs keeps the scale positive and finite.
  assert.ok(scale > 0);
  // With the 0.01 fallback, scale = bandHeight * 0.34 / 0.01 = bandHeight * 34.
  assert.equal(scale, 100 * 0.34 / 0.01);
});

test('computeAmplitudeScale: corresponds to (bandHeight * 0.34) / maxAbs for the active lead', () => {
  const lead = { data: [0.1, 0.2, 0.5, -0.7, 0.3, 0.05] };
  const scale = computeAmplitudeScale(lead, 200);
  assert.equal(scale, (200 * 0.34) / 0.7);
});

test('computeCanvasPointForSample: x maps from sample index to logical canvas width', () => {
  const lead = { data: new Array(101).fill(0) };
  // data length = 101, sample index in [0, 100], so x must span the canvas.
  assert.equal(computeCanvasPointForSample({
    sampleIndex: 0,
    lead,
    leadIndex: 0,
    leadCount: 6,
    canvasWidth: ECG_CANVAS_VIEW_WIDTH,
    canvasHeight: ECG_CANVAS_DEFAULT_HEIGHT,
  }).x, 0);
  assert.equal(computeCanvasPointForSample({
    sampleIndex: 100,
    lead,
    leadIndex: 0,
    leadCount: 6,
    canvasHeight: ECG_CANVAS_DEFAULT_HEIGHT,
    canvasWidth: ECG_CANVAS_VIEW_WIDTH,
  }).x, ECG_CANVAS_VIEW_WIDTH);
});

test('computeCanvasPointForSample: y equals lead band center for a zero-value sample', () => {
  const lead = { data: new Array(200).fill(0) };
  for (let leadIndex = 0; leadIndex < 6; leadIndex += 1) {
    const { y } = computeCanvasPointForSample({
      sampleIndex: 50,
      lead,
      leadIndex,
      leadCount: 6,
      canvasWidth: ECG_CANVAS_VIEW_WIDTH,
      canvasHeight: ECG_CANVAS_DEFAULT_HEIGHT,
    });
    const bandHeight = computeLeadBandHeight(ECG_CANVAS_DEFAULT_HEIGHT, 6);
    const centerOffset = bandHeight / 2;
    const expected = leadIndex * bandHeight + centerOffset;
    assert.equal(y, expected, `lead ${leadIndex}: expected center ${expected}, got ${y}`);
  }
});

test('computeCanvasPointForSample: positive sample pulls y upward (smaller px) within the band', () => {
  // With maxAbs = 0.5 and leadBandHeight computed for 6 leads at 520 px,
  // amplitudeScale = (86.6666.. * 0.34) / 0.5 ≈ 58.93 px / unit. A positive
  // value of 0.5 at sample 100 lands at lead0 center (43.33) - 29.47 ≈ 13.86.
  const lead = { data: new Array(101).fill(0).map((_, i) => (i === 100 ? 0.5 : 0)) };
  const { y } = computeCanvasPointForSample({
    sampleIndex: 100,
    lead,
    leadIndex: 0,
    leadCount: 6,
    canvasWidth: ECG_CANVAS_VIEW_WIDTH,
    canvasHeight: ECG_CANVAS_DEFAULT_HEIGHT,
  });
  const bandHeight = computeLeadBandHeight(ECG_CANVAS_DEFAULT_HEIGHT, 6);
  const centerOffset = bandHeight / 2;
  const amplitudeScale = computeAmplitudeScale(lead, bandHeight);
  const expected = centerOffset - 0.5 * amplitudeScale;
  assert.ok(Math.abs(y - expected) < 1e-9, `expected ${expected}, got ${y}`);
  // The marker must remain inside the lead's vertical band.
  assert.ok(y >= 0 && y <= bandHeight, `y=${y} outside band [0, ${bandHeight}]`);
});

test('computeCanvasPointForSample: out-of-range sampleIndex falls back to band center', () => {
  // Defensive: callers may pass stale peaks from older recordings. The
  // helper must not produce a y outside the band; falling back to the
  // band center matches how ECGCanvas.renderWaveforms treats missing
  // samples via `lead.data[i] ?? 0` (kept identical for symmetry).
  const lead = { data: new Array<number>(50).fill(0) };
  const { y } = computeCanvasPointForSample({
    sampleIndex: 9999,
    lead,
    leadIndex: 0,
    leadCount: 6,
    canvasWidth: ECG_CANVAS_VIEW_WIDTH,
    canvasHeight: ECG_CANVAS_DEFAULT_HEIGHT,
  });
  const bandHeight = computeLeadBandHeight(ECG_CANVAS_DEFAULT_HEIGHT, 6);
  const centerOffset = bandHeight / 2;
  assert.equal(y, centerOffset);
});

test('ECG_CANVAS_VIEW_WIDTH and ECG_CANVAS_DEFAULT_HEIGHT are pinned to their documented values', () => {
  // If either of these changes, the auto-R-peak placement and the canvas
  // polyline geometry drift apart — exactly the bug we are guarding against.
  assert.equal(ECG_CANVAS_VIEW_WIDTH, 1200);
  assert.equal(ECG_CANVAS_DEFAULT_HEIGHT, 520);
});
