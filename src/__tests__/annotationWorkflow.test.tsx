// End-to-end regression for the AnnotationStudio chain:
//
//   1. Import ECG JSON sample  →  ecgParserService.parseJSON()
//   2. Load model              →  dispatch(setModelLoaded(true))
//   3. Run analysis            →  dispatch(setInferenceResults([...]))
//   4. Add PQRST annotations   →  dispatch(addAnnotation(...)) × 5
//   5. Delete one annotation   →  dispatch(removeAnnotation(id))
//   6. Export JSON / CSV       →  exportToJSON / exportToCSV
//
// We deliberately exercise real production code on every leg:
//   - the JSON import path goes through ecgParserService.parseJSON
//   - the model/analysis leg dispatches the same Redux actions the
//     modelService-driven UI calls (modelService.loadModel itself runs
//     against TF.js which doesn't work under Node and is pinned by its
//     own unit tests + signalProcessor.findRPeaks tests)
//   - annotation mutations go through the real reducer
//   - the export leg calls exportToJSON / exportToCSV directly so we
//     can assert the file content the user would receive (bypassing
//     downloadFile's Blob/anchor plumbing, which is the only
//     DOM-touching side-effect and not part of the user-visible data).
//   - AnnotationList / AnnotationToolbar render via the real antd
//     components under happy-dom so the assertions target text the user
//     actually reads.
//
// What we do NOT mount:
//   - ECGCanvas (Fabric.js needs a real canvas backend).
//   - The full AnnotationStudio page (Firebase + Fabric + modelService
//     fan-out). The reducer-level guarantees those components rely on
//     are covered by ecgSlice.test.ts.

import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';

import caseReducer from '../store/caseSlice.ts';
import ecgReducer, {
  addAnnotation,
  removeAnnotation,
  setInferenceResults,
  setModelLoaded,
} from '../store/ecgSlice.ts';
import { ecgParserService } from '../services/ecgParser.ts';
import { exportToCSV, exportToJSON } from '../utils/exportUtils.ts';
import AnnotationList from '../pages/components/AnnotationList.tsx';
import AnnotationToolbar from '../pages/components/AnnotationToolbar.tsx';
import type { Annotation, ECGRecord } from '../types/index.ts';

type AnnotationType = Annotation['type'];

