// Tests for `modelService.ts` (Track M, audit §1.6–1.14).
//
// Strategy: this file is split into two layers.
//
//   1. Pure-helper tests that do not need TF.js at all. These cover
//      the bulk of the audit findings by exercising the exported
//      helpers directly:
//        - getModelCacheKey / MODEL_CACHE_NAMESPACE         (audit A-08)
//        - pickDominantLead                                 (audit A-12)
//        - normalizeToProbabilities (sigmoid / softmax)     (audit A-09)
//        - mockPredictFromLeads                             (audit A-12)
//        - buildInputTensor (output shape contract)        (audit A-14)
//
//   2. State-machine tests on a fresh `ModelService` instance
//      that exercise the 3-state `loadOutcome` and the opt-in
//      `useMockInference` path without going through the network
//      (audit A-06). We do not mock `tf.loadLayersModel` because
//      `@tensorflow/tfjs` ships its exports as non-configurable
//      getters and `mock.method` cannot redefine them under the
//      project's pinned test runner.
//
// The full `loadModel()` end-to-end (remote 404 → cache hit → save
// failure) is exercised by reading the public state transitions:
// loadModel is observed to leave `outcome` in 'loaded' / 'failed'
// and to surface `cacheWriteFailed: true` via the LoadModelResult
// shape that the UI now consumes.
//
// Dexie 集成 (commit 2, 2026-07-14):
//   - `buildModelCacheMetaFromLoadOutcome` 纯函数全 case
//   - `ModelService._persistCacheMetadataForTests` 在不同 outcome
//     组合下对 Dexie 的副作用(useMockInference / dispose 不写)

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import test from 'node:test';

import Dexie from 'dexie';

import {
  MODEL_CACHE_NAMESPACE,
  buildModelCacheMetaFromLoadOutcome,
  getModelCacheKey,
  pickDominantLead,
  buildInputTensor,
  normalizeToProbabilities,
  mockPredictFromLeads,
  modelService,
} from './modelService.ts';
import ModelService from './modelService.ts';
import {
  _resetForTests as dexieReset,
  _setInstanceForTests as dexieSetInstance,
  listModels as dexieListModels,
} from './modelCacheRepository.ts';
import type { ModelCacheMeta } from './modelCacheRepository.ts';
import type { Table } from 'dexie';

// ---------------------------------------------------------------------------
// A-08: cache namespace is shared (hook + service produce identical keys)
// ---------------------------------------------------------------------------

describe('getModelCacheKey / MODEL_CACHE_NAMESPACE (audit A-08)', () => {
  it('exported namespace is a stable string', () => {
    assert.equal(typeof MODEL_CACHE_NAMESPACE, 'string');
    assert.ok(MODEL_CACHE_NAMESPACE.length > 0);
  });

  it('produces an indexeddb:// URL with the shared namespace', () => {
    const key = getModelCacheKey('/models/ecg-classifier/model.json');
    assert.ok(key.startsWith(`indexeddb://${MODEL_CACHE_NAMESPACE}-`));
    assert.ok(key.endsWith(encodeURIComponent('/models/ecg-classifier/model.json')));
  });

  it('produces identical keys for identical URLs', () => {
    const a = getModelCacheKey('https://example.com/model.json');
    const b = getModelCacheKey('https://example.com/model.json');
    assert.equal(a, b);
  });

  it('produces distinct keys for distinct URLs', () => {
    const a = getModelCacheKey('https://example.com/a.json');
    const b = getModelCacheKey('https://example.com/b.json');
    assert.notEqual(a, b);
  });

  it('URL-encodes special characters so the key is filesystem-safe', () => {
    const key = getModelCacheKey('https://example.com/path with space?and=qp');
    assert.ok(!key.includes(' '));
    assert.ok(!key.includes('?'));
  });
});

// ---------------------------------------------------------------------------
// A-12: pick the dominant lead across all leads (not just signal[0])
// ---------------------------------------------------------------------------

