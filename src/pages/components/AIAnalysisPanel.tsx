import React from 'react';
import { Card, Button, Space, Tag, Input } from 'antd';
import { RobotOutlined, ThunderboltOutlined } from '@ant-design/icons';

interface AIAnalysisPanelProps {
  modelLoaded: boolean;
  modelLoading: boolean;
  isAnalyzing: boolean;
  minimaxLoading: boolean;
  minimaxEndpoint: string;
  minimaxApiKey: string;
  minimaxModel: string;
  onLoadModel: () => void;
  onAnalyze: () => void;
  onMinimaxAnalyze: () => void;
  onEndpointChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onModelChange: (value: string) => void;
}

const AIAnalysisPanel: React.FC<AIAnalysisPanelProps> = ({
  modelLoaded,
  modelLoading,
  isAnalyzing,
  minimaxLoading,
  minimaxEndpoint,
  minimaxApiKey,
  minimaxModel,
  onLoadModel,
  onAnalyze,
  onMinimaxAnalyze,
  onEndpointChange,
  onApiKeyChange,
  onModelChange,
}) => {
  return (
    <Card className="section-card" title="AI 辅助" extra={<Tag color="gold">Inference</Tag>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Button
          icon={<RobotOutlined />}
          onClick={onLoadModel}
          loading={modelLoading}
          block
        >
          {modelLoaded ? '模型已加载' : '加载模型'}
        </Button>
        <Button
          icon={<ThunderboltOutlined />}
          onClick={onAnalyze}
          disabled={!modelLoaded}
          loading={isAnalyzing}
          block
        >
          AI 分析
        </Button>
        <Input
          size="small"
          placeholder="Minimax Endpoint (可选)"
          value={minimaxEndpoint}
          onChange={(e) => onEndpointChange(e.target.value)}
        />
        <Input.Password
          size="small"
          placeholder="Minimax API Key (可选)"
          value={minimaxApiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
        <Input
          size="small"
          placeholder="Minimax Model (可选)"
          value={minimaxModel}
          onChange={(e) => onModelChange(e.target.value)}
        />
        <Button
          onClick={onMinimaxAnalyze}
          loading={minimaxLoading}
          disabled={isAnalyzing || modelLoading}
          block
        >
          调用 Minimax API
        </Button>
      </Space>
    </Card>
  );
};

export default AIAnalysisPanel;
