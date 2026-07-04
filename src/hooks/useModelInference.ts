import { useCallback, useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import { InferenceResult, ModelPrediction } from '../types';

interface UseModelInferenceOptions {
  modelUrl?: string;
  autoLoad?: boolean;
  useWorker?: boolean;
}

interface UseModelInferenceReturn {
  isLoading: boolean;
  isLoaded: boolean;
  error: string | null;
  loadModel: (url?: string) => Promise<void>;
  predict: (signal: number[][]) => Promise<ModelPrediction[]>;
  predictWithHeatmap: (signal: number[][]) => Promise<InferenceResult>;
  dispose: () => void;
  getModelInfo: () => { name: string; loaded: boolean };
}

const MODEL_CACHE_PREFIX = 'indexeddb://ecg-hook-model-';
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

  const modelRef = useRef<tf.LayersModel | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Track which backend currently owns inference. Without this, a Worker load
  // failure that triggers a successful IndexedDB fallback leaves `workerRef`
  // non-null — `predict` would keep routing through the broken Worker even
  // though `modelRef` is now populated from the cache.
  const activeBackendRef = useRef<ActiveBackend>(null);
  const modelUrlRef = useRef(modelUrl);

  const getCacheKey = useCallback((url: string) => {
    return `${MODEL_CACHE_PREFIX}${encodeURIComponent(url)}`;
  }, []);

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

  const loadModel = useCallback(async (url?: string) => {
    const modelUrlToLoad = url || modelUrlRef.current;
    modelUrlRef.current = modelUrlToLoad;

    setIsLoading(true);
    setError(null);
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
      } else {
        modelRef.current = await tf.loadLayersModel(modelUrlToLoad);
        await cacheModel(modelRef.current, modelUrlToLoad);
        activeBackendRef.current = 'main';
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
        // A successful fallback is not an error — clear any stale error so
        // the UI does not show "Failed to load model" alongside a working
        // cached model. We still log so offline recoveries leave a trace.
        setError(null);
        console.info('[useModelInference] Worker load failed; using cached model from IndexedDB.');
      } else {
        setError(outcome.errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }, [cacheModel, loadFromCache, useWorker]);

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

    const inputTensor = tf.tensor3d([signal]);
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
    const lead = signal[0] || [];
    const max = Math.max(...lead.map((value) => Math.abs(value)), 1);

    return {
      predictions,
      inferenceTime: performance.now() - startTime,
      heatmap: [lead.map((value) => Math.abs(value) / max)],
    };
  }, [predict]);

  const dispose = useCallback(() => {
    modelRef.current?.dispose();
    modelRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    activeBackendRef.current = null;
    setIsLoaded(false);
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
    loadModel,
    predict,
    predictWithHeatmap,
    dispose,
    getModelInfo,
  };
}

export default useModelInference;