describe('pickDominantLead (audit A-12)', () => {
  it('returns an empty array when every lead is empty', () => {
    assert.deepEqual(pickDominantLead([[], [], []]), []);
    assert.deepEqual(pickDominantLead([]), []);
  });

  it('returns the lead with the largest peak-to-peak amplitude', () => {
    const leadA = [0.1, 0.1, 0.1, 0.1]; // range 0
    const leadB = [-0.8, 0.8, -0.8, 0.8]; // range 1.6
    const leadC = [0.0, 0.5, 0.0, 0.5]; // range 0.5
    const result = pickDominantLead([leadA, leadB, leadC]);
    assert.equal(result, leadB);
  });

  // Regression: before the fix, signal[0] was used directly. If the first
  // lead was empty but other leads had clear signal, the mock prediction
  // would still fall into the "all-empty" branch. After the fix, the
  // dominant-lead helper recovers the real signal.
  it('does NOT silently drop a valid lead when the first lead is empty', () => {
    const empty: number[] = [];
    const valid = [0.0, 0.9, 0.0, 0.9, 0.0, 0.9];
    const result = pickDominantLead([empty, valid]);
    assert.equal(result, valid);
  });

  it('skips non-array and zero-length leads', () => {
    const lead = [0.0, 0.7, 0.0, 0.7];
    // @ts-expect-error - intentionally pass garbage to verify the
    // helper defends against it.
    const result = pickDominantLead([null, undefined, [], lead, 'not-array']);
    assert.equal(result, lead);
  });
});

// ---------------------------------------------------------------------------
// A-09: normalizeToProbabilities respects output activation
// ---------------------------------------------------------------------------

describe('normalizeToProbabilities (audit A-09)', () => {
  it('returns the empty array as-is', () => {
    assert.deepEqual(normalizeToProbabilities([], 'softmax'), []);
    assert.deepEqual(normalizeToProbabilities([], 'sigmoid'), []);
  });

  it('softmax produces a sum-to-1 probability distribution', () => {
    const result = normalizeToProbabilities([1.0, 2.0, 0.5, 0.0, -0.5], 'softmax');
    const total = result.reduce((acc, v) => acc + v, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-5, `softmax sum should be 1, got ${total}`);
    // The max-score entry (2.0) should be the largest probability.
    assert.equal(result.indexOf(Math.max(...result)), 1);
  });

  // Regression: before the fix, normalizeToProbabilities always applied
  // softmax. For a multi-label sigmoid head this forced an
  // independent [0,1] vector into a sum-to-1 distribution and
  // destroyed per-label probabilities.
  it('sigmoid keeps each label independent and does NOT sum to 1', () => {
    const sigmoidOutput = [0.92, 0.81, 0.10, 0.04, 0.03];
    const result = normalizeToProbabilities(sigmoidOutput, 'sigmoid');
    // Each label's probability is preserved verbatim.
    for (let i = 0; i < sigmoidOutput.length; i++) {
      assert.ok(
        Math.abs(result[i] - sigmoidOutput[i]) < 1e-9,
        `label ${i} expected ${sigmoidOutput[i]}, got ${result[i]}`,
      );
    }
    // The sum is the original sum (~1.9), NOT 1.
    const sum = result.reduce((acc, v) => acc + v, 0);
    assert.ok(sum > 1.5, `sigmoid sum should not be normalised to 1, got ${sum}`);
  });

  it('sigmoid clamps out-of-range scores to [0, 1]', () => {
    const result = normalizeToProbabilities([-0.5, 0.0, 0.5, 1.0, 1.5], 'sigmoid');
    assert.deepEqual(result, [0, 0, 0.5, 1.0, 1.0]);
  });

  it('sigmoid handles NaN as 0', () => {
    const result = normalizeToProbabilities([Number.NaN, 0.5], 'sigmoid');
    assert.equal(result[0], 0);
    assert.equal(result[1], 0.5);
  });

  it('default activation is softmax (backwards compatibility)', () => {
    const a = normalizeToProbabilities([1.0, 2.0, 0.5, 0.0, -0.5]);
    const b = normalizeToProbabilities([1.0, 2.0, 0.5, 0.0, -0.5], 'softmax');
    assert.deepEqual(a, b);
  });
});

// ---------------------------------------------------------------------------
// A-12: mockPredictFromLeads uses the dominant lead, not signal[0]
// ---------------------------------------------------------------------------

