// Regression coverage for `buildDiagnosis`.
//
// Before the fix, `AnnotationStudio.handleExportCurrentRecord` synthesised the
// export's `record.diagnosis` inline without distinguishing real TF.js output
// from the `ModelService.mockPredict` fallback. An exported JSON / CSV file
// could carry `diagnosis.confidence = 0.92` with `label = "房颤"` while the
// model had never been loaded — there was no marker a downstream consumer
// could grep to detect this. The fix threads `modelService.isUsingMockInference()`
// into the diagnosis object via this helper.
//
// What we pin:
//   1. Real model + non-empty results → `source: 'real'`, top-class label
//      and probability pass through verbatim.
//   2. Mock fallback + non-empty results → `source: 'mock'`, same
//      label/probability surface (the UI was already showing them).
//   3. Empty inference results → `source: 'unavailable'`, label switches to
//      either `HR <n> bpm` (when a heart rate is available) or `未分析`.
//   4. The function never fabricates an inference result for the caller —
//      it must read whatever the caller provides.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDiagnosis } from './buildDiagnosis.ts';
import type { ModelPrediction } from '../types/index.ts';

const REAL_PREDICTIONS: ModelPrediction[] = [
  { className: '正常', probability: 0.82 },
  { className: '房颤', probability: 0.07 },
  { className: '室上性心动过速', probability: 0.05 },
  { className: '室性心动过速', probability: 0.04 },
  { className: '停搏', probability: 0.02 },
];

test('buildDiagnosis returns source:"real" when inference results exist and model service is not in mock fallback', () => {
  const diagnosis = buildDiagnosis({
    inferenceResults: REAL_PREDICTIONS,
    isUsingMockInference: false,
    heartRate: 75,
  });

  assert.equal(diagnosis.source, 'real');
  assert.equal(diagnosis.label, '正常');
  assert.equal(diagnosis.confidence, 0.82);
});

test('buildDiagnosis returns source:"mock" when inference results exist but model service is in mock fallback', () => {
  // This is the regression target: before the fix, AnnotationStudio wrote
  // { label, confidence } only and the file looked like a real-model
  // diagnosis. Now the source tag travels with the record.
  const diagnosis = buildDiagnosis({
    inferenceResults: REAL_PREDICTIONS,
    isUsingMockInference: true,
    heartRate: 75,
  });

  assert.equal(diagnosis.source, 'mock');
  assert.equal(diagnosis.label, '正常');
  assert.equal(diagnosis.confidence, 0.82);
});

test('buildDiagnosis uses top prediction (highest probability) as the diagnosis label', () => {
  const reordered: ModelPrediction[] = [
    { className: '室性心动过速', probability: 0.61 },
    { className: '正常', probability: 0.18 },
  ];

  const diagnosis = buildDiagnosis({
    inferenceResults: reordered,
    isUsingMockInference: true,
    heartRate: 110,
  });

  // Note: ModelService.formatPrediction sorts descending, but buildDiagnosis
  // trusts whatever the caller hands in. We pin that it uses index 0
  // verbatim — if a future caller forgets to sort, buildDiagnosis should
  // not silently fix it.
  assert.equal(diagnosis.label, '室性心动过速');
  assert.equal(diagnosis.confidence, 0.61);
  assert.equal(diagnosis.source, 'mock');
});

test('buildDiagnosis returns source:"unavailable" with HR fallback when no inference results but heart rate is present', () => {
  const diagnosis = buildDiagnosis({
    inferenceResults: [],
    isUsingMockInference: false,
    heartRate: 75,
  });

  assert.equal(diagnosis.source, 'unavailable');
  assert.equal(diagnosis.label, 'HR 75 bpm');
  // Pin confidence at the historical 0.5 so a future change to bump this
  // has to update the test on purpose, not silently.
  assert.equal(diagnosis.confidence, 0.5);
});

test('buildDiagnosis returns source:"unavailable" with "未分析" fallback when no inference results and no heart rate', () => {
  const diagnosis = buildDiagnosis({
    inferenceResults: [],
    isUsingMockInference: false,
    heartRate: null,
  });

  assert.equal(diagnosis.source, 'unavailable');
  assert.equal(diagnosis.label, '未分析');
  assert.equal(diagnosis.confidence, 0.5);
});

test('buildDiagnosis never fabricates an inference result — empty input always yields "unavailable"', () => {
  // This pins the contract that the mock flag is ignored when there are no
  // inference results. Otherwise a caller could "lie" by passing
  // isUsingMockInference=true with empty results and get a mock-tagged
  // "未分析" — which would be misleading.
  const diagnosis = buildDiagnosis({
    inferenceResults: [],
    isUsingMockInference: true,
    heartRate: 75,
  });

  assert.equal(diagnosis.source, 'unavailable');
  assert.equal(diagnosis.label, 'HR 75 bpm');
});