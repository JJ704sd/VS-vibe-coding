import * as tf from '@tensorflow/tfjs';
import { InferenceResult, ModelPrediction } from '../types';

const MODEL_CACHE_PREFIX = 'indexeddb://ecg-model-cache-';
const CLASS_NAMES = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];

class ModelService {
  private model: tf.LayersModel | null = null;
  private modelUrl = '';
  private worker: Worker | null = null;
  private useMockInference = false;

  async loadModel(modelUrl: string): Promise<void> {
    this.modelUrl = modelUrl;
    const cacheKey = this.getCacheKey(modelUrl);
    this.useMockInference = false;

    try {
      this.model = await tf.loadLayersModel(modelUrl);
      await this.model.save(cacheKey);
      this.useMockInference = false;
    } catch (error) {
      console.error('[ModelService] Failed to load remote model:', error);
      try {
        this.model = await tf.loadLayersModel(cacheKey);
        this.useMockInference = false;
      } catch (cacheError) {
        console.error('[ModelService] Failed to load cached model:', cacheError);
        this.model = null;
        this.useMockInference = true;
      }
    }
  }

  async predict(signalData: number[][]): Promise<ModelPrediction[]> {
    if (!this.model && this.useMockInference) {
      return this.mockPredict(signalData);
    }

    if (!this.model) {
      throw new Error('Model not loaded and fallback unavailable');
    }

    const inputTensor = this.buildInputTensor(signalData, this.model.inputs[0].shape);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const rawScores = Array.from(await prediction.data());
    const probabilities = this.normalizeToProbabilities(rawScores);

    inputTensor.dispose();
    prediction.dispose();

    return this.formatPrediction(probabilities);
  }

  async predictWithHeatmap(signalData: number[][]): Promise<ModelPrediction[]> {
    const results = await this.predict(signalData);
    if (results.length > 0) {
      results[0].heatmap = this.generateHeatmap(signalData);
    }
    return results;
  }

  async infer(signalData: number[][]): Promise<InferenceResult> {
    const start = performance.now();
    const predictions = await this.predict(signalData);
    return {
      predictions,
      inferenceTime: performance.now() - start,
      heatmap: [this.generateHeatmap(signalData)],
    };
  }

