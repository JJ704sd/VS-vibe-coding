// Regression coverage for the export pipeline.
//
// These tests pin down two contracts that AnnotationStudio and
// CaseDetailPanel rely on:
//   1. exportToJSON / exportToCSV pass annotation records through without
//      losing fields (so importing a JSON back yields the same shape).
//   2. The CSV header order matches the per-row field order, so consumers
//      parsing the CSV by column index don't drift out of sync.
//   3. record.diagnosis round-trips through both formats when
//      includeDiagnosis is honoured.
//
// Why this exists:
//   Before the Canvas annotation audit, exportToCSV wrote annotation rows as
//   `${type},${position},${confidence.toFixed(2)},${manual}` while the
//   header read `Type,Position,Confidence,Manual`. A future field addition
//   on either side could silently desynchronise. These tests pin both ends.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportToJSON, exportToCSV } from './exportUtils.ts';
import type { Annotation, ECGRecord } from '../types/index.ts';

function buildAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann_1',
    type: 'P',
    position: 250,
    confidence: 0.92,
    manual: true,
    timestamp: 1700000000000,
    ...overrides,
  };
}

function buildRecord(overrides: Partial<ECGRecord> = {}): ECGRecord {
  return {
    id: 'rec_001',
    patientId: 'pat_001',
    deviceId: 'web-import',
    timestamp: '2026-07-04T08:00:00.000Z',
    leads: [
      { name: 'I', data: [0.1, 0.2, 0.3], samplingRate: 500 },
      { name: 'II', data: [0.05, 0.15, 0.25], samplingRate: 500 },
    ],
    duration: 3 / 500,
    samplingRate: 500,
    annotations: [],
    signalQuality: 88,
    diagnosis: { label: 'Normal sinus rhythm', confidence: 0.92 },
    ...overrides,
  };
}

test('exportToJSON includes annotations with full field shape (position / x / y preserved)', () => {
  const record = buildRecord({
    annotations: [
      buildAnnotation({
        id: 'ann_a',
        type: 'P',
        position: 100,
        x: 100,
        y: 200,
        confidence: 0.81,
        manual: true,
      }),
      buildAnnotation({
        id: 'ann_b',
        type: 'R',
        position: 300,
        x: 300,
        // y omitted on purpose to verify optional field is not synthesised
        confidence: 0.95,
        manual: false,
      }),
    ],
  });

  const json = JSON.parse(exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true }));

  assert.equal(json.annotations.length, 2);
  assert.equal(json.annotations[0].id, 'ann_a');
  assert.equal(json.annotations[0].position, 100);
  assert.equal(json.annotations[0].x, 100);
  assert.equal(json.annotations[0].y, 200);
  assert.equal(json.annotations[0].manual, true);
  assert.equal(json.annotations[1].type, 'R');
  // y should be undefined on the second entry — JSON.stringify drops
  // undefined fields, so the key must NOT appear.
  assert.equal('y' in json.annotations[1], false);
});

test('exportToJSON omits annotations when includeAnnotations is false', () => {
  const record = buildRecord({ annotations: [buildAnnotation()] });
  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: false, includeDiagnosis: true, includeMetadata: true }),
  );

  assert.equal('annotations' in json, false);
});

test('exportToJSON omits diagnosis when record.diagnosis is undefined', () => {
  const record = buildRecord({ diagnosis: undefined });
  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true }),
  );

  assert.equal('diagnosis' in json, false);
});

test('exportToJSON omits diagnosis when includeDiagnosis is false', () => {
  const record = buildRecord();
  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: false, includeMetadata: true }),
  );

  assert.equal('diagnosis' in json, false);
});

test('exportToCSV header and per-row field order match exactly (Type,Position,Confidence,Manual)', () => {
  const record = buildRecord({
    annotations: [
      buildAnnotation({ id: 'ann_p', type: 'P', position: 100, confidence: 0.7, manual: true }),
      buildAnnotation({ id: 'ann_r', type: 'R', position: 300, confidence: 0.95, manual: false }),
      buildAnnotation({ id: 'ann_t', type: 'T', position: 600, confidence: 0.6, manual: true }),
    ],
  });

  const csv = exportToCSV(record);
  const lines = csv.split('\n');

  // The header `Type,Position,Confidence,Manual` must appear once, and the
  // following annotation rows must match its column order. If this drifts,
  // downstream consumers indexing by column will silently mis-parse.
  const annotationHeaderIndex = lines.indexOf('Annotations');
  assert.ok(annotationHeaderIndex >= 0, 'expected "Annotations" section header');
  assert.equal(lines[annotationHeaderIndex + 1], 'Type,Position,Confidence,Manual');

  const rowP = lines[annotationHeaderIndex + 2];
  const rowR = lines[annotationHeaderIndex + 3];
  const rowT = lines[annotationHeaderIndex + 4];

  assert.equal(rowP, 'P,100,0.70,true');
  assert.equal(rowR, 'R,300,0.95,false');
  assert.equal(rowT, 'T,600,0.60,true');
});

