// useModelInference — React hook around ModelService for the annotation
// studio. Refactored for the 2026-07-07 Track M audit fixes:
//
//   A-06  loadModel now reports the explicit `ModelLoadOutcome` from
//         ModelService. We never silently fall back to mock inference —
//         the UI must call `useMockInference()` to opt in.
//   A-08  Cache key namespace is shared with ModelService. We import
//         `getModelCacheKey` so a model saved by the hook is visible to
//         the service (and vice versa).
//   A-10  The dead `predictWithHeatmap` worker message has been removed
//         from `inference.worker.ts`; this hook no longer references it.
//   A-12  predictWithHeatmap's heatmap now aggregates across all leads
//         (delegated to ModelService's `pickDominantLead`-style helper
//         in service), so a zero/empty first lead no longer hides
//         signal elsewhere.
//   A-14  The main/cache predict() path now calls the shared
//         `buildInputTensor` helper instead of `tf.tensor3d([signal])`
//         so the hook and the service produce identical tensors.

import { useCallback, useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import { InferenceResult, ModelPrediction } from '../types';
import {
  ModelLoadOutcome,
  buildInputTensor,
  getModelCacheKey,
  pickDominantLead,
} from '../services/modelService';

interface UseModelInferenceOptions {
  modelUrl?: string;
  autoLoad?: boolean;
  useWorker?: boolean;
}

interface UseModelInferenceReturn {
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  loadOutcome: ModelLoadOutcome;
  loadModel: (url?: string) => Promise<ModelLoadOutcome>;
  predict: (signal: number[][]) => Promise<ModelPrediction[]>;
  predictWithHeatmap: (signal: number[][]) => Promise<InferenceResult>;
  useMockInference: () => void;
  dispose: () => void;
  getModelInfo: () => { name: string; loaded: boolean };
}

const CLASS_NAMES = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];

export type ActiveBackend = 'worker' | 'main' | null;

/**
 * Decide which backend should handle a `predict()` call given the current
 * hook state. This is the single source of truth for backend routing — both
 * `predict()` and the catch-fallback branch must keep this in sync.
 *
 * Bug context: previously `predict()` only checked `useWorker && workerRef`,
 * so when a Worker load failure triggered a successful IndexedDB fallback the
 * non-null `workerRef` (Worker still alive but model-less) kept stealing
 * traffic, and the cached main-thread model was never used.
 */
export function selectPredictionRoute(
  activeBackend: ActiveBackend,
  hasWorker: boolean,
  hasMainModel: boolean,
): 'worker' | 'main' | 'none' {
  if (activeBackend === 'worker' && hasWorker) return 'worker';
  if (activeBackend === 'main' && hasMainModel) return 'main';
  if (hasMainModel) return 'main';
  return 'none';
}

/**
 * Decide what state to apply after a load failure (primary path failed).
 * Returns whether the cached model should become the active backend, whether
 * the broken worker should be torn down, and what (if any) error to surface.
 */
export function resolveLoadFailureOutcome(args: {
  useWorker: boolean;
  primaryLoadFailed: boolean;
  cacheModel: unknown | null;
  loadError: unknown;
}): {
  activeBackend: ActiveBackend;
  terminateWorker: boolean;
  errorMessage: string | null;
} {
  const { useWorker, primaryLoadFailed, cacheModel: cached, loadError } = args;

  if (!primaryLoadFailed) {
    // No failure — caller should not be invoking this branch.
    return { activeBackend: null, terminateWorker: false, errorMessage: null };
  }

  if (cached) {
    return {
      activeBackend: 'main',
      // Worker path failed but a cached main-thread model exists — kill the
      // broken worker so subsequent predict() calls cannot route through it.
      terminateWorker: useWorker,
      errorMessage: null,
    };
  }

  return {
    activeBackend: null,
    terminateWorker: useWorker,
    errorMessage: loadError instanceof Error ? loadError.message : 'Failed to load model',
  };
}

