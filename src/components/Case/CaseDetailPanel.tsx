import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Descriptions, Tag, Button, Timeline, Space, List, Avatar, Typography, Empty } from 'antd';
import { PlayCircleOutlined, DownloadOutlined, EditOutlined, DeleteOutlined, FileTextOutlined, HeartOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { Patient, ECGRecord, TimelineEvent, Annotation } from '../../types';
import { exportRecord } from '../../utils/exportUtils';

const { Text } = Typography;

interface CaseDetailPanelProps {
  patient: Patient | null;
  records: ECGRecord[];
  timeline: TimelineEvent[];
  loading?: boolean;
  onRecordSelect?: (record: ECGRecord) => void;
  onRecordDelete?: (recordId: string) => void;
}

export const CaseDetailPanel: React.FC<CaseDetailPanelProps> = ({
  patient,
  records = [],
  timeline = [],
  onRecordSelect,
  onRecordDelete
}) => {
  const navigate = useNavigate();
  const [selectedRecord, setSelectedRecord] = useState<ECGRecord | null>(null);

  useEffect(() => {
    if (records.length > 0 && !selectedRecord) {
      setSelectedRecord(records[0]);
    }
  }, [records, selectedRecord]);

  const handleRecordClick = (record: ECGRecord) => {
    setSelectedRecord(record);
    onRecordSelect?.(record);
  };

  const handleExport = (record: ECGRecord, format: 'json' | 'csv' | 'tcx') => {
    exportRecord(record, {
      format,
      includeAnnotations: true,
      includeDiagnosis: true,
      includeMetadata: true
    });
  };

  const getDiagnosisColor = (diagnosis?: string) => {
    const colorMap: Record<string, string> = {
      '正常': 'green',
      '房颤': 'red',
      '室上性心动过速': 'orange',
      '室性心动过速': 'red',
      '停搏': 'purple'
    };
    return colorMap[diagnosis || ''] || 'default';
  };

  if (!patient) {
    return <Empty description="请选择患者" />;
  }

  return (
    <div>
      <Card 
        title={
          <Space>
            <Avatar style={{ backgroundColor: '#1890ff' }} icon={<FileTextOutlined />} />
            <span>{patient.name}</span>
            <Tag color="blue">{patient.id}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<EditOutlined />}>编辑</Button>
          </Space>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="年龄">{patient.age} 岁</Descriptions.Item>
          <Descriptions.Item label="性别">{patient.gender === 'M' ? '男' : '女'}</Descriptions.Item>
          <Descriptions.Item label="记录数">
            <Tag color="purple">{records.length} 条</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(patient.createdAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {new Date(patient.updatedAt).toLocaleString('zh-CN')}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card 
            title={
              <Space>
                <HeartOutlined />
                <span>心电记录列表</span>
              </Space>
            }
            extra={<Tag>{records.length} 条</Tag>}
            style={{ maxHeight: 400, overflow: 'auto' }}
          >
            <List
              itemLayout="horizontal"
              dataSource={records}
              renderItem={(record: ECGRecord, index: number) => (
                <List.Item
                  style={{ 
                    cursor: 'pointer',
                    background: selectedRecord?.id === record.id ? '#e6f7ff' : undefined,
                    padding: '8px 12px',
                    marginBottom: 4,
                    borderRadius: 4
                  }}
                  onClick={() => handleRecordClick(record)}
                  actions={[
                    <Button 
                      key="view" 
                      type="link" 
                      size="small"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        navigate(`/annotation/${record.id}`);
                      }}
                    >
                      标注
                    </Button>,
                    <Button 
                      key="export" 
                      type="link" 
                      size="small"
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        handleExport(record, 'json');
                      }}
                    >
                      导出
                    </Button>,
                    <Button 
                      key="delete"
                      type="link" 
                      size="small" 
                      danger
                      icon={<DeleteOutlined />}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onRecordDelete?.(record.id);
                      }}
                    />
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar 
                        style={{ 
                          backgroundColor: record.diagnosis 
                            ? getDiagnosisColor(record.diagnosis.label) 
                            : '#888' 
                        }}
                        icon={<HeartOutlined />}
                      />
                    }
                    title={
                      <Space>
                        <Text strong>#{index + 1}</Text>
                        <Text>{new Date(record.timestamp).toLocaleString('zh-CN')}</Text>
                        {record.diagnosis && (
                          <Tag color={getDiagnosisColor(record.diagnosis.label)}>
                            {record.diagnosis.label} ({Math.round(record.diagnosis.confidence * 100)}%)
                          </Tag>
                        )}
                      </Space>
                    }
                    description={
                      <Space split={<Text type="secondary">|</Text>}>
                        <Text type="secondary">{record.deviceId}</Text>
                        <Text type="secondary">{record.duration}s</Text>
                        <Text type="secondary">{record.samplingRate}Hz</Text>
                        <Text type="secondary">质量: {record.signalQuality}%</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card 
            title={
              <Space>
                <ClockCircleOutlined />
                <span>活动时间线</span>
              </Space>
            }
            style={{ maxHeight: 400, overflow: 'auto' }}
          >
            <Timeline
              items={timeline.map((event: TimelineEvent) => ({
                color: event.type === 'diagnose' ? 'green' : 'blue',
                children: (
                  <div>
                    <Text strong>{event.description}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(event.timestamp).toLocaleString('zh-CN')}
                    </Text>
                  </div>
                )
              })).reverse()}
            />
          </Card>
        </Col>
      </Row>

      {selectedRecord && (
        <Card title="当前记录详情" style={{ marginTop: 16 }}>
          <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
            <Descriptions.Item label="记录ID">{selectedRecord.id}</Descriptions.Item>
            <Descriptions.Item label="设备">{selectedRecord.deviceId}</Descriptions.Item>
            <Descriptions.Item label="采样率">{selectedRecord.samplingRate} Hz</Descriptions.Item>
            <Descriptions.Item label="时长">{selectedRecord.duration}s</Descriptions.Item>
            <Descriptions.Item label="信号质量">
              <Tag color={selectedRecord.signalQuality > 70 ? 'green' : 'orange'}>
                {selectedRecord.signalQuality}%
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="标注数">
              {selectedRecord.annotations.length} 个
            </Descriptions.Item>
            <Descriptions.Item label="诊断">
              {selectedRecord.diagnosis ? (
                <Tag color={getDiagnosisColor(selectedRecord.diagnosis.label)}>
                  {selectedRecord.diagnosis.label} ({Math.round(selectedRecord.diagnosis.confidence * 100)}%)
                </Tag>
              ) : (
                <Text type="secondary">未诊断</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="操作">
              <Space>
                <Button 
                  size="small" 
                  icon={<PlayCircleOutlined />}
                  onClick={() => navigate(`/annotation/${selectedRecord.id}`)}
                >
                  查看波形
                </Button>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(selectedRecord, 'json')}>
                  导出JSON
                </Button>
                <Button size="small" onClick={() => handleExport(selectedRecord, 'csv')}>
                  导出CSV
                </Button>
                <Button size="small" onClick={() => handleExport(selectedRecord, 'tcx')}>
                  导出TCX
                </Button>
              </Space>
            </Descriptions.Item>
          </Descriptions>

          {selectedRecord.annotations.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Text strong>标注列表：</Text>
              <List
                size="small"
                style={{ marginTop: 8 }}
                dataSource={selectedRecord.annotations}
                renderItem={(ann: Annotation) => (
                  <Tag>
                    {ann.type} - 位置: {Math.round(ann.position)} - 
                    置信度: {Math.round(ann.confidence * 100)}% - 
                    {ann.manual ? '人工' : 'AI'}
                  </Tag>
                )}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default CaseDetailPanel;
