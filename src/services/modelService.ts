// ModelService — TF.js ECG classifier wrapper.
//
// Audit fixes (2026-07-07 Track M, audit §1.6–1.14):
//   A-06  loadModel now returns a `ModelLoadOutcome` with an explicit
//         'loaded' | 'mock' | 'failed' state. The service no longer flips
//         itself into mock mode silently when the real model is missing —
//         the UI must call `useMockInference()` to opt in.
//   A-07  The "load remote model + save to cache" path is split: a save
//         failure only logs a warning and never throws away the in-memory
//         model. Cache load is a separate fallback branch.
//   A-08  `MODEL_CACHE_NAMESPACE` is the single IndexedDB key namespace.
//         `useModelInference` imports it from here so both sides see the
//         same cache entries.
//   A-09  `normalizeToProbabilities` now accepts an `outputActivation`
//         ('softmax' | 'sigmoid') and never turns a sigmoid multi-label
//         vector into a sum-to-1 softmax.
//   A-12  `mockPredict` and `generateHeatmap` aggregate across all leads
//         (max amplitude / max abs) so a zero/empty first lead no longer
//         hides signal in other leads.
//
// Dexie 集成 (2026-07-14, 三连击 commit 2 of 3):
//   - loadModel 成功后通过 `modelCacheRepository.recordLoad` 把
//     url/sizeBytes/lastLoadedAt/source 写到 Dexie 元数据表;binary
//     (model.json + weights) 仍由 TF.js `indexeddb://` 落盘,两者
//     互不干扰(不同 dbName)。
//   - `useMockInference()` / outcome='failed' / dispose() 都不写 Dexie。
//   - 纯函数 `buildModelCacheMetaFromLoadOutcome` 独立测,跟 recordLoad
//     的副作用分开。

import * as tf from '@tensorflow/tfjs';
import { InferenceResult, ModelPrediction } from '../types';
import { recordLoad } from './modelCacheRepository';

/**
 * Single IndexedDB key namespace shared by `ModelService` and
 * `useModelInference`. Exporting the constant from one place prevents
 * the two sides from drifting into two disjoint cache buckets
 * (audit A-08, residual R-08).
 */
export const MODEL_CACHE_NAMESPACE = 'ecg-model-cache';

/**
 * Helper that produces the canonical IndexedDB URL for a given model URL.
 * Both the service and the hook call this so the keys are byte-identical.
 */
export function getModelCacheKey(modelUrl: string): string {
  return `indexeddb://${MODEL_CACHE_NAMESPACE}-${encodeURIComponent(modelUrl)}`;
}

const CLASS_NAMES = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];

/**
 * Output activation hint. Real model metadata is not yet shipped in the
 * project (the `/models/ecg-classifier/model.json` resource is still
 * missing), so the default is `softmax` to preserve historical behaviour
 * for the in-repo training pipeline. Callers that know the model is a
 * multi-label sigmoid head should pass `sigmoid`.
 */
export type OutputActivation = 'softmax' | 'sigmoid';

/**
 * Explicit three-state load outcome. `failed` is the default — a missing
 * model resource no longer silently drops the service into mock mode
 * (audit A-06). `mock` is only reached after the caller opts in via
 * `useMockInference()`.
 */
export type ModelLoadOutcome = 'loaded' | 'mock' | 'failed';

export interface LoadModelResult {
  outcome: ModelLoadOutcome;
  /**
   * Populated when the in-memory model is usable, regardless of whether
   * the cache write succeeded. The UI can use this to surface a warning
   * toast while still running real inference.
   */
  cacheWriteFailed: boolean;
}

/**
 * `buildModelCacheMetaFromLoadOutcome` 的输入。记录"本次 load 关键
 * 决策",纯函数本身不读 this / Date.now(),便于单测。
 */
export interface ModelCacheMetaInput {
  outcome: ModelLoadOutcome;
  /** TF.js `model.save(cacheKey)` 是否抛错(A-07 边界) */
  cacheWriteFailed: boolean;
  /** 加载是 cache 命中(remote 404 后从 IndexedDB 读出)还是远程下载 */
  cacheHit: boolean;
  /**
   * 模型估算字节数。0 表示"未知",本函数不重写为 0(让调用方决定)。
   * 真实 size 估算留给后续 PR(用 `this.model.weights[*].data().byteLength` 求和)。
   */
  sizeBytes: number;
}

