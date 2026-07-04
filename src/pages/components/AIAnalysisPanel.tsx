import React from 'react';
import { Alert, Card, Button, Space, Tag, Input } from 'antd';
import { RobotOutlined, ThunderboltOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

interface AIAnalysisPanelProps {
  modelLoaded: boolean;
  modelLoading: boolean;
  isAnalyzing: boolean;
  minimaxLoading: boolean;
  minimaxEndpoint: string;
  minimaxApiKey: string;
  minimaxModel: string;
  /**
   * True when `ModelService` fell back to the heuristic mock predictor
   * because no real `model.json` was reachable at the configured URL.
   * Drives a permanent banner so reviewers do not mistake mock output
   * for real model predictions.
   */
  isUsingMockInference?: boolean;
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
  isUsingMockInference = false,
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
        {isUsingMockInference ? (
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="真实模型未配置"
            description={
              <span>
                当前仓库未包含 <code>model.json</code>，AI 分析已自动切换到模拟推理模式。
                结果仅用于流程演示，<strong>不可用于临床参考</strong>。
                如需启用真实推理，请把训练好的 TensorFlow.js 模型放到
                <code> public/models/ecg-classifier/ </code>后重新构建。
              </span>
            }
          />
        ) : null}
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
          {isUsingMockInference ? 'AI 分析 (模拟)' : 'AI 分析'}
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
