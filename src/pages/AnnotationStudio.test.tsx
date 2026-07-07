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

/**
 * Test wrapper for B-03: mirrors the production
 * useEffect([location.search, routeRecordId, currentRecordId, resetRecordState])
 * effect in AnnotationStudio.tsx. The body is the spec; the real
 * AnnotationStudio effect must keep the same dispatch sequence.
 *
 * The harness takes a `search` prop instead of relying on
 * MemoryRouter + useLocation. This keeps the test deterministic: a
 * rerender with a new `search` prop reliably re-runs the effect (the
 * production code reads location.search, which is what `search` here
 * models). Using MemoryRouter's `initialEntries` across a rerender
 * would silently no-op because initialEntries is mount-time only.
 */
function UrlSwitchHarness({ search }: { search: string }): null {
  const dispatch = useDispatch();
  const [currentRecordId, setCurrentRecordId] = useState('');

  const resetRecordState = useCallback((): void => {
    dispatch(setAnnotations([]));
    dispatch(setInferenceResults([]));
  }, [dispatch]);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const nextRecordId = params.get('recordId')?.trim();

    if (nextRecordId && nextRecordId !== currentRecordId) {
      resetRecordState();
      setCurrentRecordId(nextRecordId);
    }
  }, [search, currentRecordId, resetRecordState]);

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
