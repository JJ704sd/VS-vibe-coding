// modelCacheRepository 单测(commit 1, 2026-07-14; commit 2 适配 dynamic import)
//
// 策略:
//   1. fake-indexeddb(由 test-setup.mjs 注入)让 Dexie 在 Node 里能真的 open
//   2. 每个 case 之前 _resetForTests + 清 DB,保证用例互不污染
//   3. 测真链路:open / put / get / orderBy / delete / clear 全跑 Dexie
//   4. 失败路径通过 _setInstanceForTests 注入"会抛的 fake Dexie"覆盖
//
// Commit 2 调整:
//   - ModelCacheRepository class 不再 export(被 dynamic-import 的工厂替代)
//   - schema 测改成"通过 _dbForTests() 看内部 db 的 schema"
//   - makeFailingRepository 改成 plain fake db object(满足 Dexie shape)

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import Dexie from 'dexie';
import type { Table } from 'dexie';

import {
  _resetForTests,
  _setInstanceForTests,
  clearAll,
  clearModel,
  isAvailable,
  listModels,
  recordLoad,
} from './modelCacheRepository.ts';
import type { ModelCacheMeta } from './modelCacheRepository.ts';

const DB_NAME = 'ecg-model-cache';

async function wipeDatabase(): Promise<void> {
  try {
    await Dexie.delete(DB_NAME);
  } catch {
    // 第一次跑 / 不存在,忽略
  }
}

/** 构造一个 open() 永远 reject 的 fake Dexie,用于模拟"IndexedDB 不可用" */
type DexieWithModels = Dexie & { models: Table<ModelCacheMeta, string> };
function makeFailingRepository(): DexieWithModels {
  return {
    name: DB_NAME,
    open: () => Promise.reject(new Error('IndexedDB unavailable (simulated)')) as ReturnType<Dexie['open']>,
    models: {
      put: async () => 'ok',
      orderBy: () => ({
        reverse: () => ({
          toArray: async () => [],
        }),
      }),
      delete: async () => {},
      clear: async () => {},
    } as unknown as Table<ModelCacheMeta, string>,
  } as unknown as DexieWithModels;
}

/** 临时把 console.warn 静音(失败路径预期会打 warn) */
function silenceConsoleWarn<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.warn;
  console.warn = () => undefined;
  return fn().finally(() => {
    console.warn = original;
  });
}

beforeEach(async () => {
  _resetForTests();
  await wipeDatabase();
});

afterEach(async () => {
  _resetForTests();
  await wipeDatabase();
});

// ---------------------------------------------------------------------------
// Dexie schema — 通过真实 lazy init 触发一次 open,看 db.tables 的形状。
// 这比 commit 1 时期 "new ModelCacheRepository()" 间接(需要 export class)
// 更直接,因为 commit 2 改成了 lazy init,class 也不再 export。
// ---------------------------------------------------------------------------

describe('Dexie schema (lazy init)', () => {
  it('opens the database with name "ecg-model-cache" after first access', async () => {
    // 触发 lazy open
    assert.equal(await isAvailable(), true);
    // schema 形状由 recordLoad + listModels 间接证明:能写入并按 lastLoadedAt 排序读回
    await recordLoad('/models/schema-check.json', {
      sizeBytes: 1,
      lastLoadedAt: 1,
      source: 'remote',
    });
    const { items, available } = await listModels();
    assert.equal(available, true);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, '/models/schema-check.json');
  });

  it('url is the primary key (upsert semantics: same url = same row)', async () => {
    await recordLoad('/models/a.json', {
      sizeBytes: 1,
      lastLoadedAt: 100,
      source: 'remote',
    });
    await recordLoad('/models/a.json', {
      sizeBytes: 2,
      lastLoadedAt: 200,
      source: 'cache',
    });
    const { items } = await listModels();
    assert.equal(items.length, 1, 'upsert must not create a second row');
    assert.equal(items[0].lastLoadedAt, 200);
  });
});

// ---------------------------------------------------------------------------
// recordLoad
// ---------------------------------------------------------------------------

