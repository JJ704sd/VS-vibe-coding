import React from 'react';
import { Card, Space, Typography, Progress, List, Tag } from 'antd';
import { ModelPrediction } from '../../types';

const { Text } = Typography;

interface AnnotationStats {
  total: number;
  rPeaks: number;
}

interface SignalMetricsProps {
  leads: { name: string; data: number[]; samplingRate: number }[];
  signalQuality: number;
  annotationStats: AnnotationStats;
  inferenceResults: ModelPrediction[];
  /**
   * True when ModelService fell back to the heuristic mock predictor. When
   * set, the AI results Card surfaces a MOCK chip next to its title so the
   * user can never mistake a heuristic std/mean/amplitude output for a real
   * TF.js model diagnosis. Defaults to false so existing call sites and
   * tests continue to render the same shape.
   */
  isUsingMockInference?: boolean;
}

const SignalMetrics: React.FC<SignalMetricsProps> = ({
  leads,
  signalQuality,
  annotationStats,
  inferenceResults,
  isUsingMockInference = false,
}) => {
  if (leads.length === 0) {
    return (
      <Card className="section-card" title="信号概览" extra={<Tag color="cyan">Metrics</Tag>}>
        <div className="empty-panel">暂无信号数据</div>
      </Card>
    );
  }

  return (
    <>
      <Card className="section-card" title="信号概览" extra={<Tag color="cyan">Metrics</Tag>}>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">导联数</Text>
            <Text strong>{leads.length}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">采样率</Text>
            <Text strong>{leads[0]?.samplingRate || 0} Hz</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">样本数</Text>
            <Text strong>{leads[0]?.data.length || 0}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">信号质量</Text>
            <Text strong>{signalQuality}%</Text>
          </div>
          <Progress percent={signalQuality} strokeColor={{ from: '#275ef1', to: '#0f9d9a' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">总标注数</Text>
            <Text strong>{annotationStats.total}</Text>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Text type="secondary">R 峰标注</Text>
            <Text strong>{annotationStats.rPeaks}</Text>
          </div>
        </Space>
      </Card>

      <Card
        className="section-card"
        title="AI 诊断结果"
        extra={
          <Space size={4}>
            {isUsingMockInference && (
              // The MOCK chip is the visual contract for BUG-2026-07-04-R-02:
              // whenever inference results on screen come from the heuristic
              // fallback (no real TF.js model), the user sees this chip. Tests
              // assert its presence by string match ("MOCK").
              <Tag color="orange" data-testid="mock-inference-chip">MOCK</Tag>
            )}
            <Tag color="magenta">Results</Tag>
          </Space>
        }
      >
        {inferenceResults.length > 0 ? (
          <List
            dataSource={inferenceResults}
            renderItem={(item) => (
              <List.Item style={{ paddingInline: 0 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Tag color={item.probability > 0.5 ? 'red' : 'blue'}>{item.className}</Tag>
                  <Progress
                    percent={Math.round(item.probability * 100)}
                    size="small"
                    status={item.probability > 0.5 ? 'exception' : 'normal'}
                  />
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <div className="empty-panel">请先加载模型并运行分析</div>
        )}
      </Card>
    </>
  );
};

export default SignalMetrics;