  async runInferenceInWorker(signalData: number[][]): Promise<ModelPrediction[]> {
    if (!this.modelUrl) {
      throw new Error('Model URL not set');
    }

    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/inference.worker.ts', import.meta.url));
      await new Promise<void>((resolve, reject) => {
        if (!this.worker) {
          reject(new Error('Worker init failed'));
          return;
        }

        this.worker.onmessage = (event) => {
          if (event.data.type === 'modelLoaded') {
            if (event.data.success) {
              resolve();
            } else {
              reject(new Error(event.data.error));
            }
          }
        };

        this.worker.onerror = (error) => reject(error);
        this.worker.postMessage({ type: 'loadModel', data: { modelUrl: this.modelUrl } });
      });
    }

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker unavailable'));
        return;
      }

      this.worker.onmessage = (event) => {
        if (event.data.type === 'prediction') {
          resolve(this.formatPrediction(event.data.result));
        }
        if (event.data.type === 'error') {
          reject(new Error(event.data.error));
        }
      };

      this.worker.onerror = (error) => reject(error);
      this.worker.postMessage({ type: 'predict', data: { signal: signalData } });
    });
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  isModelLoaded(): boolean {
    return this.model !== null || this.useMockInference;
  }

  isUsingMockInference(): boolean {
    return this.useMockInference;
  }

  getModelInfo(): { name: string; loaded: boolean } {
    return {
      name: this.modelUrl.split('/').pop() || 'unknown',
      loaded: this.isModelLoaded(),
    };
  }

  private getCacheKey(modelUrl: string): string {
    return `${MODEL_CACHE_PREFIX}${encodeURIComponent(modelUrl)}`;
  }

  private formatPrediction(result: number[]): ModelPrediction[] {
    return CLASS_NAMES.map((label, index) => ({
      className: label,
      probability: result[index] || 0,
    })).sort((a, b) => b.probability - a.probability);
  }

  private normalizeToProbabilities(scores: number[]): number[] {
    if (scores.length === 0) {
      return scores;
    }

    const hasNegative = scores.some((value) => value < 0);
    const sum = scores.reduce((acc, value) => acc + value, 0);
    const looksLikeProb = !hasNegative && sum > 0.95 && sum < 1.05;

    if (looksLikeProb) {
      return scores;
    }

    const maxScore = Math.max(...scores);
    const expScores = scores.map((value) => Math.exp(value - maxScore));
    const expSum = expScores.reduce((acc, value) => acc + value, 0);
    return expScores.map((value) => value / Math.max(expSum, 1e-6));
  }

  private isShapeCompatible(expected: number | null | undefined, actual: number): boolean {
    return expected == null || expected === -1 || expected === actual;
  }

  private buildInputTensor(signalData: number[][], inputShape: Array<number | null>): tf.Tensor {
    const samples = signalData[0]?.length || 0;
    const aligned = signalData.map((lead) => lead.slice(0, samples));

    if (inputShape.length === 3) {
      const expectedA = inputShape[1];
      const expectedB = inputShape[2];

      const leadMajor = tf.tensor(aligned).expandDims(0);
      const timeMajor = tf.tensor(aligned).transpose([1, 0]).expandDims(0);

      const leadMajorShape = leadMajor.shape;
      const timeMajorShape = timeMajor.shape;

      if (
        this.isShapeCompatible(expectedA, leadMajorShape[1] ?? 0) &&
        this.isShapeCompatible(expectedB, leadMajorShape[2] ?? 0)
      ) {
        timeMajor.dispose();
        return leadMajor;
      }

      if (
        this.isShapeCompatible(expectedA, timeMajorShape[1] ?? 0) &&
        this.isShapeCompatible(expectedB, timeMajorShape[2] ?? 0)
      ) {
        leadMajor.dispose();
        return timeMajor;
      }

      leadMajor.dispose();
      timeMajor.dispose();

      const singleLead = aligned[0] || [];
      return tf.tensor(singleLead, [1, singleLead.length, 1]);
    }

    if (inputShape.length === 2) {
      const flattened = aligned.flat();
      return tf.tensor(flattened, [1, flattened.length]);
    }

    if (inputShape.length === 4) {
      const expectedA = inputShape[1];
      const expectedB = inputShape[2];
      const expectedC = inputShape[3];

      const timeMajor4d = tf.tensor(aligned).transpose([1, 0]).expandDims(0).expandDims(-1);
      if (
        this.isShapeCompatible(expectedA, timeMajor4d.shape[1] ?? 0) &&
        this.isShapeCompatible(expectedB, timeMajor4d.shape[2] ?? 0) &&
        this.isShapeCompatible(expectedC, timeMajor4d.shape[3] ?? 0)
      ) {
        return timeMajor4d;
      }

      timeMajor4d.dispose();
    }

    return tf.tensor(aligned).expandDims(0);
  }

  private mockPredict(signalData: number[][]): ModelPrediction[] {
    const lead = signalData[0] || [];
    if (lead.length === 0) {
      return this.formatPrediction([0.2, 0.2, 0.2, 0.2, 0.2]);
    }

    const mean = lead.reduce((sum, value) => sum + value, 0) / lead.length;
    const variance =
      lead.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) /
      Math.max(1, lead.length);
    const std = Math.sqrt(variance);
    const amplitude = Math.max(...lead) - Math.min(...lead);

    const normalScore = Math.max(0.1, 1.1 - std * 2.5 - amplitude * 0.6);
    const afScore = Math.max(0.05, std * 1.8 + Math.abs(mean) * 0.5);
    const svtScore = Math.max(0.05, amplitude * 0.7 + std * 0.9);
    const vtScore = Math.max(0.05, amplitude * 0.9);
    const pauseScore = Math.max(0.05, 1 - amplitude * 1.5);

    const raw = [normalScore, afScore, svtScore, vtScore, pauseScore];
    const total = raw.reduce((sum, value) => sum + value, 0);
    const probs = raw.map((value) => value / Math.max(1e-6, total));

    return this.formatPrediction(probs);
  }

  private generateHeatmap(signalData: number[][]): number[] {
    const lead = signalData[0] || [];
    const max = Math.max(...lead.map((value) => Math.abs(value)), 1);
    return lead.map((value) => Math.abs(value) / max);
  }
}

export const modelService = new ModelService();
export default ModelService;
