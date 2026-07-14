// ModelCachePanel — "已缓存模型" 管理面板
//
// 目的:
//   commit 1 + commit 2 把 Dexie 元数据索引和 ModelService 集成打通后,
//   用户还看不到自己的模型被记录了。本组件让这条线索"可见可清",
//   在 AI Models 页面里挂一个折叠 Card:
//   - 列出 Dexie 里的全部 model 元数据(URL / 大小 / 来源 / 加载时间)
//   - 支持单行清除 / 清除全部(带 Modal.confirm 二次确认)
//   - 出错 toast,不静默吞
//
// 边界(commit 3 明确不做的):
//   - 只清 Dexie 元数据,TF.js `indexeddb://` 里的 binary 留给后续 PR
//     (SPEC §4.1 v2 schema 把 binary 也搬进 Dexie 时一并处理)
//   - 不接管"加载 / 切换"主路径;那仍是 modelService 的事
//   - 监听 visibilitychange 之类的"自动 refresh"本 commit 不做,只
//     mount 时拉一次 + 用户手动刷新 + 操作后重读
//
// 与 bundle budget 的关系(commit 2 铺垫):
//   AIModels 是 lazy page (App.tsx:15),ModelCachePanel 静态 import
//   modelCacheRepository 不会拉回 main entrypoint。Dexie 自身在
//   webpack.config.js:dexie cacheGroup 走 `chunks: 'async'`,首次
//   listModels 才触发 fetch。

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import {
  clearAll as repoClearAll,
  clearModel as repoClearModel,
  listModels as repoListModels,
  type ModelCacheDeleteResult,
  type ModelCacheListResult,
  type ModelCacheMeta,
  type ModelCacheSource,
} from '../services/modelCacheRepository';

const { Text } = Typography;

const SOURCE_LABEL: Record<ModelCacheSource, { text: string; color: string }> = {
  remote: { text: '远程下载', color: 'blue' },
  cache: { text: '本地缓存', color: 'green' },
  'cache-write-failed': { text: '缓存写入失败', color: 'orange' },
};

