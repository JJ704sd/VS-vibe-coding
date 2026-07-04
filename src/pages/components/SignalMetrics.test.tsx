// Regression coverage for BUG-2026-07-04-R-02 (P0):
//   Before the fix, AnnotationStudio's SignalMetrics rendered AI inference
//   results through the same visual path whether the underlying model was
//   the real TF.js classifier or ModelService.mockPredict (the heuristic
//   std/mean/amplitude fallback). Once the model-load warning toast timed
//   out, the user had no way to tell a mock prediction from a real one.
//
//   The fix adds an `isUsingMockInference` prop; when true, SignalMetrics
//   surfaces an orange MOCK chip in the AI results Card's `extra` area
//   (alongside the existing "Results" tag). This file pins that contract.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'node:test';

import SignalMetrics from './SignalMetrics.tsx';
import type { ModelPrediction } from '../../types/index.ts';

afterEach(() => {
  cleanup();
});

const SAMPLE_PREDICTIONS: ModelPrediction[] = [
  { className: '正常', probability: 0.82 },
  { className: '房颤', probability: 0.07 },
  { className: '室上性心动过速', probability: 0.05 },
  { className: '室性心动过速', probability: 0.04 },
  { className: '停搏', probability: 0.02 },
];

const SAMPLE_LEAD = {
  name: 'II',
  data: [0.1, 0.2, 0.1, -0.1, 0.0, 0.05],
  samplingRate: 500,
};

const SAMPLE_ANNOTATION_STATS = { total: 0, rPeaks: 0 };

function renderMetrics(isUsingMockInference: boolean | undefined) {
  return render(
    <SignalMetrics
      leads={[SAMPLE_LEAD]}
      signalQuality={90}
      annotationStats={SAMPLE_ANNOTATION_STATS}
      inferenceResults={SAMPLE_PREDICTIONS}
      {...(isUsingMockInference === undefined ? {} : { isUsingMockInference })}
    />,
  );
}

test('SignalMetrics shows the MOCK chip in the AI results card title when isUsingMockInference=true', () => {
  // This is the regression target: the chip must be visible to the user
  // whenever the model service is in mock fallback mode. We assert via
  // data-testid so a future i18n / colour refactor doesn't break the
  // contract silently — only the chip's presence matters for safety.
  const { getByTestId } = renderMetrics(true);
  const chip = getByTestId('mock-inference-chip');
  assert.ok(chip, 'MOCK chip must render when isUsingMockInference is true');
  assert.equal(chip.textContent, 'MOCK');
});

test('SignalMetrics does NOT show the MOCK chip when isUsingMockInference=false', () => {
  const { queryByTestId } = renderMetrics(false);
  assert.equal(
    queryByTestId('mock-inference-chip'),
    null,
    'MOCK chip must be absent when isUsingMockInference is false',
  );
});

test('SignalMetrics defaults isUsingMockInference to false (no MOCK chip) when prop is omitted', () => {
  // Existing call sites and tests that haven't been updated must continue to
  // render without the chip. The default keeps the change additive.
  const { queryByTestId } = renderMetrics(undefined);
  assert.equal(
    queryByTestId('mock-inference-chip'),
    null,
    'MOCK chip must be absent when isUsingMockInference prop is omitted (default false)',
  );
});

test('SignalMetrics still renders inference results normally when isUsingMockInference=true (chip is additive only)', () => {
  // The chip is meant to add provenance, not to suppress results. Existing
  // list rendering must continue to work — className tags and progress bars
  // remain visible alongside the new chip.
  const { container, getByTestId } = renderMetrics(true);
  assert.ok(getByTestId('mock-inference-chip'), 'MOCK chip visible');
  assert.ok(
    container.textContent?.includes('正常'),
    'top prediction className must still render in the list',
  );
  assert.ok(
    container.textContent?.includes('房颤'),
    'other classNames must still render in the list',
  );
});

test('SignalMetrics still shows "Results" tag alongside the MOCK chip (no UI regression)', () => {
  // The previous title extra contained only the "Results" Tag. We keep that
  // tag and add MOCK next to it — pin the existing tag so a future cleanup
  // doesn't drop the existing label.
  const { container, getByTestId } = renderMetrics(true);
  assert.ok(getByTestId('mock-inference-chip'));
  assert.ok(container.textContent?.includes('Results'), '"Results" tag must still render');
});