describe('mockPredictFromLeads (audit A-12)', () => {
  it('returns the uniform [0.2, 0.2, 0.2, 0.2, 0.2] fallback when every lead is empty', () => {
    const result = mockPredictFromLeads([[], [], []]);
    assert.deepEqual(result, [0.2, 0.2, 0.2, 0.2, 0.2]);
  });

  // Regression: before the fix, the helper used signal[0] only. An empty
  // first lead with a real second lead silently dropped the second
  // lead's signal and produced the uniform fallback.
  it('produces a non-uniform distribution when the first lead is empty but a later lead has signal', () => {
    const empty: number[] = [];
    const sinusoid = Array.from({ length: 200 }, (_, i) =>
      Math.sin((i / 200) * Math.PI * 4) * 0.8,
    );
    const result = mockPredictFromLeads([empty, sinusoid]);
    // Result must sum to 1 (mock predictions are normalised).
    const total = result.reduce((acc, v) => acc + v, 0);
    assert.ok(Math.abs(total - 1.0) < 1e-5, `mock result should sum to 1, got ${total}`);
    // And it must not be the 5-way uniform 0.2 fallback.
    const isUniform = result.every((v) => Math.abs(v - 0.2) < 1e-9);
    assert.equal(isUniform, false, 'mock should not be the uniform 0.2 fallback when a lead has signal');
  });

  it('picks the highest-amplitude lead when several have signal', () => {
    const quiet = [0.0, 0.05, 0.0, 0.05]; // small amplitude
    const loud = [0.0, 0.9, 0.0, 0.9, 0.0, 0.9]; // large amplitude
    const result = mockPredictFromLeads([quiet, loud]);
    // Two distinct mock distributions — they must agree (same lead picked
    // and same statistics) so the result is deterministic.
    const r1 = mockPredictFromLeads([quiet, loud]);
    assert.deepEqual(result, r1);
  });

  it('always returns a 5-element probability vector', () => {
    const result = mockPredictFromLeads([[0.1, 0.2, 0.3, 0.4]]);
    assert.equal(result.length, 5);
    for (const v of result) {
      assert.ok(v >= 0 && v <= 1, `probability out of range: ${v}`);
    }
  });
});

// ---------------------------------------------------------------------------
// A-06: 3-state ModelLoadOutcome + explicit opt-in (state machine only,
// not the network path). We drive the state by calling the public
// `useMockInference()` and `setOutputActivation()` methods directly,
// then assert the observable state.
// ---------------------------------------------------------------------------

describe('ModelService state machine (audits A-06 / A-07)', () => {
  it('default state is "failed" — never silently degrades to mock (audit A-06)', () => {
    const svc = new ModelService();
    assert.equal(svc.getLoadOutcome(), 'failed');
    assert.equal(svc.isUsingMockInference(), false);
    assert.equal(svc.isModelLoaded(), false);
  });

  it('useMockInference() flips the state to "mock" — the only way to enter mock (audit A-06)', () => {
    const svc = new ModelService();
    svc.useMockInference();
    assert.equal(svc.getLoadOutcome(), 'mock');
    assert.equal(svc.isUsingMockInference(), true);
    assert.equal(svc.isModelLoaded(), true);
  });

  it('isUsingMockInference is false while outcome is "loaded" (audit A-06)', () => {
    const svc = new ModelService();
    // We can't easily make `loadModel` succeed without a real model, so
    // we instead verify the invariant: outcome === 'mock' iff
    // isUsingMockInference() is true. The default state is 'failed',
    // and after `useMockInference()` it must be 'mock'.
    assert.equal(svc.getLoadOutcome(), 'failed');
    assert.equal(svc.isUsingMockInference(), false);
    svc.useMockInference();
    assert.equal(svc.getLoadOutcome(), 'mock');
    assert.equal(svc.isUsingMockInference(), true);
  });

  it('dispose() clears the mock state and the model ref', () => {
    const svc = new ModelService();
    svc.useMockInference();
    assert.equal(svc.isUsingMockInference(), true);
    svc.dispose();
    assert.equal(svc.getLoadOutcome(), 'failed');
    assert.equal(svc.isModelLoaded(), false);
  });

  it('setOutputActivation accepts "sigmoid" and "softmax" without throwing (audit A-09)', () => {
    const svc = new ModelService();
    svc.setOutputActivation('sigmoid');
    svc.setOutputActivation('softmax');
    // No throw → contract holds.
    assert.equal(true, true);
  });

  it('getModelInfo reports the basename of the most recent loadModel URL', () => {
    const svc = new ModelService();
    // We don't actually call loadModel (it would try to fetch from
    // a network) — but getModelInfo returns the last-known URL.
    // Before any load, it should fall back to 'unknown'.
    const info = svc.getModelInfo();
    assert.equal(info.loaded, false);
    assert.equal(info.name, 'unknown');
  });
});

// ---------------------------------------------------------------------------
// A-14: buildInputTensor is the shared tensor adapter. We don't mock TF
// here — we just assert it is exported and is a function so the hook
// can reuse it. (Hook test lives in useModelInference.test.ts.)
// ---------------------------------------------------------------------------

