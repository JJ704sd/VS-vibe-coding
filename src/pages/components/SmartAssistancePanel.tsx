import React from 'react';
import { Card, Space, Tag, Button, Input, Typography } from 'antd';
import { ECGLead, Annotation } from '../../types';

const { Text } = Typography;

interface SmartAssistancePanelProps {
  modelLoaded: boolean;
  analysisLeadName: string;
  peakThreshold: number;
  leads: ECGLead[];
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
  onLeadNameChange,
  onPeakThresholdChange,
  onAutoDetectRPeaks,
  onExportJSON,
  onExportCSV,
}) => {
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
      </Space>
    </Card>
  );
};

export default SmartAssistancePanel;
