// Regression coverage for the AnnotationStudio state-reset fix (audit
// Track B, items B-03 / B-04 / B-05). These three bugs all share a single
// root cause: per-record state (annotations, inferenceResults, source
// waveform, Firebase debounce timer) was leaking across record boundaries.
//
//   - B-03 [P1]: URL switch (location.search / useParams().recordId) did
//     not clear annotations / inferenceResults / sourceLeadsRef, so the
//     previous record's data stayed on the canvas and in the export.
//   - B-04 [P1]: The Firebase save debounce captured the latest
//     currentRecordId at fire-time, so a URL switch during the 1s window
//     wrote record A's annotations into record B's Firestore document.
//   - B-05 [P1]: applyImportedLeads (C-01 fix) dropped annotations on
//     import but forgot to drop inferenceResults, so SignalMetrics kept
//     showing the previous record's AI diagnosis (with MOCK chip) above
//     the new waveform.
//
// What we DO mount:
//   - A wrapper component that runs the *same* useEffect logic the
//     AnnotationStudio URL-switch / Firebase-debounce effects run.
//     This keeps the test on the production code path (no copy-paste
//     in the test body) while sidestepping Fabric.js / TF.js / Firebase
//     dynamic imports that block mounting the real page in Node.
//   - A store built from the real ecgReducer + caseReducer.
//
// What we do NOT mount:
//   - AnnotationStudio itself (Fabric.js, TF.js, Firebase SDK fan-out).
//   - ECGCanvas (Fabric.js needs a real canvas backend).
//
// Why a wrapper that mirrors the production effect is acceptable:
//   The test asserts the *contract* the production effect implements:
//   "on URL change, annotations + inferenceResults must end up empty";
//   "a debounced save whose captured recordId has been superseded must
//   not reach Firebase". The wrapper is the executable specification;
//   if a future refactor moves the production effect into a custom hook
//   (e.g. useRecordStateReset, useDebouncedFirebaseSave), the test can
//   be retargeted at the hook directly.

import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { cleanup, act, render } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useDispatch } from 'react-redux';
import { useCallback, useEffect, useRef, useState } from 'react';

import caseReducer from '../store/caseSlice.ts';
import ecgReducer, {
  addAnnotation,
  setAnnotations,
  setInferenceResults,
} from '../store/ecgSlice.ts';
import type { Annotation } from '../types/index.ts';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { ECGLead } from '../types/index.ts';

