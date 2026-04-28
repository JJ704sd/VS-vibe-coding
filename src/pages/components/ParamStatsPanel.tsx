import React, { useState } from 'react';
import { Card, Descriptions, Select, Typography } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { ParamStats, ParamHistory } from '../../services/trainingApi';

interface Props {
  paramStats?: ParamStats | null;
  paramHistory?: ParamHistory | null;
  live?: boolean;
}

const ParamStatsPanel: React.FC<Props> = ({ paramStats, paramHistory, live }) => {
  const [selectedLayer, setSelectedLayer] = useState<string>('');

  // Live mode: show current param stats
  if (live && paramStats) {
    const layers = paramStats.layers.map((l) => l.name);
    const currentLayer = paramStats.layers.find((l) => l.name === selectedLayer) ?? paramStats.layers[0];
    const effectiveLayer = selectedLayer ? currentLayer : paramStats.layers[0];

    return (
      <Card size="small">
        <Descriptions column={2} size="small">
          <Descriptions.Item label="Global Norm">{paramStats.global_norm.toFixed(6)}</Descriptions.Item>
          <Descriptions.Item label="Trainable Params">{paramStats.trainable_params.toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="Frozen Params">{paramStats.frozen_params.toLocaleString()}</Descriptions.Item>
        </Descriptions>
        <div style={{ marginTop: 16 }}>
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            Layer Statistics
          </Typography.Text>
          <Select
            style={{ width: 300 }}
            placeholder="Select a layer"
            value={selectedLayer || effectiveLayer?.name}
            onChange={setSelectedLayer}
            options={layers.map((n) => ({ label: n, value: n }))}
          />
          {effectiveLayer && (
            <Descriptions column={2} size="small" style={{ marginTop: 12 }}>
              <Descriptions.Item label="Mean">{effectiveLayer.mean.toFixed(6)}</Descriptions.Item>
              <Descriptions.Item label="Std">{effectiveLayer.std.toFixed(6)}</Descriptions.Item>
              <Descriptions.Item label="Min">{effectiveLayer.min.toFixed(6)}</Descriptions.Item>
              <Descriptions.Item label="Max">{effectiveLayer.max.toFixed(6)}</Descriptions.Item>
              {effectiveLayer.grad_mean != null && (
                <Descriptions.Item label="Grad Mean">{effectiveLayer.grad_mean.toFixed(6)}</Descriptions.Item>
              )}
            </Descriptions>
          )}
        </div>
      </Card>
    );
  }

  // History mode: show param history charts
  if (paramHistory && paramHistory.epochs.length > 0) {
    const layerNames = paramHistory.epochs[0].layer_summary.map((l) => l.name);
    const effectiveLayer = selectedLayer || layerNames[0];

    // Weight std per layer chart
    const stdOption = {
      title: { text: 'Weight Std per Layer', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: layerNames,
        name: 'Layer',
        axisLabel: { rotate: 30, interval: 0 },
      },
      yAxis: { type: 'value', name: 'Std' },
      series: [
        {
          name: 'Std',
          type: 'line',
          data: paramHistory.epochs.map((e) => {
            const layer = e.layer_summary.find((l) => l.name === effectiveLayer);
            return layer?.std ?? 0;
          }),
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: '#2563eb' },
        },
      ],
      grid: { left: 60, right: 20, bottom: 60, top: 50 },
    };

    // Global gradient norm chart
    const globalNormOption = {
      title: { text: 'Global Gradient Norm', left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: paramHistory.epochs.map((e) => e.epoch), name: 'Epoch' },
      yAxis: { type: 'value', name: 'Global Norm' },
      series: [
        {
          name: 'Global Norm',
          type: 'line',
          data: paramHistory.epochs.map((e) => e.global_norm),
          smooth: true,
          lineStyle: { width: 2 },
          itemStyle: { color: '#0f9d9a' },
          areaStyle: { color: 'rgba(15, 157, 154, 0.1)' },
        },
      ],
      grid: { left: 60, right: 20, bottom: 40, top: 50 },
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Select
          style={{ width: 300 }}
          placeholder="Select a layer"
          value={effectiveLayer}
          onChange={setSelectedLayer}
          options={layerNames.map((n) => ({ label: n, value: n }))}
        />
        <ReactECharts option={stdOption} style={{ height: 300 }} />
        <ReactECharts option={globalNormOption} style={{ height: 300 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
      {live ? '等待参数统计数据...' : '暂无历史参数数据'}
    </div>
  );
};

export default ParamStatsPanel;