test('exportToCSV formats confidence to 2 decimal places', () => {
  const record = buildRecord({
    annotations: [buildAnnotation({ confidence: 0.5 })],
  });

  const csv = exportToCSV(record);
  const lines = csv.split('\n');
  const annotationRow = lines.find((line) => line.startsWith('P,'));
  assert.ok(annotationRow);
  const cells = annotationRow.split(',');
  // cells[2] is Confidence with 2 decimals
  assert.equal(cells[2], '0.50');
});

test('exportToCSV warns but truncates when leads have different lengths (longest-first dropped)', () => {
  const record = buildRecord({
    leads: [
      { name: 'I', data: [0.1, 0.2, 0.3], samplingRate: 500 },
      { name: 'II', data: [0.05, 0.15], samplingRate: 500 }, // shorter
    ],
    annotations: [],
    diagnosis: undefined,
  });

  const csv = exportToCSV(record);
  const lines = csv.split('\n');

  // Find the Lead Data header and the Sample column headers
  const leadHeaderIdx = lines.indexOf('Lead Data');
  assert.ok(leadHeaderIdx >= 0, 'expected Lead Data section');
  assert.equal(lines[leadHeaderIdx + 1], 'Sample,I,II');

  // Two data rows (matching the shorter lead II)
  assert.match(lines[leadHeaderIdx + 2], /^0,/);
  assert.match(lines[leadHeaderIdx + 3], /^1,/);
  assert.equal(lines[leadHeaderIdx + 4], undefined);
});

test('exportToCSV includes diagnosis as label + percent confidence when present', () => {
  const record = buildRecord({
    diagnosis: { label: 'Atrial fibrillation', confidence: 0.73 },
    annotations: [],
  });

  const csv = exportToCSV(record);
  assert.match(csv, /Diagnosis,Atrial fibrillation/);
  assert.match(csv, /Confidence,73\.0%/);
});

test('exportToCSV writes annotation.position as-is (canvas px; no unit conversion)', () => {
  // The Canvas stores annotation.position in logical canvas px (0..width).
  // Auto R-peak detection derives position as `(sampleIndex / (n-1)) * width`.
  // The CSV must preserve that number verbatim — this test pins it so a
  // future "let's round to sample index" change has to update this test on
  // purpose, not silently.
  const record = buildRecord({
    annotations: [buildAnnotation({ id: 'ann_pos', type: 'R', position: 873.4567, confidence: 0.7, manual: false })],
  });

  const csv = exportToCSV(record);
  const lines = csv.split('\n');
  const row = lines.find((line) => line.startsWith('R,'));
  assert.ok(row);
  const cells = row.split(',');
  assert.equal(cells[1], '873.4567');
});

// --------------------------------------------------------------------------
// BUG-2026-07-04-R-01 (P0): mock inference must not be exported as a real
// diagnosis. These tests pin the export-pipeline contract: a `source` marker
// on `record.diagnosis` (set by `buildDiagnosis`) must flow through both
// formats. AnnotationStudio is the call site that fills `source` based on
// `modelService.isUsingMockInference()`; the helper itself is covered by
// buildDiagnosis.test.ts.
// --------------------------------------------------------------------------

test('exportToJSON preserves diagnosis.source so downstream consumers can detect mock fallback', () => {
  const record = buildRecord({
    diagnosis: { label: '房颤', confidence: 0.92, source: 'mock' },
    annotations: [],
  });

  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true }),
  );

  assert.equal(json.diagnosis.label, '房颤');
  assert.equal(json.diagnosis.confidence, 0.92);
  assert.equal(json.diagnosis.source, 'mock');
});

test('exportToJSON preserves diagnosis.source:"real" for real-model output', () => {
  const record = buildRecord({
    diagnosis: { label: '正常', confidence: 0.81, source: 'real' },
    annotations: [],
  });

  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true }),
  );

  assert.equal(json.diagnosis.source, 'real');
});

