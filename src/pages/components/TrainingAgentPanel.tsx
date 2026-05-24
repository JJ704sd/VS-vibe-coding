import React, { useState } from 'react';
import { Alert, Button, Card, List, Space, Tag, Typography, message } from 'antd';
import { BulbOutlined, ReloadOutlined } from '@ant-design/icons';
import { TrainingDiagnosis, getTrainingDiagnosis } from '../../services/trainingApi';

const { Text } = Typography;

const getSeverityTag = (severity: TrainingDiagnosis['severity']): { color: string; label: string } => {
  if (severity === 'critical') return { color: 'red', label: '需要处理' };
  if (severity === 'warning') return { color: 'orange', label: '存在风险' };
  return { color: 'green', label: '状态正常' };
};

const TrainingAgentPanel: React.FC = () => {
  const [diagnosis, setDiagnosis] = useState<TrainingDiagnosis | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDiagnose = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await getTrainingDiagnosis();
      setDiagnosis(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '训练诊断生成失败');
    } finally {
      setLoading(false);
    }
  };

  const severity = diagnosis ? getSeverityTag(diagnosis.severity) : null;

  return (
    <Card
      className="section-card"
      title={
        <Space>
          <BulbOutlined />
          <span>训练诊断 Agent</span>
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void handleDiagnose()}>
          生成诊断
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {!diagnosis ? (
          <Alert
            type="info"
            showIcon
            message="生成只读训练诊断"
            description="Agent 会读取当前训练状态、参数统计和历史轮次，给出健康判断与下一步建议，不会提交或停止训练任务。"
          />
        ) : (
          <>
            <Space wrap>
              <Tag color={severity?.color}>{severity?.label}</Tag>
              <Tag>{diagnosis.status}</Tag>
              {diagnosis.recommendedRound && <Tag color="blue">推荐轮次 {diagnosis.recommendedRound.round}</Tag>}
            </Space>
            <Text>{diagnosis.summary}</Text>
            {diagnosis.decision && (
              <Alert
                type={diagnosis.severity === 'critical' ? 'error' : diagnosis.severity === 'warning' ? 'warning' : 'info'}
                showIcon
                message={`决策摘要：${diagnosis.decision.nextAction} / ${diagnosis.decision.confidence}`}
                description={diagnosis.decision.reason}
              />
            )}
            {diagnosis.warnings && diagnosis.warnings.length > 0 && (
              <List
                size="small"
                header={<Text strong>风险提示</Text>}
                dataSource={diagnosis.warnings}
                renderItem={(item) => <List.Item>{item.message}</List.Item>}
              />
            )}
            <List
              size="small"
              header={<Text strong>建议动作</Text>}
              dataSource={diagnosis.recommendations}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
            <List
              size="small"
              header={<Text strong>诊断依据</Text>}
              dataSource={diagnosis.evidence}
              locale={{ emptyText: '暂无诊断依据' }}
              renderItem={(item) => (
                <List.Item>
                  <Text type="secondary">{item.label}</Text>
                  <Text>{item.value}</Text>
                </List.Item>
              )}
            />
          </>
        )}
      </Space>
    </Card>
  );
};

export default TrainingAgentPanel;
