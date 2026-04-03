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

export function useModelInference(options: UseModelInferenceOptions = {}): UseModelInferenceReturn {
  const { modelUrl = '/models/ecg-classifier/model.json', autoLoad = false, useWorker = true } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const modelRef = useRef<tf.LayersModel | null>(null);
  const workerRef = useRef<Worker | null>(null);
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
      } else {
        modelRef.current = await tf.loadLayersModel(modelUrlToLoad);
        await cacheModel(modelRef.current, modelUrlToLoad);
      }

      setIsLoaded(true);
    } catch (loadError) {
      const fallbackModel = await loadFromCache(modelUrlToLoad);
      if (fallbackModel) {
        modelRef.current = fallbackModel;
        setIsLoaded(true);
        setError('Loaded cached model');
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load model');
      }
    } finally {
      setIsLoading(false);
    }
  }, [cacheModel, loadFromCache, useWorker]);

  const predict = useCallback(async (signal: number[][]): Promise<ModelPrediction[]> => {
    if (useWorker && workerRef.current) {
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

    if (!modelRef.current) {
      throw new Error('Model not loaded');
    }

    const inputTensor = tf.tensor3d([signal]);
    const prediction = modelRef.current.predict(inputTensor) as tf.Tensor;
    const probabilities = Array.from(await prediction.data());

    inputTensor.dispose();
    prediction.dispose();

    return CLASS_NAMES.map((label, index) => ({
      className: label,
      probability: probabilities[index] || 0,
    })).sort((a, b) => b.probability - a.probability);
  }, [useWorker]);

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
