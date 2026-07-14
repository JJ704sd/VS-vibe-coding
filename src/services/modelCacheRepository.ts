// modelCacheRepository — Dexie-backed 元数据索引
//
// 目的:
//   把"曾经加载过哪些模型"这条线索从内存/console 里搬到持久层,作为
//   SPEC §4.1 "DICOM/离线推理" 部分的最小落地,以及后续 Dexie 接管
//   binary (替换 TF.js `indexeddb://` IOHandler) 的前置工作。
//
// 设计边界 (commit 1, 2026-07-14):
//   1. 本仓库只索引元数据 (url/sizeBytes/lastLoadedAt/source),binary
//      (model.json + weights shard) 仍由 TF.js 自带的 `indexeddb://`
//      IOHandler 落盘。两者使用不同 IndexedDB dbName (本仓库
//      `ecg-model-cache` vs TF.js 默认 `tensorflowjs`),互不干扰。
//   2. 所有 API 不抛 — IndexedDB 不可用 (Safari 隐身模式 / 浏览器禁用 /
//      配额耗尽) 时静默降级为"no-op",业务侧用 isAvailable() 探测。
//   3. 主键为 url:同 modelUrl 反复加载只保留一行,upsert 语义。
//   4. 后续 PR 会把 binary 也搬进 Dexie (v2 schema 加 modelJson / weights
//      Blob 字段);届时 TF.js `indexeddb://` 路径可下线。
//
// Dexie 加载策略 (commit 2 调整, 2026-07-14):
//   Dexie (~70 KB) 不在首屏必需,只在 `loadModel` 成功后写一次元数据时
//   才用。为避免把 70 KB 拖进 main entrypoint 超 webpack 硬性 budget
//   (`maxEntrypointSize: 1600000`, webpack.config.js:222),Dexie 走
//   `import('dexie')` 动态加载,首次 recordLoad 触发一次,后续命中
//   module cache。这跟 firebase / tensorflow 的 async chunk 处理一致。
//
// 与已有命名空间的关系:
//   本仓库 dbName "ecg-model-cache" 故意与 modelService.ts 的
//   MODEL_CACHE_NAMESPACE ("ecg-model-cache") 名字相近但不是同一物 —
//   前者是 IndexedDB 的 database name,后者是 TF.js `indexeddb://` 协议
//   URL 的 key 前缀。

import type Dexie from 'dexie';
import type { Table } from 'dexie';

/** 模型来源标签 */
export type ModelCacheSource = 'remote' | 'cache' | 'cache-write-failed';

/** 缓存元数据一行 */
export interface ModelCacheMeta {
  /** 模型 URL,主键。加载时由调用方传 modelService.modelUrl */
  url: string;
  /** TF.js 权重 + model.json 的估算字节数;cache 写失败或未知时为 0 */
  sizeBytes: number;
  /** 加载时间,epoch ms */
  lastLoadedAt: number;
  /**
   * 来源:
   *   - `remote`              远程下载成功
   *   - `cache`               远程 404 但本地 IndexedDB 命中
   *   - `cache-write-failed`  远程下载成功但 IndexedDB 写入失败(A-07)
   */
  source: ModelCacheSource;
}

/** `models` table 的强类型 Dexie 扩展 */
type DexieWithModels = Dexie & { models: Table<ModelCacheMeta, string> };

export interface ModelCacheRecordResult {
  recorded: boolean;
  reason?: 'unavailable' | 'error';
}

export interface ModelCacheDeleteResult {
  ok: boolean;
  reason?: 'unavailable' | 'error';
}

export interface ModelCacheListResult {
  items: ModelCacheMeta[];
  available: boolean;
}

let _db: DexieWithModels | null = null;
let _openAttempted = false;
let _openFailed = false;

/**
 * 内部 lazy init:第一次访问才 dynamic-import Dexie,new + open。
 * 失败一次后保持降级标记,不再 retry — 避免每次 recordLoad / listModels
 * 都触发 import + open + catch 的开销。
 *
 * 测试可以通过 `_setInstanceForTests` 直接注入 fake `_db`,绕过 dynamic
 * import / 真实 Dexie open,跑出"IndexedDB 不可用"降级路径。
 */
