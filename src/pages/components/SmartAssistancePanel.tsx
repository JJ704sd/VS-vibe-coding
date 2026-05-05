import React, { useState } from 'react';
import { Card, Space, Tag, Button, Input, Typography, Divider, List, message } from 'antd';
import { ECGLead, Annotation } from '../../types';
import {
  AssistantAnswer,
  AssistantCaseSnapshot,
  askECGAssistant,
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
  const [assistantLoading, setAssistantLoading] = useState(false);

  const handleRecordCase = async (): Promise<void> => {
    setAssistantLoading(true);
    try {
      await recordAssistantCaseSnapshot(caseSnapshot);
      message.success('已记录当前病例上下文，供后续辅助检索参考');
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
      message.success(`知识库已重建：${result.indexedDocuments} 个文档，${result.chunks} 个片段`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重建知识库失败');
    } finally {
      setAssistantLoading(false);
    }
  };

  const handleAskAssistant = async (): Promise<void> => {
    const question = assistantQuestion.trim();
    if (!question) {
      message.warning('请输入需要辅助检索的问题');
      return;
    }
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
      extra={<Tag color={modelLoaded ? 'green' : 'default'}>{modelLoaded ? 'Ready' : 'Idle'}</Tag>}
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
          <Button onClick={onExportJSON} block>
            导出当前记录 JSON
          </Button>
          <Button onClick={onExportCSV} block>
            导出当前记录 CSV
          </Button>
        </Space>
        <Divider style={{ margin: '8px 0' }} />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">上下文检索辅助</Text>
          <Button loading={assistantLoading} onClick={handleRecordCase} block>
            记录当前病例
          </Button>
          <Button loading={assistantLoading} onClick={handleRebuildKnowledge} block>
            重建知识库
          </Button>
          <Input.Search
            value={assistantQuestion}
            onChange={(event) => setAssistantQuestion(event.target.value)}
            onSearch={handleAskAssistant}
            enterButton="询问助手"
            placeholder="输入参考问题，如 WFDB 文件如何导入？"
            loading={assistantLoading}
          />
          {assistantAnswer && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text>{assistantAnswer.answer}</Text>
              <List
                size="small"
                dataSource={assistantAnswer.sources}
                locale={{ emptyText: '暂无引用来源' }}
                renderItem={(source) => (
                  <List.Item>
                    <Space direction="vertical" size={2}>
                      <Text strong>{source.title}</Text>
                      <Text type="secondary">{source.type === 'memory' ? '病例记忆' : '知识引用'} · {source.path}</Text>
                      <Text type="secondary">{source.snippet}</Text>
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
