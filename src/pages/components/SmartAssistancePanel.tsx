import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Divider, Input, List, Space, Tag, Typography, message } from 'antd';
import { ECGLead } from '../../types';
import {
  AssistantAnswer,
  AssistantCaseSnapshot,
  AssistantHealth,
  AssistantSource,
  askECGAssistant,
  checkAssistantHealth,
  rebuildAssistantKnowledge,
  recordAssistantCaseSnapshot,
} from '../../services/ecgAssistantApi';

const { Text } = Typography;

interface SmartAssistancePanelProps {
  modelLoaded: boolean;
  analysisLeadName: string;
  peakThreshold: number;
  leads: ECGLead[];
  caseSnapshot: AssistantCaseSnapshot;
  onLeadNameChange: (name: string) => void;
  onPeakThresholdChange: (value: number) => void;
  onAutoDetectRPeaks: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
}

const QUICK_QUESTIONS = [
  '解释当前标注',
  '这个病例的 AI 结果怎么看？',
  '如何导入 WFDB 文件？',
  '当前信号质量是否可靠？',
];

const getSourceLabel = (source: AssistantSource): string => {
  if (source.type === 'case') return '当前病例';
  if (source.type === 'memory') return '病例记忆';
  return '知识库';
};

const getModeLabel = (mode: AssistantAnswer['mode']): string => {
  if (mode === 'case') return '病例解释';
  if (mode === 'memory') return '病例记忆';
  return '知识检索';
};

const SmartAssistancePanel: React.FC<SmartAssistancePanelProps> = ({
  modelLoaded,
  analysisLeadName,
  peakThreshold,
  leads,
  caseSnapshot,
  onLeadNameChange,
  onPeakThresholdChange,
  onAutoDetectRPeaks,
  onExportJSON,
  onExportCSV,
}) => {
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantAnswer | null>(null);
  const [assistantHealth, setAssistantHealth] = useState<AssistantHealth>({
    available: false,
    message: '正在检查助手服务',
  });
  const [assistantLoading, setAssistantLoading] = useState(false);
  const assistantAvailable = assistantHealth.available;

  useEffect(() => {
    let cancelled = false;

    const refreshHealth = async (): Promise<void> => {
      const result = await checkAssistantHealth();
      if (!cancelled) {
        setAssistantHealth(result);
      }
    };

    void refreshHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRecordCase = async (): Promise<void> => {
    setAssistantLoading(true);
    try {
      await recordAssistantCaseSnapshot(caseSnapshot);
      message.success('已记录当前病例上下文，可用于后续病例问答。');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '记录病例上下文失败');
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleRebuildKnowledge = async (): Promise<void> => {
    setAssistantLoading(true);
    try {
      const result = await rebuildAssistantKnowledge();
      message.success(`知识库已重建：${result.indexedDocuments} 个文档，${result.chunks} 个片段。`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重建知识库失败');
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleAskAssistant = async (overrideQuestion?: string): Promise<void> => {
    const question = (overrideQuestion || assistantQuestion).trim();
    if (!question) {
      message.warning('请输入需要助手回答的问题');
      return;
    }
    setAssistantQuestion(question);
    setAssistantLoading(true);
    try {
      const result = await askECGAssistant(question, caseSnapshot);
      setAssistantAnswer(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '助手查询失败');
    } finally {
      setAssistantLoading(false);
    }
  };

  return (
    <Card
      className="section-card"
      title="智能辅助"
      extra={
        <Space size={6}>
          <Tag color={modelLoaded ? 'green' : 'default'}>{modelLoaded ? 'Model Ready' : 'Model Idle'}</Tag>
          <Tag color={assistantAvailable ? 'green' : 'red'}>{assistantAvailable ? 'Assistant Online' : 'Assistant Offline'}</Tag>
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <select
          value={analysisLeadName}
          onChange={(e) => onLeadNameChange(e.target.value)}
          style={{
            width: '100%',
            height: 40,
            borderRadius: 12,
            border: '1px solid rgba(26, 43, 67, 0.14)',
            padding: '0 12px',
            background: 'rgba(255,255,255,0.9)',
          }}
        >
          {leads.map((lead) => (
            <option key={lead.name} value={lead.name}>
              {lead.name}
            </option>
          ))}
        </select>
        <Input
          size="small"
          type="number"
          min={0.2}
          max={0.95}
          step={0.05}
          value={peakThreshold}
          onChange={(e) => onPeakThresholdChange(Number(e.target.value))}
          placeholder="R 峰阈值 (0.2 - 0.95)"
        />
        <Button onClick={onAutoDetectRPeaks} block>
          自动检测 R 峰
        </Button>
        <Space wrap style={{ width: '100%' }}>
          <Button onClick={onExportJSON}>导出当前记录 JSON</Button>
          <Button onClick={onExportCSV}>导出当前记录 CSV</Button>
        </Space>
        <Divider style={{ margin: '8px 0' }} />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">轻量助手：病例问答、知识库检索、当前标注解释</Text>
          {!assistantAvailable && (
            <Alert
              type="warning"
              showIcon
              message={assistantHealth.message}
              description="请先启动本地 sidecar 服务，再使用病例问答和知识库检索。"
            />
          )}
          <Space wrap>
            {QUICK_QUESTIONS.map((question) => (
              <Button
                key={question}
                size="small"
                disabled={!assistantAvailable}
                loading={assistantLoading && assistantQuestion === question}
                onClick={() => {
                  void handleAskAssistant(question);
                }}
              >
                {question}
              </Button>
            ))}
          </Space>
          <Button disabled={!assistantAvailable} loading={assistantLoading} onClick={handleRecordCase} block>
            记录当前病例
          </Button>
          <Button disabled={!assistantAvailable} loading={assistantLoading} onClick={handleRebuildKnowledge} block>
            重建知识库
          </Button>
          <Input.Search
            value={assistantQuestion}
            onChange={(event) => setAssistantQuestion(event.target.value)}
            onSearch={() => {
              void handleAskAssistant();
            }}
            enterButton="询问助手"
            placeholder="输入问题，例如：如何导入 WFDB 文件？"
            loading={assistantLoading}
            disabled={!assistantAvailable}
          />
          {assistantAnswer && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Tag color="blue">{getModeLabel(assistantAnswer.mode)}</Tag>
              <Text style={{ whiteSpace: 'pre-line' }}>{assistantAnswer.answer}</Text>
              <List
                size="small"
                dataSource={assistantAnswer.sources}
                locale={{ emptyText: '暂无引用来源' }}
                renderItem={(source) => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Text strong>{source.title}</Text>
                      <Text type="secondary">
                        {getSourceLabel(source)} · {source.path}
                      </Text>
                      {source.snippet && <Text type="secondary">{source.snippet}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
            </Space>
          )}
        </Space>
      </Space>
    </Card>
  );
};

export default SmartAssistancePanel;
