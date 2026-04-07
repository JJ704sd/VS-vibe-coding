import { createSelector } from '@reduxjs/toolkit';
import { RootState } from './index';
import { Annotation, ModelPrediction } from '../types';

// Base selectors
const selectECGState = (state: RootState) => state.ecg;

export const selectCurrentRecordId = createSelector(
  selectECGState,
  (ecg) => ecg.currentRecordId
);

export const selectAnnotations = createSelector(
  selectECGState,
  (ecg) => ecg.annotations
);

export const selectAnnotationCount = createSelector(
  selectAnnotations,
  (annotations) => annotations.length
);

export const selectAnnotationsByType = createSelector(
  selectAnnotations,
  (annotations) => {
    const byType: Record<string, Annotation[]> = {};
    for (const ann of annotations) {
      if (!byType[ann.type]) byType[ann.type] = [];
      byType[ann.type].push(ann);
    }
    return byType;
  }
);

export const selectRPeakAnnotations = createSelector(
  selectAnnotations,
  (annotations) => annotations.filter((a) => a.type === 'R')
);

export const selectCanvasState = createSelector(
  selectECGState,
  (ecg) => ecg.canvas
);

export const selectCanvasZoom = createSelector(
  selectCanvasState,
  (canvas) => canvas.zoom
);

export const selectCanvasPan = createSelector(
  selectCanvasState,
  (canvas) => ({ panX: canvas.panX, panY: canvas.panY })
);

export const selectModelLoading = createSelector(
  selectECGState,
  (ecg) => ecg.modelLoading
);

export const selectModelLoaded = createSelector(
  selectECGState,
  (ecg) => ecg.modelLoaded
);

export const selectInferenceResults = createSelector(
  selectECGState,
  (ecg) => ecg.inferenceResults
);

export const selectTopPrediction = createSelector(
  selectInferenceResults,
  (results) => results.length > 0 ? results[0] : null
);

export const selectSignalProcessing = createSelector(
  selectECGState,
  (ecg) => ecg.signalProcessing
);

export const selectError = createSelector(
  selectECGState,
  (ecg) => ecg.error
);

// Combined selectors for commonly used data
export const selectModelStatus = createSelector(
  [selectModelLoading, selectModelLoaded],
  (loading, loaded) => ({ loading, loaded })
);

export const selectAnnotationStats = createSelector(
  selectAnnotations,
  (annotations) => ({
    total: annotations.length,
    rPeaks: annotations.filter((a) => a.type === 'R').length,
    manual: annotations.filter((a) => a.manual).length,
    auto: annotations.filter((a) => !a.manual).length,
  })
);
