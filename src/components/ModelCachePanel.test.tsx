// ModelCachePanel 单测(commit 3, 2026-07-14)
//
// 策略:
//   - happy-dom 渲染(由 test-setup.mjs 注入)
//   - 通过 props.services 注入 fake repository,完全控制 listModels /
//     clearModel / clearAll 的返回值,不走真 Dexie
//   - antd message / Popconfirm 在 happy-dom 下行为 OK;不 mock
//   - 用 `cleanup()` 在 afterEach 拆 antd 残留 portal
//   - 文本断言用 `assert.ok(screen.getByText(/regex/))`,antd 把行内容
//     拆成多个 element 时 regex 比 string 更稳

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ModelCachePanel } from './ModelCachePanel.tsx';
import type { ModelCachePanelServices } from './ModelCachePanel.tsx';
import type {
  ModelCacheDeleteResult,
  ModelCacheListResult,
  ModelCacheMeta,
} from '../services/modelCacheRepository.ts';

/** 构造一个内存 fake repository,初始 items 数组 + 计数器(spy 模式) */
function makeFakeRepo(initial: ModelCacheMeta[] = []): ModelCachePanelServices & {
  calls: { list: number; clearOne: string[]; clearAll: number };
} {
  let items: ModelCacheMeta[] = initial.map((i) => ({ ...i }));
  const calls = { list: 0, clearOne: [] as string[], clearAll: 0 };
  return {
    calls,
    async listModels(): Promise<ModelCacheListResult> {
      calls.list += 1;
      return {
        items: [...items].sort((a, b) => b.lastLoadedAt - a.lastLoadedAt),
        available: true,
      };
    },
    async clearModel(url: string): Promise<ModelCacheDeleteResult> {
      calls.clearOne.push(url);
      const before = items.length;
      items = items.filter((i) => i.url !== url);
      return { ok: items.length < before };
    },
    async clearAll(): Promise<ModelCacheDeleteResult> {
      calls.clearAll += 1;
      items = [];
      return { ok: true };
    },
  };
}

const SAMPLE: ModelCacheMeta[] = [
  { url: '/models/ecg-classifier/model.json', sizeBytes: 25_000_000, lastLoadedAt: 200, source: 'remote' },
  { url: 'https://cdn.example.com/seg-v2.1/model.json', sizeBytes: 45_000_000, lastLoadedAt: 300, source: 'cache' },
  { url: '/models/arr-detector/model.json', sizeBytes: 0, lastLoadedAt: 100, source: 'cache-write-failed' },
];

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

describe('ModelCachePanel 渲染', () => {
  it('空状态:显示 "暂无缓存模型" 而非崩溃', async () => {
    const repo = makeFakeRepo([]);
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(
        screen.getByText(/暂无缓存模型/),
        '空状态文案应该出现',
      );
    });
    assert.equal(repo.calls.list, 1, 'mount 时 listModels 调一次');
  });

  it('有数据:按 lastLoadedAt desc 渲染 URL / 大小 / 来源 / 时间', async () => {
    const repo = makeFakeRepo(SAMPLE);
    render(<ModelCachePanel services={repo} />);

    // 等待 mount + refresh 完成
    await waitFor(() => {
      assert.ok(screen.getByText(/已缓存模型/));
    });
    // SAMPLE[1] lastLoadedAt=300 排第一(seg-v2.1)
    assert.ok(screen.getByText(/seg-v2\.1/), 'top row 是 lastLoadedAt=300 那条');
    // 来源中文标签
    assert.ok(screen.getByText('远程下载'), 'source=remote 渲染"远程下载"');
    assert.ok(screen.getByText('本地缓存'), 'source=cache 渲染"本地缓存"');
    assert.ok(screen.getByText('缓存写入失败'), 'source=cache-write-failed 渲染"缓存写入失败"');

    // sizeBytes=0 的行显示"未知大小"
    assert.ok(screen.getByText('未知大小'), 'sizeBytes=0 → "未知大小"');
    // 25_000_000 → 23.8 MB(25 / 1024 / 1024)
    assert.ok(screen.getByText('23.8 MB'), '25_000_000 → 23.8 MB');
  });

  it('Dexie 不可用时:available=false 状态显示 warning Alert + 标签变 "不可用"', async () => {
    const repo: ModelCachePanelServices = {
      async listModels() {
        return { items: [], available: false };
      },
      async clearModel() {
        return { ok: false, reason: 'unavailable' };
      },
      async clearAll() {
        return { ok: false, reason: 'unavailable' };
      },
    };
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText(/Dexie 在当前环境不可用/), 'warning alert 出现');
    });
    assert.ok(screen.getByText(/Dexie · 不可用/), 'Card 标签变 "不可用"');
  });

  it('Card 标题包含 "已缓存模型" + 条数计数', async () => {
    const repo = makeFakeRepo(SAMPLE);
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText('已缓存模型'));
    });
    assert.ok(screen.getByText('3 条'), '3 条 SAMPLE 计数');
    assert.ok(screen.getByText(/Dexie · 已连接/), 'available=true 标签');
  });
});

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

