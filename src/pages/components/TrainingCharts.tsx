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
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>暂无训练曲线数据</div>;
  }

  // Loss chart
  const lossOption = {
    title: { text: 'Loss 曲线', left: 'center', textStyle: { fontSize: 14 } },
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

  // Accuracy/F1 chart
  const accF1Option = {
    title: { text: 'Accuracy / F1 曲线', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    legend: { data: ['Train Acc', 'Val Macro F1'], top: 28 },
    xAxis: { type: 'category', data: epochs.map((e) => e.epoch), name: 'Epoch' },
    yAxis: { type: 'value', name: 'Value' },
    series: [
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
    ],
    grid: { left: 50, right: 20, bottom: 40, top: 60 },
  };

  // Per-class F1 bar chart
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

  // Confusion matrix heatmap
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
      <ReactECharts option={perClassF1Option} style={{ height: 300 }} />
      {confusionData.length > 0 && <ReactECharts option={confusionMatrixOption} style={{ height: 300 }} />}
    </div>
  );
};

export default TrainingCharts;