function formatSize(sizeBytes: number): string {
  if (!sizeBytes) return '未知大小';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatRelativeTime(epochMs: number): string {
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return '刚刚';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(epochMs).toLocaleDateString();
}

function shortUrl(url: string, max = 60): string {
  if (url.length <= max) return url;
  return `${url.slice(0, max - 1)}…`;
}

export interface ModelCachePanelServices {
  listModels: () => Promise<ModelCacheListResult>;
  clearModel: (url: string) => Promise<ModelCacheDeleteResult>;
  clearAll: () => Promise<ModelCacheDeleteResult>;
}

const DEFAULT_SERVICES: ModelCachePanelServices = {
  listModels: repoListModels,
  clearModel: repoClearModel,
  clearAll: repoClearAll,
};

export interface ModelCachePanelProps {
  /**
   * 测试/调试用:替换 listModels / clearModel / clearAll 的实现。
   * 默认走 modelCacheRepository 真实 API。
   */
  services?: ModelCachePanelServices;
}

/**
 * ModelCachePanel — AI Models 页面里"已缓存模型 (Dexie)"管理面板。
 * 行为:mount 调 listModels,操作后重读,失败 toast。
 */
export const ModelCachePanel: React.FC<ModelCachePanelProps> = ({ services = DEFAULT_SERVICES }) => {
  const [items, setItems] = useState<ModelCacheMeta[]>([]);
  const [available, setAvailable] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [busyUrl, setBusyUrl] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await services.listModels();
      setItems(result.items);
      setAvailable(result.available);
    } catch (err) {
      console.warn('[ModelCachePanel] refresh failed:', err);
      message.error('读取 Dexie 缓存失败,请查看控制台');
    } finally {
      setLoading(false);
    }
  }, [services]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClearOne = useCallback(
    async (url: string) => {
      setBusyUrl(url);
      try {
        const r = await services.clearModel(url);
        if (r.ok) {
          message.success(`已清除 ${shortUrl(url, 30)}`);
          await refresh();
        } else {
          message.error(`清除失败:${r.reason ?? '未知'}`);
        }
      } catch (err) {
        console.warn('[ModelCachePanel] clearModel failed:', err);
        message.error('清除单条失败,请查看控制台');
      } finally {
        setBusyUrl(null);
      }
    },
    [services, refresh],
  );

  const handleClearAll = useCallback(async () => {
    setBusyAll(true);
    try {
      const r = await services.clearAll();
      if (r.ok) {
        message.success(`已清除全部 ${items.length} 条 Dexie 缓存元数据`);
        await refresh();
      } else {
        message.error(`清除失败:${r.reason ?? '未知'}`);
      }
    } catch (err) {
      console.warn('[ModelCachePanel] clearAll failed:', err);
      message.error('清除全部失败,请查看控制台');
    } finally {
      setBusyAll(false);
    }
  }, [services, refresh, items.length]);

  const columns: ColumnsType<ModelCacheMeta> = useMemo(
    () => [
      {
        title: 'URL',
        dataIndex: 'url',
        key: 'url',
        render: (url: string) => (
          <Tooltip title={url} placement="topLeft">
            <code>{shortUrl(url)}</code>
          </Tooltip>
        ),
      },
      {
        title: '大小',
        dataIndex: 'sizeBytes',
        key: 'sizeBytes',
        width: 110,
        render: formatSize,
      },
      {
        title: '来源',
        dataIndex: 'source',
        key: 'source',
        width: 130,
        render: (source: ModelCacheSource) => {
          const label = SOURCE_LABEL[source];
          return <Tag color={label.color}>{label.text}</Tag>;
        },
      },
      {
        title: '加载时间',
        dataIndex: 'lastLoadedAt',
        key: 'lastLoadedAt',
        width: 130,
        render: (epochMs: number) => formatRelativeTime(epochMs),
      },
      {
        title: '操作',
        key: 'action',
        width: 110,
        render: (_: unknown, record: ModelCacheMeta) => (
          <Popconfirm
            title="清除这条 Dexie 缓存元数据?"
            description="只清元数据,TF.js `indexeddb://` 里的 binary 不动"
            okText="确认清除"
            cancelText="取消"
            onConfirm={() => void handleClearOne(record.url)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={busyUrl === record.url}
            >
              清除
            </Button>
          </Popconfirm>
        ),
      },
    ],
    [busyUrl, handleClearOne],
  );

  return (
    <Card
      className="section-card model-cache-panel"
      title={
        <Space>
          <span>已缓存模型</span>
          <Tag color={available ? 'blue' : 'default'}>
            Dexie{available ? ' · 已连接' : ' · 不可用'}
          </Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {items.length} 条
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void refresh()}
            loading={loading}
          >
            刷新
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={handleClearAll}
            loading={busyAll}
            disabled={items.length === 0}
          >
            清除全部
          </Button>
        </Space>
      }
    >
      {!available ? (
        <Alert
          type="warning"
          showIcon
          icon={<QuestionCircleOutlined />}
          message="Dexie 在当前环境不可用"
          description={
            <>
              常见原因:Safari 隐身模式、浏览器禁用 IndexedDB、配额耗尽。
              加载模型时元数据会被静默跳过 — 推理功能本身不受影响。
            </>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Table<ModelCacheMeta>
        className="table-card"
        columns={columns}
        dataSource={items}
        rowKey="url"
        pagination={false}
        loading={loading}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无缓存模型。加载一次后会自动出现在这里。"
            />
          ),
        }}
        size="small"
      />

      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        注:本面板只显示 TF.js 模型加载后写入 Dexie 的元数据索引。model 的
        binary(model.json + weights shard)仍由 TF.js 自带的 <code>indexeddb://</code>{' '}
        落盘,不归本面板管。v2 schema 会把 binary 也搬进 Dexie,届时这里补上
        字节大小估算。
      </Text>
    </Card>
  );
};

export default ModelCachePanel;
