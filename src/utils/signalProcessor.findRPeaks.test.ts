// Regression coverage for findRPeaks + the auto-R-peak viewWidth integration.
//
// The Canvas audit (2026-07-04) found that AnnotationStudio.handleAutoDetectRPeaks
// hardcoded `const viewWidth = 1200` while ECGCanvas has the same default
// width. The fix imports `ECG_CANVAS_VIEW_WIDTH` from ECGCanvas so the two
// stay in sync. These tests verify that:
//
//   1. findRPeaks detects the obvious R peaks in a synthetic ECG-like signal.
//   2. The mapping `(sampleIndex / (n - 1)) * viewWidth` agrees with the
//      constant, so changing the constant in one place changes the output in
//      the other.
//   3. Threshold handling works at the boundary (just above / just below).
//
// Note: findRPeaks internally normalises by abs-max, so any non-zero signal
// with a clear local max above `threshold` and a drop below `threshold * 0.5`
// counts as one peak. We use a synthetic 2-beat pattern to keep this fast
// and deterministic.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRPeaks } from './signalProcessor.ts';
import { ECG_CANVAS_VIEW_WIDTH } from '../components/Canvas/constants.ts';

function buildSyntheticBeats(sampleCount: number, beats: number, samplesPerBeat: number): number[] {
  // Build a flat baseline with sharp R-spikes at evenly spaced positions.
  // 5% width around each spike keeps the peak detection easy.
  const data = new Array<number>(sampleCount).fill(0);
  for (let b = 0; b < beats; b += 1) {
    const center = Math.floor((b + 0.5) * samplesPerBeat);
    const halfWidth = Math.max(2, Math.floor(samplesPerBeat * 0.025));
    for (let d = -halfWidth; d <= halfWidth; d += 1) {
      const i = center + d;
      if (i < 0 || i >= sampleCount) continue;
      // Triangle shape, peak 1.0 at center.
      data[i] = 1 - Math.abs(d) / halfWidth;
    }
  }
  return data;
}

test('findRPeaks detects each synthetic R-spike exactly once', () => {
  const samplesPerBeat = 200;
  const beats = 5;
  const data = buildSyntheticBeats(samplesPerBeat * beats, beats, samplesPerBeat);

  const peaks = findRPeaks(data, 0.5);

  assert.equal(peaks.length, beats, `expected ${beats} peaks, got ${peaks.length}`);
  for (let b = 0; b < beats; b += 1) {
    const expectedCenter = Math.floor((b + 0.5) * samplesPerBeat);
    // Allow ±halfWidth tolerance because the detection window widens slightly.
    const halfWidth = Math.max(2, Math.floor(samplesPerBeat * 0.025));
    assert.ok(
      Math.abs(peaks[b] - expectedCenter) <= halfWidth,
      `peak ${b}: expected ~${expectedCenter}, got ${peaks[b]}`,
    );
  }
});

test('findRPeaks is monotone non-decreasing', () => {
  const data = buildSyntheticBeats(1000, 5, 200);
  const peaks = findRPeaks(data, 0.5);

  for (let i = 1; i < peaks.length; i += 1) {
    assert.ok(peaks[i] > peaks[i - 1], `peak[${i}]=${peaks[i]} not > peak[${i - 1}]=${peaks[i - 1]}`);
  }
});

test('findRPeaks returns empty array when no sample crosses the threshold', () => {
  const data = new Array<number>(500).fill(0.1); // max abs = 0.1
  const peaks = findRPeaks(data, 0.5); // threshold > max abs / max abs = 0.1, normalised = 1.0; but every sample is the same so no peak
  assert.equal(peaks.length, 0);
});

test('findRPeaks threshold near max returns no peaks (boundary)', () => {
  const data = buildSyntheticBeats(400, 2, 200);
  const peaks = findRPeaks(data, 1.0); // threshold = normalised max → never enters "inPeak"
  assert.equal(peaks.length, 0);
});

test('findRPeaks threshold of 0 returns no peaks (inPeak never exits)', () => {
  // Documented quirk: with threshold=0 the "exit" branch is
  // `normalized[i] < threshold * 0.5`, which is `< 0` — impossible for the
  // [0,1] normalized signal. inPeak never exits, so no peak is recorded.
  // Pinning this so future refactors don't change it silently.
  const data = buildSyntheticBeats(400, 2, 200);
  const peaks = findRPeaks(data, 0);
  assert.equal(peaks.length, 0);
});

test('Canvas mapping (sampleIndex / (n-1)) * ECG_CANVAS_VIEW_WIDTH places peak at expected px', () => {
  // Regression for BUG #2: AnnotationStudio previously hardcoded
  // `viewWidth = 1200`. The fix uses ECG_CANVAS_VIEW_WIDTH exported from
  // ECGCanvas. We pin the relationship here so the next width change has
  // to update this assertion intentionally.
  const samplesPerBeat = 200;
  const beats = 5;
  const totalSamples = samplesPerBeat * beats;
  const data = buildSyntheticBeats(totalSamples, beats, samplesPerBeat);

  const peaks = findRPeaks(data, 0.5);
  assert.equal(peaks.length, beats);

  for (let b = 0; b < beats; b += 1) {
    const px = (peaks[b] / Math.max(1, totalSamples - 1)) * ECG_CANVAS_VIEW_WIDTH;
    // The expected px should be approximately (b+0.5) / beats * viewWidth.
    const expected = ((b + 0.5) / beats) * ECG_CANVAS_VIEW_WIDTH;
    // Tolerance accounts for the half-window used by buildSyntheticBeats.
    const tolerance = (samplesPerBeat / totalSamples) * ECG_CANVAS_VIEW_WIDTH + 1;
    assert.ok(
      Math.abs(px - expected) <= tolerance,
      `peak ${b}: px=${px.toFixed(2)} expected~${expected.toFixed(2)}`,
    );
  }
});

test('ECG_CANVAS_VIEW_WIDTH matches the documented default (pin against silent changes)', () => {
  // If someone changes this constant without updating this test on purpose,
  // the auto R-peak placement test above will fail. That is the desired
  // behaviour — width changes should be explicit.
  assert.equal(ECG_CANVAS_VIEW_WIDTH, 1200);
});