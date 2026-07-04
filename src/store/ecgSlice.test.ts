// Regression coverage for the Redux ecg slice — specifically the annotation
// lifecycle that AnnotationStudio relies on when importing a new record.
//
// These tests do not touch Fabric.js or the DOM; they just exercise the
// reducer so that the rules "setAnnotations([]) wipes everything" and
// "removeAnnotation only removes by id" stay guaranteed even if someone
// later optimises the reducer with Immer helpers.
//
// Why this exists:
//   AnnotationStudio.applyImportedLeads dispatches setAnnotations([]) so
//   the ECGCanvas's useEffect([annotations]) will re-render zero circles
//   when a new record is loaded. Before the BUG #1 fix, the annotations
//   array was never cleared on import, which left stale annotation circles
//   on the canvas and stale annotation rows in the exported JSON / CSV.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import ecgReducer, {
  addAnnotation,
  removeAnnotation,
  setAnnotations,
  setCanvasState,
  clearECG,
  setInferenceResults,
  setModelLoaded,
} from './ecgSlice.ts';
import type { Annotation } from '../types/index.ts';

function buildAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: `ann_${Math.random().toString(36).slice(2)}`,
    type: 'P',
    position: 250,
    confidence: 1,
    manual: true,
    timestamp: 1700000000000,
    ...overrides,
  };
}

test('setAnnotations replaces the entire annotation array (used on import)', () => {
  const previous = [buildAnnotation({ id: 'ann_old_1' }), buildAnnotation({ id: 'ann_old_2' })];

  const next = ecgReducer({ annotations: previous } as never, setAnnotations([]));

  assert.equal(next.annotations.length, 0);
});

test('setAnnotations does NOT mutate the previous array reference (Immer safety)', () => {
  const previous = [buildAnnotation({ id: 'ann_keep' })];
  const snapshot = previous.slice();

  ecgReducer({ annotations: previous } as never, setAnnotations([buildAnnotation({ id: 'ann_new' })]));

  // Reducer must not push to the original array; React-Redux equality check
  // relies on this. Immer guarantees this, but we assert explicitly because
  // a regression here would silently break re-render memoisation.
  assert.deepEqual(previous, snapshot);
  assert.equal(previous.length, 1);
});

test('addAnnotation appends a single annotation without disturbing existing ones', () => {
  const initial = [buildAnnotation({ id: 'ann_keep' })];
  const incoming = buildAnnotation({ id: 'ann_new', type: 'R', position: 800 });

  const next = ecgReducer({ annotations: initial } as never, addAnnotation(incoming));

  assert.equal(next.annotations.length, 2);
  assert.equal(next.annotations[1].id, 'ann_new');
  assert.equal(next.annotations[1].type, 'R');
});

test('removeAnnotation drops the annotation matching the id and preserves others', () => {
  const initial = [
    buildAnnotation({ id: 'ann_keep' }),
    buildAnnotation({ id: 'ann_drop', type: 'R' }),
  ];

  const next = ecgReducer({ annotations: initial } as never, removeAnnotation('ann_drop'));

  assert.equal(next.annotations.length, 1);
  assert.equal(next.annotations[0].id, 'ann_keep');
});

test('removeAnnotation is a no-op when the id does not match', () => {
  const initial = [buildAnnotation({ id: 'ann_keep' })];
  const next = ecgReducer({ annotations: initial } as never, removeAnnotation('ann_missing'));

  assert.equal(next.annotations.length, 1);
  assert.equal(next.annotations[0].id, 'ann_keep');
});

test('clearECG resets annotations, canvas state, model flags, and inference results', () => {
  const populated = {
    currentRecordId: 'rec_1',
    annotations: [buildAnnotation({ id: 'ann_keep' })],
    canvas: {
      zoom: 2.5,
      panX: 100,
      panY: -50,
      selectedLead: 'II',
      selectedAnnotation: null,
    },
    modelLoading: false,
    modelLoaded: true,
    inferenceResults: [
      { className: 'Normal', probability: 0.7 },
    ],
    signalProcessing: { filtering: false, normalizing: false },
    error: null,
  };

  const next = ecgReducer(populated as never, clearECG());

  assert.equal(next.annotations.length, 0);
  assert.equal(next.modelLoaded, false);
  assert.equal(next.inferenceResults.length, 0);
  assert.equal(next.canvas.zoom, 1);
  assert.equal(next.canvas.panX, 0);
  assert.equal(next.canvas.panY, 0);
});

test('setCanvasState merges partial canvas fields without dropping others', () => {
  const initial = {
    canvas: {
      zoom: 1,
      panX: 0,
      panY: 0,
      selectedLead: 'I',
      selectedAnnotation: null,
    },
  };

  const next = ecgReducer(initial as never, setCanvasState({ zoom: 2 }));

  assert.equal(next.canvas.zoom, 2);
  assert.equal(next.canvas.panX, 0);
  assert.equal(next.canvas.selectedLead, 'I');
});

test('setInferenceResults replaces the array; addAnnotation does not touch it', () => {
  const initial = {
    annotations: [buildAnnotation({ id: 'ann_keep' })],
    inferenceResults: [{ className: 'Old', probability: 0.4 }],
  };

  const nextA = ecgReducer(initial as never, setInferenceResults([{ className: 'New', probability: 0.9 }]));
  assert.equal(nextA.inferenceResults.length, 1);
  assert.equal(nextA.inferenceResults[0].className, 'New');

  const nextB = ecgReducer(initial as never, addAnnotation(buildAnnotation({ id: 'ann_new' })));
  assert.equal(nextB.inferenceResults.length, 1);
  assert.equal(nextB.inferenceResults[0].className, 'Old');
});

test('setModelLoaded is independently writable from annotations', () => {
  const initial = {
    annotations: [buildAnnotation({ id: 'ann_keep' })],
    modelLoaded: false,
  };

  const next = ecgReducer(initial as never, setModelLoaded(true));

  assert.equal(next.modelLoaded, true);
  assert.equal(next.annotations.length, 1);
});