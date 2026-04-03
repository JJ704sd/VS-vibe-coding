import { configureStore } from '@reduxjs/toolkit';
import ecgReducer from './ecgSlice';
import caseReducer from './caseSlice';

export const store = configureStore({
  reducer: {
    ecg: ecgReducer,
    cases: caseReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: ['ecg/setInferenceResults'],
        ignoredPaths: ['ecg.inferenceResults'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;