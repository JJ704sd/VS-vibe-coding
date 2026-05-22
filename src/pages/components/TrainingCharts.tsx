import React from 'react';
import ReactECharts from 'echarts-for-react';
import type { EpochData, EvaluationData } from '../../services/trainingApi';

interface Props {
  epochs: EpochData[];
  evalData?: EvaluationData | null;
}

const CLASS_LABELS = ['N', 'S', 'V', 'F', 'Q'];

const TrainingCharts: React.FC<Props> = ({ epochs, evalData }) => {
  if (epochs.length === 0) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>No training curve data</div>;
  }

  const hasValAuc = epochs.some((e) => typeof e.val_auc === 'number' && e.val_auc > 0);
  const hasThreshold = epochs.some((e) => typeof e.threshold === 'number' && e.threshold > 0);

  const lossOption = {
    title: { text: 'Loss Curve', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: epochs.map((e) => e.epoch), name: 'Epoch' },
    yAxis: { type: 'value', name: 'Loss' },
    series: [
      {
        name: 'Train Loss',
        type: 'line',
        data: epochs.map((e) => e.train_loss),
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: '#2563eb' },
      },
    ],
    grid: { left: 50, right: 20, bottom: 40, top: 50 },
  };

  const metricSeries = [
    {
      name: 'Train Acc',
      type: 'line',
      data: epochs.map((e) => e.train_acc),
      smooth: true,
      lineStyle: { width: 2 },
      itemStyle: { color: '#2563eb' },
    },
    {
      name: 'Val Macro F1',
      type: 'line',
      data: epochs.map((e) => e.val_macro_f1),
      smooth: true,
      lineStyle: { width: 2 },
      itemStyle: { color: '#0f9d9a' },
    },
    ...(hasValAuc
      ? [
          {
            name: 'Val AUC',
            type: 'line',
            data: epochs.map((e) => e.val_auc ?? 0),
            smooth: true,
            lineStyle: { width: 2 },
            itemStyle: { color: '#7c3aed' },
          },
        ]
      : []),
  ];

  const accF1Option = {
    title: { text: 'Accuracy / F1 / AUC Curve', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { data: metricSeries.map((item) => item.name), top: 28 },
    xAxis: { type: 'category', data: epochs.map((e) => e.epoch), name: 'Epoch' },
    yAxis: { type: 'value', name: 'Value' },
    series: metricSeries,
    grid: { left: 50, right: 20, bottom: 40, top: 60 },
  };

  const thresholdOption = {
    title: { text: 'Threshold Curve', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: epochs.map((e) => e.epoch), name: 'Epoch' },
    yAxis: { type: 'value', name: 'Threshold', min: 0, max: 1 },
    series: [
      {
        name: 'Threshold',
        type: 'line',
        data: epochs.map((e) => e.threshold ?? 0),
        smooth: true,
        lineStyle: { width: 2 },
        itemStyle: { color: '#f59e0b' },
      },
    ],
    grid: { left: 50, right: 20, bottom: 40, top: 50 },
  };

  const perClassF1Option = {
    title: { text: 'Per-Class F1', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: CLASS_LABELS,
      name: 'Class',
    },
    yAxis: { type: 'value', name: 'F1', min: 0, max: 1 },
    series: [
      {
        name: 'F1',
        type: 'bar',
        data: evalData ? CLASS_LABELS.map((c) => evalData.test_per_class_f1[c] ?? 0) : [],
        itemStyle: { color: '#2563eb' },
      },
    ],
    grid: { left: 50, right: 20, bottom: 40, top: 50 },
  };

  const confusionData: [number, number, number][] = [];
  if (evalData && evalData.confusion_matrix) {
    evalData.confusion_matrix.forEach((row, i) => {
      row.forEach((val, j) => {
        confusionData.push([j, i, val]);
      });
    });
  }

  const confusionMatrixOption = {
    title: { text: 'Confusion Matrix', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { position: 'top' },
    xAxis: { type: 'category', data: CLASS_LABELS, name: 'Predicted' },
    yAxis: { type: 'category', data: CLASS_LABELS, name: 'True' },
    visualMap: { min: 0, max: 100, calculable: true, orient: 'vertical', right: 10, top: 'center' },
    series: [
      {
        name: 'Count',
        type: 'heatmap',
        data: confusionData,
        label: { show: true, formatter: (p: { value: [number, number, number] }) => String(p.value[2]) },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0, 0, 0, 0.5)' } },
      },
    ],
    grid: { left: 50, right: 80, bottom: 50, top: 50 },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <ReactECharts option={lossOption} style={{ height: 300 }} />
      <ReactECharts option={accF1Option} style={{ height: 300 }} />
      {hasThreshold && <ReactECharts option={thresholdOption} style={{ height: 260 }} />}
      <ReactECharts option={perClassF1Option} style={{ height: 300 }} />
      {confusionData.length > 0 && <ReactECharts option={confusionMatrixOption} style={{ height: 300 }} />}
    </div>
  );
};

export default TrainingCharts;