test('exportToJSON preserves diagnosis.source:"unavailable" for HR fallback', () => {
  const record = buildRecord({
    diagnosis: { label: 'HR 75 bpm', confidence: 0.5, source: 'unavailable' },
    annotations: [],
  });

  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true }),
  );

  assert.equal(json.diagnosis.source, 'unavailable');
});

test('exportToCSV writes Source row when diagnosis.source is set (mock case)', () => {
  const record = buildRecord({
    diagnosis: { label: '房颤', confidence: 0.92, source: 'mock' },
    annotations: [],
  });

  const csv = exportToCSV(record);

  // The Source row must appear immediately after the Confidence row so a
  // grep-by-section consumer sees the provenance right next to the label.
  const lines = csv.split('\n');
  const confidenceIdx = lines.findIndex((l) => l.startsWith('Confidence,'));
  assert.ok(confidenceIdx >= 0, 'expected Confidence row');
  assert.equal(lines[confidenceIdx + 1], 'Source,mock');
});

test('exportToCSV writes Source,real for real-model diagnosis', () => {
  const record = buildRecord({
    diagnosis: { label: '正常', confidence: 0.81, source: 'real' },
    annotations: [],
  });

  const csv = exportToCSV(record);
  assert.match(csv, /Source,real/);
});

test('exportToCSV writes Source,unavailable for HR fallback diagnosis', () => {
  const record = buildRecord({
    diagnosis: { label: 'HR 75 bpm', confidence: 0.5, source: 'unavailable' },
    annotations: [],
  });

  const csv = exportToCSV(record);
  assert.match(csv, /Source,unavailable/);
});

test('exportToCSV omits Source row when diagnosis.source is absent (backwards compatibility for older exports)', () => {
  // Existing ECG records imported from older exports (or hand-built test
  // fixtures) won't carry the new source field. The CSV writer must not
  // emit a stray `Source,undefined` row in that case.
  const record = buildRecord({
    diagnosis: { label: 'Normal sinus rhythm', confidence: 0.9 },
    annotations: [],
  });

  const csv = exportToCSV(record);
  assert.equal(csv.includes('\nSource,'), false, 'Source row must be absent when diagnosis.source is undefined');
});

// --------------------------------------------------------------------------
// BUG-2026-07-04-R-02 (P1): auto R-peak annotations now carry `y` so the
// marker lands on the waveform. exportRecord must preserve `y` through
// JSON (so a re-import can render the markers in the right place) and
// must NOT silently promote it into a CSV column without updating the
// header (otherwise downstream parsers index-drift).
// --------------------------------------------------------------------------

test('exportToJSON preserves auto R-peak annotation.y verbatim', () => {
  // Build an annotation mirroring what AnnotationStudio.handleAutoDetectRPeaks
  // emits after the fix: type R, manual false, y anchored to a lead band.
  const record = buildRecord({
    annotations: [
      buildAnnotation({
        id: 'auto_r_II_120',
        type: 'R',
        position: 144,
        x: 144,
        y: 73.2, // lead-2 band center, ~120/1000 of canvas width into the signal
        confidence: 0.75,
        manual: false,
      }),
    ],
  });

  const json = JSON.parse(
    exportToJSON(record, { format: 'json', includeAnnotations: true, includeDiagnosis: false, includeMetadata: true }),
  );

  assert.equal(json.annotations.length, 1);
  assert.equal(json.annotations[0].id, 'auto_r_II_120');
  assert.equal(json.annotations[0].type, 'R');
  assert.equal(json.annotations[0].y, 73.2, 'y must round-trip through JSON export');
  assert.equal(json.annotations[0].manual, false);
});

test('exportToCSV header is still Type,Position,Confidence,Manual (no silent y column)', () => {
  // Pinned so an attempt to add y to the CSV has to update this test on
  // purpose and keep header/row alignment in sync.
  const record = buildRecord({
    annotations: [
      buildAnnotation({
        id: 'auto_r_II_120',
        type: 'R',
        position: 144,
        x: 144,
        y: 73.2,
        confidence: 0.75,
        manual: false,
      }),
    ],
  });

  const csv = exportToCSV(record);
  const lines = csv.split('\n');
  const annotationHeaderIndex = lines.indexOf('Annotations');
  assert.ok(annotationHeaderIndex >= 0);
  assert.equal(lines[annotationHeaderIndex + 1], 'Type,Position,Confidence,Manual');

  const row = lines[annotationHeaderIndex + 2];
  assert.equal(row, 'R,144,0.75,false');
  // y must NOT appear in CSV row — the contract is "annotation.y is
  // canvas-only, JSON preserves it".
  assert.ok(!row.includes('73.2'), 'y must not be present on the CSV row');
});