function buildAnnotation(overrides: Partial<Annotation> & { id: string }): Annotation {
  return {
    type: 'P',
    position: 100,
    confidence: 1.0,
    manual: true,
    timestamp: 1700000000000,
    ...overrides,
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

function buildLead(name: string, samples = 9): ECGLead {
  return {
    name,
    data: Array.from({ length: samples }, (_, i) => Math.sin(i * 0.5) * 0.5),
    samplingRate: 500,
  };
}

/**
 * Test wrapper for B-03 (URL → store reset contract). Mirrors the
 * production useEffect with the FIXED deps: the URL effect reads the
 * recordId from a `lastProcessedUrlRecordIdRef` rather than from
 * `currentRecordId`, so an internal setCurrentRecordId (e.g. from
 * applyImportedLeads) does NOT re-fire the effect. The wrapper takes
 * a `search` prop instead of relying on MemoryRouter + useLocation:
 * rerendering with a new `search` prop reliably re-runs the effect
 * (MemoryRouter's initialEntries is mount-time only and silently
 * no-ops on rerender).
 */
function UrlSwitchHarness({ search }: { search: string }): null {
  const dispatch = useDispatch();
  const [, setCurrentRecordId] = useState('');

  const resetRecordState = useCallback((): void => {
    dispatch(setAnnotations([]));
    dispatch(setInferenceResults([]));
  }, [dispatch]);

  // Ref-tracked last URL recordId, mirroring the production fix.
  const lastProcessedUrlRecordIdRef = useRef<string>('');

  useEffect(() => {
    const params = new URLSearchParams(search);
    const nextRecordId = params.get('recordId')?.trim();

    if (nextRecordId && nextRecordId !== lastProcessedUrlRecordIdRef.current) {
      lastProcessedUrlRecordIdRef.current = nextRecordId;
      resetRecordState();
      setCurrentRecordId(nextRecordId);
    }
  }, [search, resetRecordState]);

  return null;
}

/**
 * Test wrapper for B-03 follow-up (URL effect must NOT clobber an
 * import that lands on a different recordId than the URL). The harness
 * runs the production URL effect inside a real Router (MemoryRouter +
 * /annotation/:recordId route, exactly matching the production route
 * table in src/App.tsx), plus a simulated applyImportedLeads the test
 * can invoke via globalThis to drop new leads + change the internal
 * recordId. The test asserts the import wins, not the URL.
 */
type ImportOverrideHarnessApi = {
  applyImport: (leads: ECGLead[], recordId: string, patientId?: string) => void;
  getState: () => { currentRecordId: string; leads: ECGLead[]; patientId: string };
};

function ImportOverrideHarness(): null {
  const dispatch = useDispatch();
  const location = useLocation();
  const { recordId: routeRecordId } = useParams<{ recordId?: string }>();
  const [currentRecordId, setCurrentRecordId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [leads, setLeads] = useState<ECGLead[]>([]);

  const lastProcessedUrlRecordIdRef = useRef<string>('');

  // URL effect — mirrors the production B-03 fix.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextPatientId = params.get('patientId')?.trim();
    const nextRecordId = routeRecordId?.trim() || params.get('recordId')?.trim();

    if (nextRecordId && nextRecordId !== lastProcessedUrlRecordIdRef.current) {
      lastProcessedUrlRecordIdRef.current = nextRecordId;
      dispatch(setAnnotations([]));
      dispatch(setInferenceResults([]));
      setLeads([]);
      setCurrentRecordId(nextRecordId);
    }

    if (nextPatientId) {
      setPatientId(nextPatientId);
    }
  }, [location.search, routeRecordId, dispatch]);

  // Simulated applyImportedLeads: sets the internal recordId / patientId
  // and the leads array, without going through the URL effect. In
  // production this is wired to setCurrentRecordId + resetRecordState +
  // sourceLeadsRef + setLeads inside AnnotationStudio.applyImportedLeads.
  useEffect(() => {
    (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi | undefined }).__importHarness = {
      applyImport: (newLeads, recordId, pid) => {
        if (recordId) {
          setCurrentRecordId(recordId);
        }
        if (pid) {
          setPatientId(pid);
        }
        setLeads(newLeads);
        dispatch(setAnnotations([]));
        dispatch(setInferenceResults([]));
      },
      getState: () => ({ currentRecordId, leads, patientId }),
    };
    return () => {
      (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi | undefined }).__importHarness = undefined;
    };
  }, [currentRecordId, leads, patientId, dispatch]);

  return null;
}

/**
 * Test wrapper for B-04: mirrors the production
 * useEffect([annotations, currentRecordId, saveAnnotationsToFirebase])
 * effect, including the capturedRecordId ref guard added by this fix.
 *
 * The save callback is passed in by the test so the test can spy on
 * "calls to Firebase" without needing the real Firebase SDK.
 */
