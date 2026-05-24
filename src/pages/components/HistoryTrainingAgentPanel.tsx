import React, { useState } from 'react';
import { Alert, Button, Card, Col, List, Row, Space, Statistic, Table, Tag, Typography, message } from 'antd';
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  HistoryRound,
  TrainingHistoryDiagnosis,
  getTrainingHistoryDiagnosis,
} from '../../services/trainingApi';

const { Text } = Typography;

const getSeverityTag = (severity: TrainingHistoryDiagnosis['severity']): { color: string; label: string } => {
  if (severity === 'critical') return { color: 'red', label: '需要处理' };
  if (severity === 'warning') return { color: 'orange', label: '存在异常' };
  return { color: 'green', label: '历史健康' };
};

const getTrendTag = (trend: TrainingHistoryDiagnosis['trend']): { color: string; label: string } => {
  if (trend.direction === 'improving') return { color: 'green', label: '最近提升' };
  if (trend.direction === 'declining') return { color: 'red', label: '最近下降' };
  return { color: 'default', label: '趋势平稳' };
};

const formatPercent = (value?: number): string => {
  if (typeof value !== 'number' || value <= 0) return '-';
  return `${(value * 100).toFixed(2)}%`;
};

const HistoryTrainingAgentPanel: React.FC = () => {
  const [diagnosis, setDiagnosis] = useState<TrainingHistoryDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAnalyze = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await getTrainingHistoryDiagnosis();
      setDiagnosis(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '历史训练分析失败');
    } finally {
      setLoading(false);
    }
  };

  const severity = diagnosis ? getSeverityTag(diagnosis.severity) : null;
  const trend = diagnosis ? getTrendTag(diagnosis.trend) : null;

  const columns = [
    {
      title: 'Round',
      dataIndex: 'round',
      key: 'round',
      render: (round: string) => <Tag color="blue">{round}</Tag>,
    },
    {
      title: 'Dataset',
      dataIndex: 'dataset',
      key: 'dataset',
      render: (dataset: string) => <Tag color="green">{dataset}</Tag>,
    },
    {
      title: 'Best F1',
      dataIndex: 'best_f1',
      key: 'best_f1',
      render: (value?: number) => (typeof value === 'number' && value > 0 ? value.toFixed(4) : '-'),
    },
    {
      title: 'Accuracy',
      dataIndex: 'test_accuracy',
      key: 'test_accuracy',
      render: formatPercent,
    },
  ];

  return (
    <Card
      className="section-card"
      title={
        <Space>
          <BarChartOutlined />
          <span>历史训练 Agent</span>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void handleAnalyze()}>
          分析历史训练
        </Button>
      }
      style={{ marginBottom: 16 }}
    >
      {!diagnosis ? (
        <Alert
          type="info"
          showIcon
          message="分析历史训练记录"
          description="Agent 会只读分析历史 round 的 best F1、测试准确率、最近趋势和异常记录，用于辅助选择 checkpoint 与下一轮训练方向。"
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Tag color={severity?.color}>{severity?.label}</Tag>
            <Tag color={trend?.color}>{trend?.label}</Tag>
            {diagnosis.bestRound && <Tag color="blue">最佳轮次 {diagnosis.bestRound.round}</Tag>}
          </Space>
          <Text>{diagnosis.summary}</Text>
          {diagnosis.recommendedCheckpointDirection && (
            <Alert
              type={diagnosis.severity === 'warning' ? 'warning' : 'info'}
              showIcon
              message={`推荐方向：${diagnosis.recommendedCheckpointDirection.action}`}
              description={diagnosis.recommendedCheckpointDirection.reason}
            />
          )}
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title="最佳 F1" value={diagnosis.bestRound?.best_f1 ?? 0} precision={4} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="最佳准确率" value={formatPercent(diagnosis.bestRound?.test_accuracy)} />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="趋势窗口" value={diagnosis.trend.window} suffix="轮" />
            </Col>
            <Col xs={12} md={6}>
              <Statistic title="趋势变化" value={diagnosis.trend.delta} precision={4} />
            </Col>
          </Row>
          <List
            size="small"
            header={<Text strong>建议动作</Text>}
            dataSource={diagnosis.recommendations}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
          {diagnosis.anomalies.length > 0 && (
            <List
              size="small"
              header={<Text strong>异常记录</Text>}
              dataSource={diagnosis.anomalies}
              renderItem={(item) => (
                <List.Item>
                  <Text type="danger">{item.round}</Text>
                  <Text>{item.reason}</Text>
                </List.Item>
              )}
            />
          )}
          <Table<HistoryRound>
            size="small"
            columns={columns}
            dataSource={diagnosis.rankedRounds}
            rowKey="round"
            pagination={false}
          />
        </Space>
      )}
    </Card>
  );
};

export default HistoryTrainingAgentPanel;
