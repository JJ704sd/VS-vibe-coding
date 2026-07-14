// modelCacheRepository 单测(commit 1, 2026-07-14)
//
// 策略:
//   1. fake-indexeddb(由 test-setup.mjs 注入)让 Dexie 在 Node 里能真的 open
//   2. 每个 case 之前 _resetForTests + 清 DB,保证用例互不污染
//   3. 测真链路:open / put / get / orderBy / delete / clear 全跑 Dexie
//   4. 失败路径通过 _setInstanceForTests 注入"会抛的 fake Dexie"覆盖

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import Dexie from 'dexie';

import {
  ModelCacheRepository,
  _resetForTests,
  _setInstanceForTests,
  clearAll,
  clearModel,
  isAvailable,
  listModels,
  recordLoad,
} from './modelCacheRepository.ts';

const DB_NAME = 'ecg-model-cache';

async function wipeDatabase(): Promise<void> {
  // Dexie 提供了 delete(name) 静态方法,比清表更彻底。
  try {
    await Dexie.delete(DB_NAME);
  } catch {
    // 第一次跑 / 不存在,忽略
  }
}

/** 构造一个 open() 永远 reject 的 ModelCacheRepository 替身,用于模拟"IndexedDB 不可用" */
function makeFailingRepository(): ModelCacheRepository {
  // 基类已经声明了 `models: Table<ModelCacheMeta, string>`,这里只 override open。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Failing = class extends ModelCacheRepository {
    override open(): ReturnType<Dexie['open']> {
      return Promise.reject(new Error('IndexedDB unavailable (simulated)')) as ReturnType<Dexie['open']>;
    }
  };
  return new Failing();
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
// Dexie schema
// ---------------------------------------------------------------------------

describe('Dexie schema', () => {
  it('opens the database with name "ecg-model-cache" and version 1', async () => {
    const repo = new ModelCacheRepository();
    assert.equal(repo.name, 'ecg-model-cache');
    // 验证 version(1) 已注册:open() 后 .tables 包含 'models'。
    await repo.open();
    const tableNames = repo.tables.map((t) => t.name);
    assert.ok(
      tableNames.includes('models'),
      'models table should be registered by version(1).stores(...)',
    );
    await repo.close();
  });

  it('exposes a "models" table indexed by url (primary) + lastLoadedAt + source', async () => {
    const repo = new ModelCacheRepository();
    assert.equal(repo.models.name, 'models');
    const schema = repo.models.schema;
    // &url = unique primary key
    assert.equal(schema.primKey.keyPath, 'url', 'primary key should be url');
    // lastLoadedAt + source 必须出现在 indexes
    const indexNames = schema.indexes.map((idx) => idx.name);
    assert.ok(indexNames.includes('lastLoadedAt'), 'lastLoadedAt should be indexed');
    assert.ok(indexNames.includes('source'), 'source should be indexed');
    await repo.close();
  });

  it('isAvailable() returns true after the first successful open', async () => {
    assert.equal(await isAvailable(), true);
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

  it('returns { items: [], available: false } when Dexie.open() rejects', async () => {
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
