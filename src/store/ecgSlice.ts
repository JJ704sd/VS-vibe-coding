import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Annotation, ModelPrediction, CanvasState } from '../types';

interface ECGState {
  currentRecordId: string | null;
  annotations: Annotation[];
  canvas: CanvasState;
  modelLoading: boolean;
  modelLoaded: boolean;
  inferenceResults: ModelPrediction[];
  signalProcessing: {
    filtering: boolean;
    normalizing: boolean;
  };
  error: string | null;
}

const initialState: ECGState = {
  currentRecordId: null,
  annotations: [],
  canvas: {
    zoom: 1,
    panX: 0,
    panY: 0,
    selectedLead: null,
    selectedAnnotation: null,
  },
  modelLoading: false,
  modelLoaded: false,
  inferenceResults: [],
  signalProcessing: {
    filtering: false,
    normalizing: false,
  },
  error: null,
};

const ecgSlice = createSlice({
  name: 'ecg',
  initialState,
  reducers: {
    setCurrentRecord: (state, action: PayloadAction<string | null>) => {
      state.currentRecordId = action.payload;
    },
    setAnnotations: (state, action: PayloadAction<Annotation[]>) => {
      state.annotations = action.payload;
    },
    addAnnotation: (state, action: PayloadAction<Annotation>) => {
      state.annotations.push(action.payload);
    },
    updateAnnotation: (state, action: PayloadAction<Annotation>) => {
      const index = state.annotations.findIndex(a => a.id === action.payload.id);
      if (index !== -1) {
        state.annotations[index] = action.payload;
      }
    },
    removeAnnotation: (state, action: PayloadAction<string>) => {
      state.annotations = state.annotations.filter(a => a.id !== action.payload);
    },
    setCanvasState: (state, action: PayloadAction<Partial<CanvasState>>) => {
      state.canvas = { ...state.canvas, ...action.payload };
    },
    resetCanvas: (state) => {
      state.canvas = initialState.canvas;
    },
    setModelLoading: (state, action: PayloadAction<boolean>) => {
      state.modelLoading = action.payload;
    },
    setModelLoaded: (state, action: PayloadAction<boolean>) => {
      state.modelLoaded = action.payload;
    },
    setInferenceResults: (state, action: PayloadAction<ModelPrediction[]>) => {
      state.inferenceResults = action.payload;
    },
    setSignalProcessing: (state, action: PayloadAction<Partial<ECGState['signalProcessing']>>) => {
      state.signalProcessing = { ...state.signalProcessing, ...action.payload };
    },
    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    clearECG: (state) => {
      return { ...initialState };
    },
  },
});

export const {
  setCurrentRecord,
  setAnnotations,
  addAnnotation,
  updateAnnotation,
  removeAnnotation,
  setCanvasState,
  resetCanvas,
  setModelLoading,
  setModelLoaded,
  setInferenceResults,
  setSignalProcessing,
  setError,
  clearECG,
} = ecgSlice.actions;

export default ecgSlice.reducer;