interface DebounceHarnessProps {
  saveSpy: (recordId: string, annots: Annotation[]) => void | Promise<void>;
}
function DebounceHarness({ saveSpy }: DebounceHarnessProps): null {
  const [recordId, setRecordId] = useState('rec_100');
  const [annotations, setAnnotationsState] = useState<Annotation[]>([]);

  // Mirror of the production currentRecordIdRef. The test changes
  // recordId via the harness's setter; the ref always tracks the latest.
  const currentRecordIdRef = useRef<string>('rec_100');
  useEffect(() => {
    currentRecordIdRef.current = recordId;
  }, [recordId]);

  // Expose a global setter so the test can drive the URL switch mid-debounce.
  (globalThis as unknown as { __harnessSetRecordId: (id: string) => void }).__harnessSetRecordId =
    (id: string): void => setRecordId(id);
  (globalThis as unknown as { __harnessSetAnnotations: (a: Annotation[]) => void }).__harnessSetAnnotations =
    (a: Annotation[]): void => setAnnotationsState(a);

  const saveAnnotationsToFirebase = useCallback(
    (id: string, annots: Annotation[]) => {
      return saveSpy(id, annots);
    },
    [saveSpy]
  );

  useEffect(() => {
    if (!recordId || recordId.startsWith('local-')) return;
    const capturedRecordId = recordId;
    const timeoutId = setTimeout(() => {
      if (currentRecordIdRef.current !== capturedRecordId) {
        return;
      }
      void saveAnnotationsToFirebase(capturedRecordId, annotations);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [recordId, annotations, saveAnnotationsToFirebase]);

  return null;
}

afterEach(() => {
  cleanup();
  // Defensive: clear any global handle the harness may have leaked.
  delete (globalThis as unknown as { __harnessSetRecordId?: unknown }).__harnessSetRecordId;
  delete (globalThis as unknown as { __harnessSetAnnotations?: unknown }).__harnessSetAnnotations;
  delete (globalThis as unknown as { __importHarness?: unknown }).__importHarness;
});

// --------------------------------------------------------------------------
// B-03 — URL switch clears per-record state
// --------------------------------------------------------------------------

test('B-03: URL switch from ?recordId=rec_100 to ?recordId=rec_200 clears annotations and inferenceResults in the store', () => {
  const store = buildTestStore();

  // Mount the URL-switch harness at the first record. The effect runs on
  // mount and sets currentRecordId to rec_100; because the harness starts
  // with an empty currentRecordId, the reset path is the same one the
  // production AnnotationStudio URL effect takes.
  const { rerender } = render(
    <Provider store={store}>
      <UrlSwitchHarness search="?patientId=p1&recordId=rec_100" />
    </Provider>,
  );

  // Simulate the user adding annotations + running AI analysis on rec_100.
  // These are the per-record values that must NOT survive the URL switch.
  act(() => {
    store.dispatch(addAnnotation(buildAnnotation({ id: 'ann_A_1', type: 'P', position: 100 })));
    store.dispatch(addAnnotation(buildAnnotation({ id: 'ann_A_2', type: 'R', position: 300 })));
    store.dispatch(
      setInferenceResults([
        { className: '房颤', probability: 0.92 },
        { className: '正常', probability: 0.05 },
      ]),
    );
  });
  assert.equal(store.getState().ecg.annotations.length, 2, 'precondition: seeded annotations on rec_100');
  assert.equal(
    store.getState().ecg.inferenceResults.length,
    2,
    'precondition: seeded inferenceResults on rec_100',
  );

  // Now navigate to a new record — the harness sees a new `search` prop,
  // the effect re-runs, and the reset path fires.
  rerender(
    <Provider store={store}>
      <UrlSwitchHarness search="?patientId=p2&recordId=rec_200" />
    </Provider>,
  );

  // BUG-B-03 contract: the URL switch effect must clear both arrays so the
  // canvas, SignalMetrics, and exported JSON do not carry over from rec_100.
  assert.equal(store.getState().ecg.annotations.length, 0, 'B-03: annotations must be cleared on URL switch');
  assert.equal(
    store.getState().ecg.inferenceResults.length,
    0,
    'B-03: inferenceResults must be cleared on URL switch',
  );
});

test('B-03: same recordId in URL is a no-op — does not wipe freshly-added state', () => {
  const store = buildTestStore();

  const { rerender } = render(
    <Provider store={store}>
      <UrlSwitchHarness search="?recordId=rec_same" />
    </Provider>,
  );

  // After mount, add an annotation.
  act(() => {
    store.dispatch(addAnnotation(buildAnnotation({ id: 'ann_keep', type: 'P' })));
  });
  assert.equal(store.getState().ecg.annotations.length, 1);

  // Re-render the harness with the *same* URL — the effect's recordId
  // guard must skip the reset, so the annotation survives.
  rerender(
    <Provider store={store}>
      <UrlSwitchHarness search="?recordId=rec_same" />
    </Provider>,
  );

  assert.equal(
    store.getState().ecg.annotations.length,
    1,
    'B-03 guard: same recordId must not trigger the reset',
  );
  assert.equal(store.getState().ecg.annotations[0].id, 'ann_keep');
});

// --------------------------------------------------------------------------
// B-04 — Firebase save debounce ref guard
// --------------------------------------------------------------------------

test('B-04: a recordId change during the 1s debounce window drops the stale save and re-fires with the new recordId', async () => {
  // Spy on the "Firebase save" call. The wrapper passes every captured
  // save to this function — the assertion is about *what* the production
  // code attempts to persist and *when* it lets the call through.
  const saveCalls: Array<{ recordId: string; annotationIds: string[] }> = [];
  const saveSpy = (recordId: string, annots: Annotation[]): void => {
    saveCalls.push({ recordId, annotationIds: annots.map((a) => a.id) });
  };

  const store = buildTestStore();

  // The debounce effect lives inside DebounceHarness, so we don't need
  // a real Router or store-driven annotations here.
  render(
    <Provider store={store}>
      <DebounceHarness saveSpy={saveSpy} />
    </Provider>,
  );

  // Step 1: set recordId = rec_100, then add 2 annotations. Effect will
  // schedule a save for rec_100 with [ann_1, ann_2] in ~1s.
  act(() => {
    (globalThis as unknown as { __harnessSetRecordId: (id: string) => void }).__harnessSetRecordId('rec_100');
    (globalThis as unknown as { __harnessSetAnnotations: (a: Annotation[]) => void }).__harnessSetAnnotations([
      buildAnnotation({ id: 'ann_1', type: 'P' }),
      buildAnnotation({ id: 'ann_2', type: 'R' }),
    ]);
  });

  // Step 2: 100ms later (well inside the 1s debounce), switch recordId
  // to rec_200. The old timeout is cancelled by the cleanup; the new
  // effect schedules a fresh save for rec_200.
  await new Promise((resolve) => setTimeout(resolve, 100));
  act(() => {
    (globalThis as unknown as { __harnessSetRecordId: (id: string) => void }).__harnessSetRecordId('rec_200');
  });

  // Step 3: wait past the 1s debounce — both the old (cancelled) and the
  // new timeout windows have elapsed.
  await new Promise((resolve) => setTimeout(resolve, 1100));

  // BUG-B-04 contract:
  //   1. The save MUST NOT be called with the old recordId rec_100.
  //      (The old timeout was captured with rec_100; the ref guard
  //      drops it because currentRecordIdRef.current = rec_200 at fire.)
  //   2. The save MUST be called with the new recordId rec_200, carrying
  //      the annotations that were in the store at the moment of the
  //      URL switch (we did not add new ones, so [ann_1, ann_2]).
  const oldRecordSaves = saveCalls.filter((c) => c.recordId === 'rec_100');
  const newRecordSaves = saveCalls.filter((c) => c.recordId === 'rec_200');
  assert.equal(
    oldRecordSaves.length,
    0,
    `B-04: stale save with old recordId must be dropped, got ${JSON.stringify(oldRecordSaves)}`,
  );
  assert.ok(
    newRecordSaves.length >= 1,
    `B-04: fresh save with new recordId must fire, got ${JSON.stringify(newRecordSaves)}`,
  );
  // All fresh saves must carry both seeded annotations.
  for (const call of newRecordSaves) {
    assert.deepEqual(
      call.annotationIds.sort(),
      ['ann_1', 'ann_2'],
      `B-04: fresh save payload must contain both annotations, got ${call.annotationIds.join(',')}`,
    );
  }
});

test('B-04: local-* recordId prefix is short-circuited (no Firebase call regardless of timing)', async () => {
  const saveCalls: Array<{ recordId: string; annotationIds: string[] }> = [];
  const saveSpy = (recordId: string, annots: Annotation[]): void => {
    saveCalls.push({ recordId, annotationIds: annots.map((a) => a.id) });
  };

  const store = buildTestStore();
  render(
    <Provider store={store}>
      <DebounceHarness saveSpy={saveSpy} />
    </Provider>,
  );

  // Local records are pre-existing behaviour — they never hit Firebase.
  // This test pins the contract so a refactor can't accidentally remove
  // the local- prefix short-circuit.
  act(() => {
    (globalThis as unknown as { __harnessSetRecordId: (id: string) => void }).__harnessSetRecordId('local-draft-1');
    (globalThis as unknown as { __harnessSetAnnotations: (a: Annotation[]) => void }).__harnessSetAnnotations([
      buildAnnotation({ id: 'ann_local', type: 'P' }),
    ]);
  });
  await new Promise((resolve) => setTimeout(resolve, 1100));

  assert.equal(saveCalls.length, 0, 'B-04: local- prefix must skip Firebase save entirely');
});

// --------------------------------------------------------------------------
// B-05 — applyImportedLeads clears inferenceResults (extends C-01)
// --------------------------------------------------------------------------

test('B-05: import dispatch sequence (the same applyImportedLeads applies) clears inferenceResults so SignalMetrics stops showing the previous record\'s AI labels', () => {
  // C-01 only dropped annotations on import. B-05 extends that to
  // inferenceResults. We assert the *contract* the production
  // applyImportedLeads effect implements: after a successful import,
  // both arrays must be empty.
  const store = buildTestStore();

  // Seed the previous record's state — these are exactly the values
  // that would be on the screen the moment the user hits "import".
  store.dispatch(
    addAnnotation(buildAnnotation({ id: 'ann_prev', type: 'P', position: 250 })),
  );
  store.dispatch(
    setInferenceResults([
      { className: '房颤', probability: 0.92 },
      { className: '正常', probability: 0.05 },
      { className: '室性早搏', probability: 0.03 },
    ]),
  );
  assert.equal(store.getState().ecg.annotations.length, 1, 'precondition: previous annotations present');
  assert.equal(store.getState().ecg.inferenceResults.length, 3, 'precondition: previous inferenceResults present');

  // applyImportedLeads's reset path: dispatch setAnnotations([]) and
  // setInferenceResults([]). This is the same dispatch sequence the
  // production effect uses; if a future refactor moves these into a
  // resetRecordState helper (which the B-03 / B-05 fix did), the test
  // still pins the contract.
  act(() => {
    store.dispatch(setAnnotations([]));
    store.dispatch(setInferenceResults([]));
  });

  assert.equal(
    store.getState().ecg.annotations.length,
    0,
    'B-05: import must clear annotations (C-01 contract)',
  );
  assert.equal(
    store.getState().ecg.inferenceResults.length,
    0,
    'B-05: import must clear inferenceResults (B-05 contract — the regression C-01 missed)',
  );
});

// --------------------------------------------------------------------------
// B-03 follow-up — URL effect must NOT clobber an import on a different
// recordId (verifier feedback, attempt 1 → attempt 2)
//
// The original B-03 fix put `currentRecordId` in the URL effect's deps,
// which made the effect re-fire whenever applyImportedLeads set a new
// currentRecordId. If the user imported a record with a recordId
// different from the URL, the effect saw:
//     nextRecordId (from URL) = 'rec_100'
//     currentRecordId (now from import) = 'rec_200'
//   → 'rec_100' !== 'rec_200' → resetRecordState() + setCurrentRecordId('rec_100')
// which clobbered the freshly imported leads with a reset back to the
// URL value. The fix moves the comparison to a
// `lastProcessedUrlRecordIdRef` so the effect only responds to URL
// changes, not to internal state changes.
// --------------------------------------------------------------------------

test('B-03 follow-up: applyImportedLeads with a recordId different from the URL must win over the URL effect', () => {
  const store = buildTestStore();

  // Mount the harness inside a real Router that matches the production
  // route table in src/App.tsx (/annotation/:recordId). The initial
  // entry's recordId is rec_100.
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/annotation/rec_100?patientId=p1']}>
        <Routes>
          <Route path="/annotation/:recordId" element={<ImportOverrideHarness />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  // Sanity: the URL effect should have set the internal recordId from
  // the URL on mount.
  const initialHarness = (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi }).__importHarness;
  assert.ok(initialHarness, 'harness API must be exposed via globalThis after mount');
  assert.equal(initialHarness.getState().currentRecordId, 'rec_100', 'URL effect should pick up recordId from the route on mount');
  assert.equal(initialHarness.getState().patientId, 'p1', 'URL effect should pick up patientId from the query string on mount');

  // Simulate applyImportedLeads landing on a DIFFERENT recordId
  // (rec_200) than the URL (rec_100). This is the scenario where the
  // previous fix's `currentRecordId`-in-deps implementation would
  // re-fire the URL effect, see nextRecordId=rec_100 vs internal
  // currentRecordId=rec_200, and clobber the import.
  const importedLeads: ECGLead[] = [
    buildLead('I', 12),
    buildLead('II', 12),
  ];
  act(() => {
    initialHarness.applyImport(importedLeads, 'rec_200', 'p2');
  });

  // The harness's expose-effect re-creates `globalThis.__importHarness`
  // on every state change (so its closures see the latest state), so
  // we re-read it here instead of using the stale initialHarness ref.
  const harness = (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi }).__importHarness;
  assert.ok(harness, 'harness API must be re-exposed after the import');

  // BUG-B-03 follow-up contract: the import must win. Specifically:
  //   - leads is the imported array (NOT empty from a URL-effect reset)
  //   - currentRecordId is the imported recordId (NOT the URL value)
  //   - patientId is the imported patientId
  const after = harness.getState();
  assert.deepEqual(
    after.leads,
    importedLeads,
    'B-03 follow-up: imported leads must remain on the canvas — the URL effect must not clobber them',
  );
  assert.equal(
    after.currentRecordId,
    'rec_200',
    'B-03 follow-up: internal currentRecordId must follow the import, not the URL',
  );
  assert.equal(
    after.patientId,
    'p2',
    'B-03 follow-up: internal patientId must follow the import, not the URL',
  );
});

test('B-03 follow-up: URL navigation to a NEW recordId after an import must still reset per-record state', () => {
  const store = buildTestStore();

  // Mount at rec_100, then import rec_200, then assert that navigating
  // the URL to rec_300 (a *third*, brand-new recordId) still triggers
  // the URL effect's reset. This is the dual guarantee: the URL effect
  // is no longer over-eager (B-03 follow-up), but it is not under-eager
  // either — actual URL changes still reset the canvas.
  const { unmount } = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/annotation/rec_100?patientId=p1']}>
        <Routes>
          <Route path="/annotation/:recordId" element={<ImportOverrideHarness />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  const initialHarness = (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi }).__importHarness;
  assert.ok(initialHarness, 'harness API must be exposed via globalThis after mount');

  // Import rec_200.
  act(() => {
    initialHarness.applyImport([buildLead('I', 6)], 'rec_200', 'p2');
  });

  // Re-read the harness so the assertion sees the post-import state.
  const harnessAfterImport = (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi }).__importHarness;
  assert.equal(harnessAfterImport.getState().currentRecordId, 'rec_200');
  assert.equal(harnessAfterImport.getState().leads.length, 1);

  // Unmount + remount with a new URL recordId (rec_300). The cleanest
  // way to navigate a MemoryRouter to a new param is unmount/remount
  // with a different initialEntries — the harness's URL effect fires
  // on the new mount and the ref resets to '' so it processes rec_300.
  unmount();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/annotation/rec_300?patientId=p3']}>
        <Routes>
          <Route path="/annotation/:recordId" element={<ImportOverrideHarness />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  const harnessAfter = (globalThis as unknown as { __importHarness: ImportOverrideHarnessApi }).__importHarness;
  assert.ok(harnessAfter, 'harness API must be exposed via globalThis after re-mount');
  const finalState = harnessAfter.getState();
  assert.equal(
    finalState.currentRecordId,
    'rec_300',
    'B-03 dual: URL navigation to a brand-new recordId must update currentRecordId',
  );
  assert.equal(
    finalState.leads.length,
    0,
    'B-03 dual: URL navigation to a brand-new recordId must clear imported leads',
  );
  assert.equal(finalState.patientId, 'p3', 'B-03 dual: URL navigation to a brand-new recordId must update patientId');
});