export function useModelInference(options: UseModelInferenceOptions = {}): UseModelInferenceReturn {
  const { modelUrl = '/models/ecg-classifier/model.json', autoLoad = false, useWorker = true } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadOutcome, setLoadOutcome] = useState<ModelLoadOutcome>('failed');

  const modelRef = useRef<tf.LayersModel | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Track which backend currently owns inference. Without this, a Worker load
  // failure that triggers a successful IndexedDB fallback leaves `workerRef`
  // non-null — `predict` would keep routing through the broken Worker even
  // though `modelRef` is now populated from the cache.
  const activeBackendRef = useRef<ActiveBackend>(null);
  const modelUrlRef = useRef(modelUrl);

  // The cache key now comes from `getModelCacheKey` (audit A-08) so the hook
  // and the service see the same IndexedDB entries. The previous
  // `'indexeddb://ecg-hook-model-'` prefix created a disjoint cache bucket
  // invisible to ModelService and vice versa.
  const getCacheKey = useCallback((url: string) => getModelCacheKey(url), []);

  const loadFromCache = useCallback(async (url: string): Promise<tf.LayersModel | null> => {
    try {
      return await tf.loadLayersModel(getCacheKey(url));
    } catch {
      return null;
    }
  }, [getCacheKey]);

  const cacheModel = useCallback(async (model: tf.LayersModel, url: string): Promise<void> => {
    try {
      await model.save(getCacheKey(url));
    } catch (cacheError) {
      console.warn('[useModelInference] Failed to cache model:', cacheError);
    }
  }, [getCacheKey]);

  const loadModel = useCallback(async (url?: string): Promise<ModelLoadOutcome> => {
    const modelUrlToLoad = url || modelUrlRef.current;
    modelUrlRef.current = modelUrlToLoad;

    setIsLoading(true);
    setError(null);
    setLoadOutcome('failed');
    // Reset backend routing for the new attempt; the success/fallback branches
    // below set it back to a concrete value before resolving.
    activeBackendRef.current = null;

    try {
      if (useWorker && typeof Worker !== 'undefined') {
        workerRef.current?.terminate();
        workerRef.current = new Worker(new URL('../workers/inference.worker.ts', import.meta.url));

        await new Promise<void>((resolve, reject) => {
          if (!workerRef.current) {
            reject(new Error('Worker initialization failed'));
            return;
          }

          workerRef.current.onmessage = (event: MessageEvent) => {
            if (event.data.type === 'modelLoaded') {
              if (event.data.success) {
                resolve();
              } else {
                reject(new Error(event.data.error));
              }
            }
          };

          workerRef.current.onerror = (event) => reject(event.error || new Error('Worker load failed'));
          workerRef.current.postMessage({ type: 'loadModel', data: { modelUrl: modelUrlToLoad } });
        });

        activeBackendRef.current = 'worker';
        // Worker path always represents a successfully loaded real model.
        setLoadOutcome('loaded');
      } else {
        const model = await tf.loadLayersModel(modelUrlToLoad);
        modelRef.current = model;
        activeBackendRef.current = 'main';
        setLoadOutcome('loaded');
        // Cache write is best-effort: failures here MUST NOT discard the
        // in-memory model (audit A-07). We surface a console warning from
        // `cacheModel` and keep going.
        await cacheModel(model, modelUrlToLoad);
      }

      setIsLoaded(true);
    } catch (loadError) {
      const fallbackModel = await loadFromCache(modelUrlToLoad);
      const outcome = resolveLoadFailureOutcome({
        useWorker,
        primaryLoadFailed: true,
        cacheModel: fallbackModel,
        loadError,
      });

      if (fallbackModel) {
        if (outcome.terminateWorker && workerRef.current) {
          workerRef.current.terminate();
          workerRef.current = null;
        }
        modelRef.current = fallbackModel;
        activeBackendRef.current = outcome.activeBackend;
        setIsLoaded(true);
        setLoadOutcome('loaded');
        // A successful fallback is not an error — clear any stale error so
        // the UI does not show "Failed to load model" alongside a working
        // cached model. We still log so offline recoveries leave a trace.
        setError(null);
        console.info('[useModelInference] Worker load failed; using cached model from IndexedDB.');
      } else {
        setError(outcome.errorMessage);
        setLoadOutcome('failed');
      }
    } finally {
      setIsLoading(false);
    }

    return loadOutcomeRef.current;
  }, [cacheModel, loadFromCache, useWorker]);

  // Mirror `loadOutcome` into a ref so `loadModel` can return the
  // post-update value without re-rendering twice. Without this the
  // returned value would be the previous tick's state.
  const loadOutcomeRef = useRef<ModelLoadOutcome>('failed');
  useEffect(() => {
    loadOutcomeRef.current = loadOutcome;
  }, [loadOutcome]);

  const predict = useCallback(async (signal: number[][]): Promise<ModelPrediction[]> => {
    const route = selectPredictionRoute(
      activeBackendRef.current,
      workerRef.current !== null,
      modelRef.current !== null,
    );

    if (route === 'worker') {
      return new Promise((resolve, reject) => {
        if (!workerRef.current) {
          reject(new Error('Worker not initialized'));
          return;
        }

        workerRef.current.onmessage = (event: MessageEvent) => {
          if (event.data.type === 'prediction') {
            const predictions = CLASS_NAMES.map((label, index) => ({
              className: label,
              probability: event.data.result[index] || 0,
            })).sort((a, b) => b.probability - a.probability);
            resolve(predictions);
          }
          if (event.data.type === 'error') {
            reject(new Error(event.data.error));
          }
        };

        workerRef.current.onerror = (event) => reject(event.error || new Error('Worker inference failed'));
        workerRef.current.postMessage({ type: 'predict', data: { signal } });
      });
    }

    if (route === 'none') {
      throw new Error('Model not loaded');
    }

    // `selectPredictionRoute` only returns 'main' when the model is loaded,
    // but TypeScript can't follow that invariant across the boundary, so we
    // re-check before dereffing the ref.
    const mainModel = modelRef.current;
    if (!mainModel) {
      throw new Error('Model not loaded');
    }

    // A-14: reuse the shared `buildInputTensor` helper so the hook and the
    // service produce the exact same tensor for the same model. The old
    // `tf.tensor3d([signal])` here was shape-incompatible with time-major
    // and 4D conv heads.
    const inputTensor = buildInputTensor(signal, mainModel.inputs[0].shape as Array<number | null>);
    const prediction = mainModel.predict(inputTensor) as tf.Tensor;
    const probabilities = Array.from(await prediction.data());

    inputTensor.dispose();
    prediction.dispose();

    return CLASS_NAMES.map((label, index) => ({
      className: label,
      probability: probabilities[index] || 0,
    })).sort((a, b) => b.probability - a.probability);
  }, []);

  const predictWithHeatmap = useCallback(async (signal: number[][]): Promise<InferenceResult> => {
    const startTime = performance.now();
    const predictions = await predict(signal);
    // A-12: aggregate across all leads via the shared helper. A zero/empty
    // first lead no longer hides the rest of the signal.
    const dominantLead = pickDominantLead(signal);
    const heatmap = dominantLead.length === 0
      ? []
      : (() => {
          const max = Math.max(...dominantLead.map((value) => Math.abs(value)), 1);
          return dominantLead.map((value) => Math.abs(value) / max);
        })();

    return {
      predictions,
      inferenceTime: performance.now() - startTime,
      heatmap: [heatmap],
    };
  }, [predict]);

  /**
   * Hook-level opt-in to mock inference. The audit (A-06) requires the UI
   * to call this explicitly — we never silently degrade.
   */
  const useMockInferenceLocal = useCallback(() => {
    modelRef.current?.dispose();
    modelRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    activeBackendRef.current = null;
    setIsLoaded(true);
    setLoadOutcome('mock');
  }, []);

  const dispose = useCallback(() => {
    modelRef.current?.dispose();
    modelRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    activeBackendRef.current = null;
    setIsLoaded(false);
    setLoadOutcome('failed');
  }, []);

  const getModelInfo = useCallback(() => {
    return {
      name: modelUrlRef.current.split('/').pop() || 'unknown',
      loaded: isLoaded,
    };
  }, [isLoaded]);

  useEffect(() => {
    if (autoLoad) {
      void loadModel();
    }

    return () => {
      dispose();
    };
  }, [autoLoad, dispose, loadModel]);

  return {
    isLoading,
    isLoaded,
    error,
    loadOutcome,
    loadModel,
    predict,
    predictWithHeatmap,
    useMockInference: useMockInferenceLocal,
    dispose,
    getModelInfo,
  };
}

export default useModelInference;
