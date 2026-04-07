import React from 'react';
import { Card, Input, Button, Space, Tag, Upload } from 'antd';
import { CloudUploadOutlined, LinkOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

interface WfdbBatchRecord {
  id: string;
  leads: { name: string; data: number[]; samplingRate: number }[];
  createdAt: number;
}

interface ImportPanelProps {
  githubRawUrl: string;
  onGithubUrlChange: (url: string) => void;
  onGithubUrlImport: () => void;
  importing: boolean;
  wfdbBatches: WfdbBatchRecord[];
  onWfdbBatchUpload: UploadProps['beforeUpload'];
  onWfdbFolderUpload: UploadProps['beforeUpload'];
  onSelectBatch: (batch: WfdbBatchRecord) => void;
  onClearBatches: () => void;
}

const ImportPanel: React.FC<ImportPanelProps> = ({
  githubRawUrl,
  onGithubUrlChange,
  onGithubUrlImport,
  importing,
  wfdbBatches,
  onWfdbBatchUpload,
  onWfdbFolderUpload,
  onSelectBatch,
  onClearBatches,
}) => {
  return (
    <Card className="section-card" title="数据导入" extra={<Tag color="geekblue">Sources</Tag>}>
      <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
        <Input
          placeholder="粘贴 GitHub Raw JSON 链接"
          value={githubRawUrl}
          onChange={(e) => onGithubUrlChange(e.target.value)}
        />
        <Button icon={<LinkOutlined />} onClick={onGithubUrlImport} loading={importing} block>
          从 URL 导入
        </Button>
      </Space>

      <Upload.Dragger
        className="glass-panel"
        accept=".json,.dcm,.hl7,.hea,.dat"
        beforeUpload={onWfdbBatchUpload}
        multiple
        disabled={importing}
        showUploadList={false}
      >
        <p className="ant-upload-drag-icon">
          <CloudUploadOutlined style={{ fontSize: 42, color: '#275ef1' }} />
        </p>
        <p>点击或拖拽文件上传</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          单文件支持 JSON / DICOM / HL7，WFDB 需同时提供 .hea 与 .dat
        </p>
      </Upload.Dragger>

      <div style={{ marginTop: 12 }}>
        <Upload.Dragger
          className="glass-panel"
          accept=".hea,.dat"
          beforeUpload={onWfdbFolderUpload}
          multiple
          directory
          disabled={importing}
          showUploadList={false}
        >
          <p className="ant-upload-drag-icon">
            <CloudUploadOutlined style={{ fontSize: 34, color: '#0f9d9a' }} />
          </p>
          <p>MIT-BIH 一键批量导入（选择文件夹）</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            仅识别三位数字记录名（如 100.hea + 100.dat）
          </p>
        </Upload.Dragger>
      </div>

      {wfdbBatches.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span>已解析 WFDB 记录（可切换加载）</span>
            <Button size="small" onClick={onClearBatches}>
              清空
            </Button>
          </div>
          <Space direction="vertical" style={{ width: '100%' }}>
            {wfdbBatches.map((batch) => (
              <Button
                key={batch.id}
                size="small"
                onClick={() => onSelectBatch(batch)}
                style={{ textAlign: 'left' }}
              >
                {batch.id} · {batch.leads.length} 导联
              </Button>
            ))}
          </Space>
        </div>
      ) : null}
    </Card>
  );
};

export default ImportPanel;