/**
 * 根据 `loadModel` 的结果计算要写入 Dexie 的元数据。
 * - outcome !== 'loaded' → null(mock / failed 都不记,mock 不算"缓存的模型")
 * - outcome === 'loaded' && cacheWriteFailed → { sizeBytes: 0, source: 'cache-write-failed' }
 * - outcome === 'loaded' && !cacheWriteFailed && cacheHit → { sizeBytes, source: 'cache' }
 * - outcome === 'loaded' && !cacheWriteFailed && !cacheHit → { sizeBytes, source: 'remote' }
 *
 * `lastLoadedAt` 由调用方注入,本函数不读 `Date.now()` —— 保证纯函数
 * 性质,单测能精确控制时间戳。
 */
export function buildModelCacheMetaFromLoadOutcome(
  input: ModelCacheMetaInput,
  lastLoadedAt: number,
): { sizeBytes: number; lastLoadedAt: number; source: 'remote' | 'cache' | 'cache-write-failed' } | null {
  if (input.outcome !== 'loaded') return null;
  if (input.cacheWriteFailed) {
    return { sizeBytes: 0, lastLoadedAt, source: 'cache-write-failed' };
  }
  return {
    sizeBytes: input.sizeBytes,
    lastLoadedAt,
    source: input.cacheHit ? 'cache' : 'remote',
  };
}

class ModelService {
  private model: tf.LayersModel | null = null;
  private modelUrl = '';
  private worker: Worker | null = null;
  private mockOptIn = false;
  private outcome: ModelLoadOutcome = 'failed';
  private outputActivation: OutputActivation = 'softmax';

  async loadModel(modelUrl: string): Promise<LoadModelResult> {
    this.modelUrl = modelUrl;
    const cacheKey = getModelCacheKey(modelUrl);
    // Reset transient state for this load attempt. We do NOT flip into
    // mock mode here — `outcome` stays 'failed' until the caller opts in.
    this.mockOptIn = false;
    this.outcome = 'failed';

    let cacheHit = false;
    let cacheWriteFailed = false;

    // 1) Try to load the remote model.
    try {
      this.model = await tf.loadLayersModel(modelUrl);
      this.outcome = 'loaded';
    } catch (remoteError) {
      console.error('[ModelService] Failed to load remote model:', remoteError);
      // 2) Fall back to the IndexedDB cache. This is a separate path so a
      //    save failure below can never drop the freshly loaded model.
      try {
        this.model = await tf.loadLayersModel(cacheKey);
        this.outcome = 'loaded';
        cacheHit = true;
      } catch (cacheReadError) {
        console.error('[ModelService] Failed to load cached model:', cacheReadError);
        this.model = null;
        // outcome stays 'failed' — caller must opt in to mock.
      }
    }

    // 3) Persist a fresh copy to the cache. Failures here are non-fatal:
    //    the in-memory model (if any) remains usable for this session.
    if (this.outcome === 'loaded' && this.model) {
      try {
        await this.model.save(cacheKey);
      } catch (saveError) {
        cacheWriteFailed = true;
        console.warn(
          '[ModelService] Loaded real model but failed to persist to IndexedDB cache:',
          saveError,
        );
        // Intentionally do NOT touch this.model or this.outcome — the
        // session keeps working, only future cold starts are affected.
      }
    }

    // 4) Record metadata to Dexie. Non-fatal: `recordLoad` itself
    //    swallows Dexie errors and returns { recorded: false }.
    //    We do NOT throw, do NOT touch this.outcome / this.model —
    //    a Dexie failure here cannot degrade the in-memory model
    //    (audit A-07 invariant).
    await this.persistCacheMetadata(cacheHit, cacheWriteFailed);

    return { outcome: this.outcome, cacheWriteFailed };
  }

  /**
   * 把"本次 load 的关键决策"转成元数据并写入 Dexie。
   * 只在 outcome === 'loaded' 时写;'failed' / 'mock' 不写。
   * Dexie 失败由 `recordLoad` 内部 swallow,本方法不抛、不影响
   * `this.outcome` / `this.model`。
   *
   * 真实 size 估算(遍历 `this.model.weights` 求 `data().byteLength` 之和)
   * 留给后续 PR;目前 sizeBytes=0 表示"未知"。
   */
  private async persistCacheMetadata(
    cacheHit: boolean,
    cacheWriteFailed: boolean,
  ): Promise<void> {
    await this._persistCacheMetadataForTests(
      this.modelUrl,
      this.outcome,
      cacheHit,
      cacheWriteFailed,
    );
  }

  /**
   * 测试/调试用:接受 outcome / cacheHit / cacheWriteFailed,直接调
   * `buildModelCacheMetaFromLoadOutcome` + `recordLoad`。允许单测在
   * 不真跑 `tf.loadLayersModel` 的前提下,验证 ModelService 集成
   * Dexie 的所有 case。
   *
   * 生产代码不应调(下划线前缀 + 参数绕过 this.outcome)。
   */
  async _persistCacheMetadataForTests(
    modelUrl: string,
    outcome: ModelLoadOutcome,
    cacheHit: boolean,
    cacheWriteFailed: boolean,
  ): Promise<void> {
    const meta = buildModelCacheMetaFromLoadOutcome(
      { outcome, cacheWriteFailed, cacheHit, sizeBytes: 0 },
      Date.now(),
    );
    if (meta === null) return;
    await recordLoad(modelUrl, meta);
  }