afterEach(() => {
  cleanup();
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeAnnotation(overrides: Partial<Annotation> & { id: string; type: AnnotationType }): Annotation {
  return {
    position: 100,
    confidence: 1.0,
    manual: true,
    timestamp: 1700000000000,
    ...overrides,
  };
}

function buildJsonSample(): string {
  // Same shape that exportUtils.importFromJSON can round-trip back into an
  // ECGRecord, so we can assert "import → export → re-import → equal" via
  // JSON.parse.
  const record = {
    id: 'rec_sample_001',
    patientId: 'pat_e2e',
    deviceId: 'web-import',
    timestamp: '2026-07-04T08:00:00.000Z',
    leads: [
      { name: 'I', data: [0.1, 0.2, 0.3, 0.2, 0.1, 0.0, -0.1, -0.05, 0.0], samplingRate: 500 },
      { name: 'II', data: [0.05, 0.15, 0.25, 0.15, 0.05, -0.05, -0.1, -0.03, 0.0], samplingRate: 500 },
    ],
    duration: 0.018,
    samplingRate: 500,
    annotations: [],
    signalQuality: 88,
  };
  return JSON.stringify(record);
}

async function importSample(): Promise<ECGRecord> {
  const result = await ecgParserService.parseJSON(buildJsonSample());
  assert.equal(result.success, true, `parseJSON failed: ${result.error ?? 'unknown'}`);
  // ImportResult is a flat interface with optional fields (not a discriminated
  // union), so we narrow both fields explicitly before reading them.
  if (!result.success || !result.record) {
    throw new Error('parseJSON succeeded but returned no record');
  }
  return result.record;
}

function buildExportRecord(args: {
  id: string;
  patientId: string;
  leads: ECGRecord['leads'];
  annotations: Annotation[];
  duration: number;
  samplingRate: number;
  diagnosis?: ECGRecord['diagnosis'];
}): ECGRecord {
  return {
    id: args.id,
    patientId: args.patientId,
    deviceId: 'web-import',
    timestamp: '2026-07-04T08:00:00.000Z',
    leads: args.leads,
    duration: args.duration,
    samplingRate: args.samplingRate,
    annotations: args.annotations,
    signalQuality: 90,
    diagnosis: args.diagnosis,
  };
}

function buildTestStore() {
  return configureStore({
    reducer: { ecg: ecgReducer, cases: caseReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: { ignoredActions: ['ecg/setInferenceResults'] },
      }),
  });
}

// --------------------------------------------------------------------------
// Workflow A — full data-layer chain ending in a JSON export round-trip
// --------------------------------------------------------------------------

test('Workflow A: import → load → analyze → PQRST → delete → exportToJSON round-trips the post-delete state', async () => {
  // 1. Import ECG JSON sample using real ecgParserService.
  const imported = await importSample();
  assert.ok(imported.leads.length >= 1);

  // 2 + 3. Drive the model-load + analysis state machine via the same Redux
  // actions AnnotationStudio dispatches after modelService.loadModel /
  // predictWithHeatmap complete. The TF paths are exercised by their own
  // unit tests; here we focus on the state transitions the user sees.
  const store = buildTestStore();
  store.dispatch(setModelLoaded(true));
  store.dispatch(
    setInferenceResults([
      { className: '正常', probability: 0.82 },
      { className: '房颤', probability: 0.07 },
      { className: '室上性心动过速', probability: 0.05 },
      { className: '室性心动过速', probability: 0.04 },
      { className: '停搏', probability: 0.02 },
    ]),
  );
  assert.equal(store.getState().ecg.modelLoaded, true);
  assert.equal(store.getState().ecg.inferenceResults.length, 5);

  // 4. Add five PQRST annotations through the real reducer.
  const annP = makeAnnotation({ id: 'ann_P_1', type: 'P', position: 100 });
  const annQ = makeAnnotation({ id: 'ann_Q_1', type: 'Q', position: 200 });
  // This R-peak is the candidate for deletion below; pick a position so we
  // can match it deterministically in the CSV check (Workflow B).
  const annR = makeAnnotation({ id: 'ann_R_2', type: 'R', position: 300, manual: false, confidence: 0.75 });
  const annS = makeAnnotation({ id: 'ann_S_1', type: 'S', position: 400 });
  const annT = makeAnnotation({ id: 'ann_T_1', type: 'T', position: 600 });

  for (const ann of [annP, annQ, annR, annS, annT]) {
    store.dispatch(addAnnotation(ann));
  }
  assert.equal(store.getState().ecg.annotations.length, 5);

  // 5. Delete the middle R-peak via real removeAnnotation.
  store.dispatch(removeAnnotation('ann_R_2'));
  const remaining = store.getState().ecg.annotations;
  assert.equal(remaining.length, 4, 'one annotation removed');
  assert.equal(remaining.find((a) => a.id === 'ann_R_2'), undefined);

  // 6. Build the export record the same shape AnnotationStudio
  //    handleExportCurrentRecord builds, then export to JSON.
  const topInference = store.getState().ecg.inferenceResults[0];
  const exportedJson = exportToJSON(
    buildExportRecord({
      id: imported.id,
      patientId: imported.patientId,
      leads: imported.leads,
      annotations: remaining,
      duration: imported.duration,
      samplingRate: imported.samplingRate,
      diagnosis: { label: topInference.className, confidence: topInference.probability },
    }),
    { format: 'json', includeAnnotations: true, includeDiagnosis: true, includeMetadata: true },
  );

  // The exported file content is the "user-visible" output. We assert:
  //   - parseable as JSON (no malformed output),
  //   - 4 annotations, none of them the deleted one,
  //   - diagnosis carries the top inference class + probability,
  //   - record id and lead data round-trip so re-importing the file is sane.
  const parsed = JSON.parse(exportedJson);
  assert.equal(parsed.annotations.length, 4);
  assert.ok(
    parsed.annotations.every((a: Annotation) => a.id !== 'ann_R_2'),
    'deleted annotation must not appear in the exported JSON',
  );
  assert.equal(parsed.diagnosis.label, '正常');
  assert.equal(parsed.diagnosis.confidence, 0.82);
  assert.equal(parsed.id, imported.id);
  assert.ok(parsed.leads.length >= 1);
  assert.equal(parsed.leads[0].name, imported.leads[0].name);
  assert.deepEqual(parsed.leads[0].data, imported.leads[0].data);
});

// --------------------------------------------------------------------------
// Workflow B — same chain, but the export is CSV. Assert row-by-row.
// --------------------------------------------------------------------------

test('Workflow B: same chain → exportToCSV reflects the post-delete annotation set with intact header', async () => {
  const imported = await importSample();

  // Use confidence values with two decimals so we can pin the formatting.
  const annP = makeAnnotation({ id: 'ann_P_1', type: 'P', position: 100, confidence: 0.95 });
  const annQ = makeAnnotation({ id: 'ann_Q_1', type: 'Q', position: 200, confidence: 0.95 });
  const annR = makeAnnotation({ id: 'ann_R_2', type: 'R', position: 300, manual: false, confidence: 0.75 });
  const annS = makeAnnotation({ id: 'ann_S_1', type: 'S', position: 400, confidence: 0.95 });
  const annT = makeAnnotation({ id: 'ann_T_1', type: 'T', position: 600, confidence: 0.95 });

  const store = buildTestStore();
  for (const ann of [annP, annQ, annR, annS, annT]) {
    store.dispatch(addAnnotation(ann));
  }
  store.dispatch(removeAnnotation('ann_R_2'));
  assert.equal(store.getState().ecg.annotations.length, 4);

  const csv = exportToCSV(
    buildExportRecord({
      id: imported.id,
      patientId: imported.patientId,
      leads: imported.leads,
      annotations: store.getState().ecg.annotations,
      duration: imported.duration,
      samplingRate: imported.samplingRate,
      diagnosis: { label: '正常', confidence: 0.82 },
    }),
  );

  const lines = csv.split('\n');

  // CSV section layout: "Annotations" + header row + N rows + blank +
  // "Lead Data" + lead column header + samples.
  const annHeaderIdx = lines.indexOf('Annotations');
  assert.ok(annHeaderIdx >= 0, 'expected Annotations section header');
  assert.equal(lines[annHeaderIdx + 1], 'Type,Position,Confidence,Manual');

  const annotationRows: string[] = [];
  for (let i = annHeaderIdx + 2; i < lines.length && lines[i] && !lines[i].startsWith('Lead Data'); i += 1) {
    annotationRows.push(lines[i]);
  }
  assert.equal(annotationRows.length, 4, `expected 4 annotation rows, got ${annotationRows.length}`);

  // The deleted R-peak must not appear in any row.
  assert.equal(csv.includes('ann_R_2'), false, 'deleted annotation id must not appear');
  assert.equal(
    annotationRows.some((r) => r.startsWith('R,300,')),
    false,
    'deleted R row must not appear',
  );

  // The four surviving rows must be present in the documented order
  // (header drives column order; we don't pin full order, just membership).
  assert.ok(annotationRows.find((r) => r === 'P,100,0.95,true'));
  assert.ok(annotationRows.find((r) => r === 'Q,200,0.95,true'));
  assert.ok(annotationRows.find((r) => r === 'S,400,0.95,true'));
  assert.ok(annotationRows.find((r) => r === 'T,600,0.95,true'));

  // Diagnosis + lead data sections must still be present after the deletion.
  assert.match(csv, /Diagnosis,正常/);
  assert.match(csv, /Confidence,82\.0%/);
  assert.ok(csv.includes('Lead Data'));
  assert.equal(lines.indexOf('Lead Data') > annHeaderIdx, true);
});

// --------------------------------------------------------------------------
// Workflow C — UI: AnnotationList mirrors Redux state when one entry is removed
// --------------------------------------------------------------------------

test('Workflow C: AnnotationList renders all entries, then drops the deleted one after a re-render', () => {
  const annP = makeAnnotation({ id: 'ann_P', type: 'P', position: 100 });
  const annR = makeAnnotation({ id: 'ann_R', type: 'R', position: 300 });
  const annT = makeAnnotation({ id: 'ann_T', type: 'T', position: 600 });

  const store = buildTestStore();
  for (const ann of [annP, annR, annT]) {
    store.dispatch(addAnnotation(ann));
  }

  // Pass the same Provider the real AnnotationStudio uses, so this test
  // exercises the production Redux → render wiring path, not a stripped-
  // down stand-in.
  const { container, rerender } = render(
    <Provider store={store}>
      <AnnotationList
        annotations={store.getState().ecg.annotations}
        totalCount={store.getState().ecg.annotations.length}
      />
    </Provider>,
  );

  const itemSelector = '.ant-list-item';
  const initialItems = container.querySelectorAll(itemSelector);
  assert.equal(initialItems.length, 3, 'expected 3 list items rendered');
  // All three position chips visible to the user.
  assert.ok(container.textContent?.includes('位置: 100'));
  assert.ok(container.textContent?.includes('位置: 300'));
  assert.ok(container.textContent?.includes('位置: 600'));

  // Now dispatch the deletion that mirrors the workflow and re-render with the
  // new annotations array (this is what AnnotationStudio would do via its
  // useSelector subscription).
  store.dispatch(removeAnnotation('ann_R'));

  rerender(
    <Provider store={store}>
      <AnnotationList
        annotations={store.getState().ecg.annotations}
        totalCount={store.getState().ecg.annotations.length}
      />
    </Provider>,
  );

  const afterItems = container.querySelectorAll(itemSelector);
  assert.equal(afterItems.length, 2, 'expected 2 list items after deletion');
  assert.ok(container.textContent?.includes('位置: 100'));
  assert.ok(container.textContent?.includes('位置: 600'));
  assert.equal(container.textContent?.includes('位置: 300'), false,
    'deleted annotation chip "位置: 300" must no longer be visible to the user');
});

test('Workflow C (empty state): AnnotationList shows the empty hint when there are no annotations', () => {
  render(<AnnotationList annotations={[]} totalCount={0} />);
  // The user-visible empty-state hint from AnnotationList.
  assert.ok(screen.getByText('暂无标注'));
});

// --------------------------------------------------------------------------
// Workflow D — UI handler contract: AnnotationToolbar wires its buttons.
// --------------------------------------------------------------------------

test('Workflow D: AnnotationToolbar fires onDeleteAnnotation when "删除已选标注" is clicked', () => {
  let deleteCalls = 0;
  render(
    <AnnotationToolbar
      activeTool="pan"
      activeAnnotationType="P"
      onSelectTool={() => {}}
      onSelectAnnotationType={() => {}}
      onDeleteAnnotation={() => {
        deleteCalls += 1;
      }}
    />,
  );

  // The danger button "删除已选标注" must be wired to the delete handler —
  // this is the click-to-delete flow AnnotationStudio relies on.
  const deleteBtn = screen.getByText('删除已选标注');
  fireEvent.click(deleteBtn);
  assert.equal(deleteCalls, 1, 'onDeleteAnnotation must fire exactly once per click');
});

test('Workflow D: AnnotationToolbar forwards the chosen PQRST type via onSelectAnnotationType', () => {
  const calls: AnnotationType[] = [];
  render(
    <AnnotationToolbar
      activeTool="pan"
      activeAnnotationType="P"
      onSelectTool={() => {}}
      onSelectAnnotationType={(type) => {
        calls.push(type);
      }}
      onDeleteAnnotation={() => {}}
    />,
  );

  // Click each PQRST button; the toolbar text contains "(Ctrl+N)" keyboard
  // hints — the regex match tolerates either with or without that suffix.
  fireEvent.click(screen.getByText(/标注 P 波/));
  fireEvent.click(screen.getByText(/标注 QRS/));
  fireEvent.click(screen.getByText(/标注 T 波/));

  assert.deepEqual(calls, ['P', 'R', 'T']);
});