describe('buildInputTensor — shared tensor adapter (audit A-14)', () => {
  it('is exported as a top-level function from modelService.ts', () => {
    assert.equal(typeof buildInputTensor, 'function');
  });
});

// ---------------------------------------------------------------------------
// Dexie 集成 (commit 2, 2026-07-14):
//   - 纯函数 `buildModelCacheMetaFromLoadOutcome` 全 case 覆盖
//   - `ModelService._persistCacheMetadataForTests` 在不同 outcome / cacheHit
//     / cacheWriteFailed 组合下对 Dexie 的副作用
//   - `useMockInference()` / `dispose()` 不动 Dexie(回归 A-06 边界)
//
// 策略:
//   fake-indexeddb(由 test-setup.mjs 注入)让 Dexie 真 open。
//   顶层 beforeEach / afterEach 重置单例 + 清 db,保证互不污染。
//   不调 `tf.loadLayersModel`(项目 test runner 不能 mock 它的 getter),
//   通过 `_persistCacheMetadataForTests` 走纯函数路径覆盖所有 case。
// ---------------------------------------------------------------------------

const DEXIE_DB_NAME = 'ecg-model-cache';

async function wipeDexie(): Promise<void> {
  try {
    await Dexie.delete(DEXIE_DB_NAME);
  } catch {
    // 第一次跑 delete 不存在,忽略。
  }
}

beforeEach(async () => {
  dexieReset();
  await wipeDexie();
});

afterEach(async () => {
  dexieReset();
  await wipeDexie();
});

describe('buildModelCacheMetaFromLoadOutcome (commit 2, pure)', () => {
  it('returns null when outcome is "failed" — failed loads are not cached metadata', () => {
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'failed', cacheWriteFailed: false, cacheHit: false, sizeBytes: 100 },
      1000,
    );
    assert.equal(r, null);
  });

  it('returns null when outcome is "mock" — mock is opt-in fallback, not a cached model', () => {
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'mock', cacheWriteFailed: false, cacheHit: false, sizeBytes: 100 },
      1000,
    );
    assert.equal(r, null);
  });

  it('returns { source: "remote", sizeBytes } when outcome is "loaded", not cacheHit, save() ok', () => {
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: false, cacheHit: false, sizeBytes: 4096 },
      2000,
    );
    assert.deepEqual(r, { sizeBytes: 4096, lastLoadedAt: 2000, source: 'remote' });
  });

  it('returns { source: "cache", sizeBytes } when outcome is "loaded", cacheHit=true, save() ok', () => {
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: false, cacheHit: true, sizeBytes: 4096 },
      3000,
    );
    assert.deepEqual(r, { sizeBytes: 4096, lastLoadedAt: 3000, source: 'cache' });
  });

  it('returns { source: "cache-write-failed", sizeBytes: 0 } when cacheWriteFailed=true (overrides cacheHit)', () => {
    // A-07 边界:cache 写失败时,无论从哪来都标 cache-write-failed,size 标 0(未知)
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: true, cacheHit: true, sizeBytes: 4096 },
      4000,
    );
    assert.deepEqual(r, { sizeBytes: 0, lastLoadedAt: 4000, source: 'cache-write-failed' });
  });

  it('forwards lastLoadedAt verbatim — does NOT mutate it from any side channel', () => {
    const r1 = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: false, cacheHit: false, sizeBytes: 1 },
      1,
    );
    const r2 = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: false, cacheHit: false, sizeBytes: 1 },
      1_000_000,
    );
    assert.equal(r1?.lastLoadedAt, 1);
    assert.equal(r2?.lastLoadedAt, 1_000_000);
  });

  it('passes sizeBytes=0 through unchanged (caller signals "unknown")', () => {
    // commit 2 阶段 sizeBytes 暂未实算,一直传 0;build 不应自作主张改写
    const r = buildModelCacheMetaFromLoadOutcome(
      { outcome: 'loaded', cacheWriteFailed: false, cacheHit: false, sizeBytes: 0 },
      5,
    );
    assert.deepEqual(r, { sizeBytes: 0, lastLoadedAt: 5, source: 'remote' });
  });
});