describe('ModelCachePanel 操作', () => {
  it('点击单行 "清除" → 弹 Popconfirm;确认后调 clearModel(url=top) + refresh', async () => {
    const repo = makeFakeRepo(SAMPLE);
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText(/已缓存模型/));
    });

    // 找到 seg-v2.1 这一行的"清除"按钮
    // sorted[0] = seg-v2.1,清除按钮有 "清除" text
    const clearButtons = screen.getAllByRole('button', { name: /清除/ });
    // 第一个 row 内的清除按钮
    const topRowClear = clearButtons.find(
      (b) => b.closest('tr')?.textContent?.includes('seg-v2.1'),
    );
    assert.ok(topRowClear, 'top row 清除按钮存在');
    await act(async () => {
      fireEvent.click(topRowClear);
    });

    // Popconfirm 弹出
    await waitFor(() => {
      assert.ok(
        screen.getByText(/清除这条 Dexie 缓存元数据\?/),
        'Popconfirm 二次确认文案',
      );
    });

    // 确认按钮 — Popconfirm 的 okText 唯一("确认清除"),用 getByText 精确找
    const confirmBtn = screen.getByText('确认清除');
    assert.ok(confirmBtn, 'Popconfirm 内的确认按钮存在');
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      assert.deepEqual(repo.calls.clearOne, [
        'https://cdn.example.com/seg-v2.1/model.json',
      ]);
    });
    assert.ok(
      repo.calls.list >= 2,
      `clearModel 之后会 refresh,listModels 调用次数 >= 2 (实际 ${repo.calls.list})`,
    );
  });

  it('点击 "清除全部" → 调 clearAll 并清空列表(无独立 confirm,直接执行)', async () => {
    const repo = makeFakeRepo(SAMPLE);
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText(/已缓存模型/));
    });

    const clearAllBtn = screen.getByRole('button', { name: /清除全部/ });
    await act(async () => {
      fireEvent.click(clearAllBtn);
    });

    await waitFor(() => {
      assert.equal(repo.calls.clearAll, 1);
    });
    await waitFor(() => {
      assert.ok(
        screen.getByText(/暂无缓存模型/),
        'clearAll 后列表为空 → 空状态文案出现',
      );
    });
  });

  it('点击 "刷新" → 再次调 listModels', async () => {
    const repo = makeFakeRepo(SAMPLE);
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText(/已缓存模型/));
    });
    const before = repo.calls.list;

    const refreshBtn = screen.getByRole('button', { name: /刷新/ });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    await waitFor(() => {
      assert.ok(repo.calls.list > before, `refresh 后 list 至少 +1 (实际 ${repo.calls.list - before})`);
    });
  });

  it('clearModel 返回 { ok: false } → 列表不变(不崩)', async () => {
    const repo: ModelCachePanelServices = {
      async listModels() {
        return { items: SAMPLE, available: true };
      },
      async clearModel() {
        return { ok: false, reason: 'unavailable' };
      },
      async clearAll() {
        return { ok: true };
      },
    };
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText(/已缓存模型/));
    });

    // 找 top row 清除按钮
    const clearButtons = screen.getAllByRole('button', { name: /清除/ });
    const topRowClear = clearButtons.find(
      (b) => b.closest('tr')?.textContent?.includes('seg-v2.1'),
    );
    assert.ok(topRowClear);
    await act(async () => {
      fireEvent.click(topRowClear);
    });
    const confirmBtn = screen.getByText('确认清除');
    assert.ok(confirmBtn);
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    // 列表仍存在(seg-v2.1 没被清掉)
    await waitFor(() => {
      assert.ok(screen.getByText(/seg-v2\.1/), '列表仍显示 seg-v2.1');
    });
  });

  it('listModels 抛错 → 组件不崩,Card 标题仍渲染', async () => {
    const consoleWarn = console.warn;
    console.warn = () => undefined;
    const repo: ModelCachePanelServices = {
      async listModels() {
        throw new Error('Simulated Dexie boom');
      },
      async clearModel() {
        return { ok: false };
      },
      async clearAll() {
        return { ok: false };
      },
    };
    render(<ModelCachePanel services={repo} />);

    await waitFor(() => {
      assert.ok(screen.getByText('已缓存模型'), 'Card 标题仍渲染');
    });
    console.warn = consoleWarn;
  });
});