async function getDb(): Promise<DexieWithModels | null> {
  if (_openFailed) return null;
  if (_db && _openAttempted) return _db;
  try {
    // 优先用测试注入的 fake(_setInstanceForTests 设的);否则 dynamic-import
    // 真 Dexie 并构造 schema。
    let db: DexieWithModels | null = _db;
    if (!db) {
      const { default: DexieClass } = await import('dexie');
      const fresh = new DexieClass('ecg-model-cache') as DexieWithModels;
      fresh.version(1).stores({
        models: '&url, lastLoadedAt, source',
      });
      db = fresh;
    }
    await db.open();
    _db = db;
    _openAttempted = true;
    return _db;
  } catch (err) {
    _openFailed = true;
    console.warn(
      '[modelCacheRepository] IndexedDB unavailable, cache metadata will be skipped:',
      err,
    );
    return null;
  }
}

/**
 * 探测 Dexie 当前环境是否可用。失败一次后保持降级标记,不再 retry。
 */
export async function isAvailable(): Promise<boolean> {
  return (await getDb()) !== null;
}

/**
 * 记录一次加载。upsert 语义:同 url 第二次写入会覆盖 sizeBytes /
 * lastLoadedAt / source,行数保持为 1。失败不抛。
 */
export async function recordLoad(
  url: string,
  meta: Omit<ModelCacheMeta, 'url'>,
): Promise<ModelCacheRecordResult> {
  const db = await getDb();
  if (!db) return { recorded: false, reason: 'unavailable' };
  try {
    await db.models.put({ url, ...meta });
    return { recorded: true };
  } catch (err) {
    console.warn('[modelCacheRepository] recordLoad failed:', err);
    return { recorded: false, reason: 'error' };
  }
}

/** 列出全部缓存模型,按 lastLoadedAt 倒序。失败时返回空数组 + available=false。 */
export async function listModels(): Promise<ModelCacheListResult> {
  const db = await getDb();
  if (!db) return { items: [], available: false };
  try {
    const items = await db.models.orderBy('lastLoadedAt').reverse().toArray();
    return { items, available: true };
  } catch (err) {
    console.warn('[modelCacheRepository] listModels failed:', err);
    return { items: [], available: false };
  }
}

/**
 * 移除单条元数据。注:只清 Dexie;TF.js `indexeddb://` 里的 binary 由
 * 调用方在合适时机清理 (本仓库不代为清理,避免主链路误删导致再次冷启动
 * 读不到缓存)。
 */
export async function clearModel(url: string): Promise<ModelCacheDeleteResult> {
  const db = await getDb();
  if (!db) return { ok: false, reason: 'unavailable' };
  try {
    await db.models.delete(url);
    return { ok: true };
  } catch (err) {
    console.warn('[modelCacheRepository] clearModel failed:', err);
    return { ok: false, reason: 'error' };
  }
}

/** 清空全部元数据。binary 同样不代为清理,见 clearModel 注释。 */
export async function clearAll(): Promise<ModelCacheDeleteResult> {
  const db = await getDb();
  if (!db) return { ok: false, reason: 'unavailable' };
  try {
    await db.models.clear();
    return { ok: true };
  } catch (err) {
    console.warn('[modelCacheRepository] clearAll failed:', err);
    return { ok: false, reason: 'error' };
  }
}

/**
 * 测试/调试用:重置单例 + open 状态标记。生产 bundle 不主动调,
 * 但导出便于单测在 beforeEach 隔离状态。
 */
export function _resetForTests(): void {
  _db = null;
  _openAttempted = false;
  _openFailed = false;
}

/**
 * 测试/调试用:把单例替换为指定实例(用于注入会失败的 fake Dexie)。
 * 传 null 等价于 _resetForTests。
 *
 * 类型用 unknown 因为 fake 是 plain object,只要求形状像 Dexie
 * (有 open / models 字段)。调用方负责把 fake cast 过来。
 *
 * 注意:不设 `_openAttempted = true`,这样 `getDb()` 看到 `_db` 存在但
 * open 未尝试,会真去调 `_db.open()`。fake `open` 失败时 → 走 catch 分支
 * 设 `_openFailed = true` → 下次 `getDb()` 短路返回 null。
 */
export function _setInstanceForTests(instance: DexieWithModels | null): void {
  _db = instance;
  _openAttempted = false;
  _openFailed = false;
}