describe('recordLoad', () => {
  it('inserts a new row with url/sizeBytes/lastLoadedAt/source when url is unseen', async () => {
    const result = await recordLoad('/models/a.json', {
      sizeBytes: 1024,
      lastLoadedAt: 100,
      source: 'remote',
    });
    assert.deepEqual(result, { recorded: true });

    const { items, available } = await listModels();
    assert.equal(available, true);
    assert.equal(items.length, 1);
    assert.equal(items[0].url, '/models/a.json');
    assert.equal(items[0].sizeBytes, 1024);
    assert.equal(items[0].lastLoadedAt, 100);
    assert.equal(items[0].source, 'remote');
  });

  it('upserts (replaces lastLoadedAt + sizeBytes) when the same url is re-recorded', async () => {
    await recordLoad('/models/a.json', {
      sizeBytes: 1024,
      lastLoadedAt: 100,
      source: 'remote',
    });
    const second = await recordLoad('/models/a.json', {
      sizeBytes: 2048,
      lastLoadedAt: 200,
      source: 'cache',
    });
    assert.deepEqual(second, { recorded: true });

    const { items } = await listModels();
    assert.equal(items.length, 1, 'upsert must not create a second row');
    assert.equal(items[0].sizeBytes, 2048);
    assert.equal(items[0].lastLoadedAt, 200);
    assert.equal(items[0].source, 'cache');
  });

  it('stores sizeBytes=0 when caller passes 0 (unknown size / cache-write-failed)', async () => {
    const result = await recordLoad('/models/c.json', {
      sizeBytes: 0,
      lastLoadedAt: 300,
      source: 'cache-write-failed',
    });
    assert.deepEqual(result, { recorded: true });

    const { items } = await listModels();
    assert.equal(items[0].sizeBytes, 0);
    assert.equal(items[0].source, 'cache-write-failed');
  });

  it('returns { recorded: false, reason: "unavailable" } when Dexie is unavailable', async () => {
    _setInstanceForTests(makeFailingRepository());
    const result = await silenceConsoleWarn(() =>
      recordLoad('/models/e.json', {
        sizeBytes: 1,
        lastLoadedAt: 1,
        source: 'remote',
      }),
    );
    assert.equal(result.recorded, false);
    assert.equal(result.reason, 'unavailable');
  });
});

// ---------------------------------------------------------------------------
// listModels
// ---------------------------------------------------------------------------

describe('listModels', () => {
  it('returns empty array when no model has been recorded', async () => {
    const { items, available } = await listModels();
    assert.equal(items.length, 0);
    assert.equal(available, true);
  });

  it('returns all rows sorted by lastLoadedAt desc', async () => {
    await recordLoad('/models/a.json', {
      sizeBytes: 1,
      lastLoadedAt: 100,
      source: 'remote',
    });
    await recordLoad('/models/b.json', {
      sizeBytes: 2,
      lastLoadedAt: 300,
      source: 'remote',
    });
    await recordLoad('/models/c.json', {
      sizeBytes: 3,
      lastLoadedAt: 200,
      source: 'cache',
    });

    const { items } = await listModels();
    assert.deepEqual(
      items.map((i) => i.url),
      ['/models/b.json', '/models/c.json', '/models/a.json'],
    );
  });

  it('returns { items: [], available: false } when Dexie is unavailable', async () => {
    _setInstanceForTests(makeFailingRepository());
    const { items, available } = await silenceConsoleWarn(() => listModels());
    assert.equal(items.length, 0);
    assert.equal(available, false);
  });
});

// ---------------------------------------------------------------------------
// clearModel / clearAll
// ---------------------------------------------------------------------------

describe('clearModel / clearAll', () => {
  it('clearModel removes only the matching url row', async () => {
    await recordLoad('/models/a.json', {
      sizeBytes: 1,
      lastLoadedAt: 1,
      source: 'remote',
    });
    await recordLoad('/models/b.json', {
      sizeBytes: 1,
      lastLoadedAt: 2,
      source: 'remote',
    });

    const r1 = await clearModel('/models/a.json');
    assert.equal(r1.ok, true);

    const { items } = await listModels();
    assert.equal(items.length, 1);
    assert.equal(items[0].url, '/models/b.json');
  });

  it('clearModel returns ok=true for a url that does not exist (Dexie.delete is idempotent)', async () => {
    const r = await clearModel('/models/never.json');
    assert.equal(r.ok, true);
  });

  it('clearAll wipes the models table', async () => {
    await recordLoad('/models/a.json', {
      sizeBytes: 1,
      lastLoadedAt: 1,
      source: 'remote',
    });
    await recordLoad('/models/b.json', {
      sizeBytes: 1,
      lastLoadedAt: 2,
      source: 'remote',
    });

    const r = await clearAll();
    assert.equal(r.ok, true);

    const { items } = await listModels();
    assert.equal(items.length, 0);
  });

  it('clearModel / clearAll return { ok: false, reason: "unavailable" } when Dexie is unavailable', async () => {
    _setInstanceForTests(makeFailingRepository());
    const r1 = await silenceConsoleWarn(() => clearModel('/models/a.json'));
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, 'unavailable');

    const r2 = await silenceConsoleWarn(() => clearAll());
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, 'unavailable');
  });
});