  /**
   * Explicit opt-in to mock inference. The UI should only call this after
   * the user has acknowledged that the real model resource is missing
   * (e.g. via a confirmation modal). Default state is 'failed' — we
   * never silently degrade (audit A-06).
   */
  useMockInference(): void {
    this.mockOptIn = true;
    this.model = null;
    this.outcome = 'mock';
  }

  /**
   * Optional: declare the model's output activation so
   * `normalizeToProbabilities` can pick the right transformation.
   * Unknown / unset → defaults to 'softmax' for backwards compatibility.
   */
  setOutputActivation(activation: OutputActivation): void {
    this.outputActivation = activation;
  }

  async predict(signalData: number[][]): Promise<ModelPrediction[]> {
    if (this.outcome === 'mock' || (this.mockOptIn && !this.model)) {
      return this.mockPredict(signalData);
    }

    if (!this.model) {
      throw new Error('Model not loaded and fallback unavailable');
    }

    const inputTensor = this.buildInputTensor(signalData, this.model.inputs[0].shape);
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const rawScores = Array.from(await prediction.data());
    const probabilities = this.normalizeToProbabilities(
      rawScores,
      this.outputActivation,
    );

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
    this.mockOptIn = false;
    this.outcome = 'failed';

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  isModelLoaded(): boolean {
    return this.model !== null || this.outcome === 'mock';
  }

  /**
   * Whether the service is currently in the (opt-in) mock fallback mode.
   * Distinguish from `getLoadOutcome` which also exposes the 'failed'
   * state.
   */
  isUsingMockInference(): boolean {
    return this.outcome === 'mock';
  }

  getLoadOutcome(): ModelLoadOutcome {
    return this.outcome;
  }

  getModelInfo(): { name: string; loaded: boolean } {
    return {
      name: this.modelUrl.split('/').pop() || 'unknown',
      loaded: this.isModelLoaded(),
    };
  }

  private formatPrediction(result: number[]): ModelPrediction[] {
    return CLASS_NAMES.map((label, index) => ({
      className: label,
      probability: result[index] || 0,
    })).sort((a, b) => b.probability - a.probability);
  }

  /**
   * Convert raw model output to a probability vector.
   *
   * For 'softmax' output we treat the scores as logits and apply a
   * stable softmax. For 'sigmoid' (multi-label) we clamp to [0, 1] and
   * keep each label's independent probability — never sum-to-1.
   */
  private normalizeToProbabilities(
    scores: number[],
    activation: OutputActivation = this.outputActivation,
  ): number[] {
    return normalizeToProbabilities(scores, activation);
  }

  private isShapeCompatible(expected: number | null | undefined, actual: number): boolean {
    return expected == null || expected === -1 || expected === actual;
  }

  private buildInputTensor(signalData: number[][], inputShape: Array<number | null>): tf.Tensor {
    return buildInputTensor(signalData, inputShape);
  }

  /**
   * Mock prediction aggregating across all leads (audit A-12). Delegates
   * to the pure `mockPredictFromLeads` helper so the same logic can be
   * unit-tested without TF.js. A zero/empty first lead no longer
   * hides signal in other leads.
   */
  private mockPredict(signalData: number[][]): ModelPrediction[] {
    return this.formatPrediction(mockPredictFromLeads(signalData));
  }

  /**
   * Heatmap aggregating across all leads (audit A-12). Returns the per-
   * sample |x| vector from the dominant lead, normalised to [0, 1].
   */
  private generateHeatmap(signalData: number[][]): number[] {
    const dominantLead = pickDominantLead(signalData);
    if (dominantLead.length === 0) return [];
    const max = Math.max(...dominantLead.map((value) => Math.abs(value)), 1);
    return dominantLead.map((value) => Math.abs(value) / max);
  }
}

/**
 * Build the input tensor for a model from a multi-lead signal.
 *
 * Exported as a top-level function so `useModelInference` and the
 * service share the exact same shape contract (audit A-14). Both
 * call paths used to build different tensors for the same model
 * (the hook hard-coded `[signal]` and crashed on time-major / 4D
 * conv heads). Going through this helper keeps the two paths
 * byte-identical.
 */
export function buildInputTensor(
  signalData: number[][],
  inputShape: Array<number | null>,
): tf.Tensor {
  const samples = signalData[0]?.length || 0;
  const aligned = signalData.map((lead) => lead.slice(0, samples));

  const isShapeCompatible = (expected: number | null | undefined, actual: number): boolean =>
    expected == null || expected === -1 || expected === actual;

  if (inputShape.length === 3) {
    const expectedA = inputShape[1];
    const expectedB = inputShape[2];

    const leadMajor = tf.tensor(aligned).expandDims(0);
    const timeMajor = tf.tensor(aligned).transpose([1, 0]).expandDims(0);

    const leadMajorShape = leadMajor.shape;
    const timeMajorShape = timeMajor.shape;

    if (
      isShapeCompatible(expectedA, leadMajorShape[1] ?? 0) &&
      isShapeCompatible(expectedB, leadMajorShape[2] ?? 0)
    ) {
      timeMajor.dispose();
      return leadMajor;
    }

    if (
      isShapeCompatible(expectedA, timeMajorShape[1] ?? 0) &&
      isShapeCompatible(expectedB, timeMajorShape[2] ?? 0)
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
      isShapeCompatible(expectedA, timeMajor4d.shape[1] ?? 0) &&
      isShapeCompatible(expectedB, timeMajor4d.shape[2] ?? 0) &&
      isShapeCompatible(expectedC, timeMajor4d.shape[3] ?? 0)
    ) {
      return timeMajor4d;
    }

    timeMajor4d.dispose();
  }

  return tf.tensor(aligned).expandDims(0);
}

/**
 * Pick the lead whose peak-to-peak amplitude is the largest. Returns an
 * empty array when every lead is empty. Exported as a pure helper so it
 * can be unit-tested without touching the service.
 */
export function pickDominantLead(signalData: number[][]): number[] {
  let best: number[] = [];
  let bestRange = 0;
  for (const lead of signalData) {
    if (!Array.isArray(lead) || lead.length === 0) continue;
    let max = lead[0];
    let min = lead[0];
    for (let i = 1; i < lead.length; i++) {
      const v = lead[i];
      if (v > max) max = v;
      if (v < min) min = v;
    }
    const range = max - min;
    if (range > bestRange) {
      bestRange = range;
      best = lead;
    }
  }
  return best;
}

/**
 * Convert raw model output to a probability vector. Pure function so it
 * can be unit-tested without TF.js.
 *
 * - 'softmax' → stable softmax of the scores (sum-to-1).
 * - 'sigmoid' → each score clamped to [0, 1] (independent labels, never
 *   sum-to-1). This is the audit A-09 fix: a sigmoid multi-label head
 *   must NOT be renormalised to sum-to-1.
 */
export function normalizeToProbabilities(
  scores: number[],
  activation: OutputActivation = 'softmax',
): number[] {
  if (scores.length === 0) {
    return scores;
  }

  if (activation === 'sigmoid') {
    return scores.map((value) => clamp01(value));
  }

  // Softmax branch: treat the scores as logits. Stable softmax via the
  // max-subtraction trick.
  const maxScore = Math.max(...scores);
  const expScores = scores.map((value) => Math.exp(value - maxScore));
  const expSum = expScores.reduce((acc, value) => acc + value, 0);
  return expScores.map((value) => value / Math.max(expSum, 1e-6));
}

/**
 * Build a 5-class mock prediction from a multi-lead signal. Pure
 * function so it can be unit-tested without TF.js. Audit A-12:
 * the function picks the dominant lead (largest peak-to-peak) and
 * scores the standard mock classes from its statistics. A zero/empty
 * first lead no longer hides signal in other leads.
 */
export function mockPredictFromLeads(signalData: number[][]): number[] {
  const dominantLead = pickDominantLead(signalData);
  if (dominantLead.length === 0) {
    return [0.2, 0.2, 0.2, 0.2, 0.2];
  }

  const mean = dominantLead.reduce((sum, value) => sum + value, 0) / dominantLead.length;
  const variance =
    dominantLead.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) /
    Math.max(1, dominantLead.length);
  const std = Math.sqrt(variance);
  const amplitude = Math.max(...dominantLead, 0) - Math.min(...dominantLead, 0);

  const normalScore = Math.max(0.1, 1.1 - std * 2.5 - amplitude * 0.6);
  const afScore = Math.max(0.05, std * 1.8 + Math.abs(mean) * 0.5);
  const svtScore = Math.max(0.05, amplitude * 0.7 + std * 0.9);
  const vtScore = Math.max(0.05, amplitude * 0.9);
  const pauseScore = Math.max(0.05, 1 - amplitude * 1.5);

  const raw = [normalScore, afScore, svtScore, vtScore, pauseScore];
  const total = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => value / Math.max(1e-6, total));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export const modelService = new ModelService();
export default ModelService;