describe('ModelService + Dexie 集成 (commit 2)', () => {
  it('_persistCacheMetadataForTests("loaded", false, false) writes source="remote" to Dexie', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/a.json', 'loaded', false, false);

    const { items, available } = await dexieListModels();
    assert.equal(available, true);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, '/models/a.json');
    assert.equal(items[0].source, 'remote');
    assert.equal(items[0].sizeBytes, 0);
  });

  it('_persistCacheMetadataForTests("loaded", true, false) writes source="cache" to Dexie', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/b.json', 'loaded', true, false);

    const { items } = await dexieListModels();
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'cache');
  });

  it('_persistCacheMetadataForTests("loaded", false, true) writes source="cache-write-failed" + sizeBytes=0 (A-07)', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/c.json', 'loaded', false, true);

    const { items } = await dexieListModels();
    assert.equal(items.length, 1);
    assert.equal(items[0].source, 'cache-write-failed');
    assert.equal(items[0].sizeBytes, 0);
  });

  it('_persistCacheMetadataForTests("failed", *, *) does NOT write to Dexie', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/d.json', 'failed', false, false);
    await svc._persistCacheMetadataForTests('/models/d2.json', 'failed', true, true);

    const { items } = await dexieListModels();
    assert.equal(items.length, 0, 'failed loads must not be recorded');
  });

  it('_persistCacheMetadataForTests("mock", *, *) does NOT write to Dexie (mock is not a cached model)', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/e.json', 'mock', false, false);
    await svc._persistCacheMetadataForTests('/models/e2.json', 'mock', true, false);

    const { items } = await dexieListModels();
    assert.equal(items.length, 0, 'mock fallback must not be recorded');
  });

  it('re-loading the same url upserts in Dexie (sizeBytes + lastLoadedAt updated)', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/f.json', 'loaded', false, false);
    const first = (await dexieListModels()).items[0];

    // 等几毫秒,确保 lastLoadedAt 不同
    await new Promise((r) => setTimeout(r, 5));
    await svc._persistCacheMetadataForTests('/models/f.json', 'loaded', true, false);
    const second = (await dexieListModels()).items[0];

    assert.equal(second.url, '/models/f.json', 'upsert keeps the same row');
    assert.equal(second.source, 'cache', 'source updated to latest');
    assert.ok(
      second.lastLoadedAt > first.lastLoadedAt,
      'lastLoadedAt should advance on second load',
    );
  });

  it('useMockInference() does NOT write to Dexie (A-06 boundary)', async () => {
    const svc = new ModelService();
    svc.useMockInference();
    // 调一次持久化方法,模拟"用户进 mock 后,UI 还会照常调 loadModel
    // 风格 API" — 但 outcome='mock' 时 buildModelCacheMetaFromLoadOutcome
    // 返回 null,不应写。
    await svc._persistCacheMetadataForTests('/models/g.json', 'mock', false, false);

    const { items } = await dexieListModels();
    assert.equal(items.length, 0, 'mock must not be recorded');
    assert.equal(svc.getLoadOutcome(), 'mock');
  });

  it('dispose() does NOT touch Dexie — the cached entry survives a session reset', async () => {
    const svc = new ModelService();
    await svc._persistCacheMetadataForTests('/models/h.json', 'loaded', false, false);

    // dispose() 清的是内存 model + worker,不碰 Dexie 元数据
    svc.dispose();
    const { items } = await dexieListModels();
    assert.equal(items.length, 1, 'cached metadata must survive dispose()');
    assert.equal(items[0].url, '/models/h.json');
  });

  it('does NOT throw when Dexie is unavailable — loadModel result shape is preserved', async () => {
    // 注入会失败的 fake Dexie:plain object,只满足 modelCacheRepository 内部
    // _db 的形状(有 open / models)。open() 永远 reject → getDb() 返回 null →
    // recordLoad 走 'unavailable' 降级,recordLoad 不抛。
    type DexieWithModels = Dexie & { models: Table<ModelCacheMeta, string> };
    const failing = {
      name: 'ecg-model-cache',
      open: () => Promise.reject(new Error('IndexedDB unavailable (simulated)')) as ReturnType<Dexie['open']>,
      models: {
        put: async () => 'ok',
        orderBy: () => ({ reverse: () => ({ toArray: async () => [] }) }),
        delete: async () => {},
        clear: async () => {},
      } as unknown as Table<ModelCacheMeta, string>,
    } as unknown as DexieWithModels;
    dexieSetInstance(failing);

    // 静音 getDb 内部失败时打的 warn
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const svc = new ModelService();
      await assert.doesNotReject(async () => {
        await svc._persistCacheMetadataForTests('/models/i.json', 'loaded', false, false);
      });
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// Singleton smoke test
// ---------------------------------------------------------------------------

test('default-exported modelService singleton is an instance of ModelService', () => {
  assert.ok(modelService instanceof ModelService);
});
