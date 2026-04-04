import React, { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Card, Descriptions, Empty, List, Space, Tag, Timeline, Typography } from 'antd';
import { ClockCircleOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, HeartOutlined, PlayCircleOutlined } from '@ant-design/icons';
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

const diagnosisPalette: Record<string, string> = {
  正常: 'green',
  房颤: 'red',
  室上性心动过速: 'orange',
  室性心动过速: 'red',
  停搏: 'purple',
};

export const CaseDetailPanel: React.FC<CaseDetailPanelProps> = ({
  patient,
  records = [],
  timeline = [],
  onRecordSelect,
  onRecordDelete,
}) => {
  const navigate = useNavigate();
  const [selectedRecord, setSelectedRecord] = useState<ECGRecord | null>(null);

  useEffect(() => {
    if (records.length > 0 && !selectedRecord) {
      setSelectedRecord(records[0]);
    }
  }, [records, selectedRecord]);

  const recordItems = useMemo(
    () =>
      records.map((record, index) => ({
        record,
        index,
        diagnosisColor: record.diagnosis
          ? diagnosisPalette[record.diagnosis.label] || 'default'
          : 'default',
      })),
    [records]
  );

  const handleRecordClick = (record: ECGRecord) => {
    setSelectedRecord(record);
    onRecordSelect?.(record);
  };

  const handleExport = (record: ECGRecord, format: 'json' | 'csv' | 'tcx') => {
    exportRecord(record, {
      format,
      includeAnnotations: true,
      includeDiagnosis: true,
      includeMetadata: true,
    });
  };

  if (!patient) {
    return <Empty className="empty-panel" description="请选择一位患者后查看详情" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card className="section-card" title={patient.name} extra={<Tag color="blue">{patient.id}</Tag>}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="年龄">{patient.age} 岁</Descriptions.Item>
          <Descriptions.Item label="性别">{patient.gender === 'M' ? '男' : '女'}</Descriptions.Item>
          <Descriptions.Item label="记录数">{records.length} 条</Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(patient.createdAt).toLocaleString('zh-CN')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{new Date(patient.updatedAt).toLocaleString('zh-CN')}</Descriptions.Item>
        </Descriptions>
      </Card>

      <div className="workspace-grid workspace-grid--split">
        <Card
          className="section-card"
          title={
            <Space>
              <HeartOutlined />
              <span>心电记录列表</span>
            </Space>
          }
          extra={<Tag>{records.length} 条</Tag>}
        >
          {recordItems.length > 0 ? (
            <List
              itemLayout="horizontal"
              dataSource={recordItems}
              renderItem={({ record, index, diagnosisColor }) => (
                <List.Item
                  onClick={() => handleRecordClick(record)}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    borderRadius: 16,
                    marginBottom: 10,
                    border: selectedRecord?.id === record.id ? '1px solid rgba(39, 94, 241, 0.22)' : '1px solid transparent',
                    background:
                      selectedRecord?.id === record.id
                        ? 'rgba(39, 94, 241, 0.05)'
                        : 'rgba(255, 255, 255, 0.6)',
                  }}
                  actions={[
                    <Button key="view" type="link" size="small" onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/annotation/${record.id}`);
                    }}>
                      标注
                    </Button>,
                    <Button key="export" type="link" size="small" onClick={(e) => {
                      e.stopPropagation();
                      handleExport(record, 'json');
                    }}>
                      导出
                    </Button>,
                    <Button key="delete" type="link" size="small" danger icon={<DeleteOutlined />} onClick={(e) => {
                      e.stopPropagation();
                      onRecordDelete?.(record.id);
                    }} />,
                  ]}
                >
                  <List.Item.Meta
                    avatar={
                      <Avatar
                        style={{ backgroundColor: diagnosisColor === 'default' ? '#73849c' : undefined }}
                        icon={<HeartOutlined />}
                      />
                    }
                    title={
                      <Space wrap>
                        <Text strong>#{index + 1}</Text>
                        <Text>{new Date(record.timestamp).toLocaleString('zh-CN')}</Text>
                        {record.diagnosis ? (
                          <Tag color={diagnosisColor}>
                            {record.diagnosis.label} ({Math.round(record.diagnosis.confidence * 100)}%)
                          </Tag>
                        ) : (
                          <Tag>暂无诊断</Tag>
                        )}
                      </Space>
                    }
                    description={
                      <Space split={<Text type="secondary">|</Text>} wrap>
                        <Text type="secondary">{record.deviceId}</Text>
                        <Text type="secondary">{record.duration}s</Text>
                        <Text type="secondary">{record.samplingRate}Hz</Text>
                        <Text type="secondary">质量 {record.signalQuality}%</Text>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          ) : (
            <Empty description="暂无记录" />
          )}
        </Card>

        <Card
          className="section-card"
          title={
            <Space>
              <ClockCircleOutlined />
              <span>活动时间线</span>
            </Space>
          }
        >
          {timeline.length > 0 ? (
            <Timeline
              items={timeline
                .slice()
                .reverse()
                .map((event: TimelineEvent) => ({
                  color: event.type === 'diagnose' ? 'green' : 'blue',
                  children: (
                    <div>
                      <Text strong>{event.description}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {new Date(event.timestamp).toLocaleString('zh-CN')}
                      </Text>
                    </div>
                  ),
                }))}
            />
          ) : (
            <Empty description="暂无时间线" />
          )}
        </Card>
      </div>

      {selectedRecord ? (
        <Card
          className="workspace-card"
          title="当前记录详情"
          extra={
            <Space wrap>
              <Button size="small" icon={<PlayCircleOutlined />} onClick={() => navigate(`/annotation/${selectedRecord.id}`)}>
                查看波形
              </Button>
              <Button size="small" icon={<DownloadOutlined />} onClick={() => handleExport(selectedRecord, 'json')}>
                导出 JSON
              </Button>
              <Button size="small" onClick={() => handleExport(selectedRecord, 'csv')}>
                导出 CSV
              </Button>
              <Button size="small" onClick={() => handleExport(selectedRecord, 'tcx')}>
                导出 TCX
              </Button>
            </Space>
          }
        >
          <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
            <Descriptions.Item label="记录ID">{selectedRecord.id}</Descriptions.Item>
            <Descriptions.Item label="设备">{selectedRecord.deviceId}</Descriptions.Item>
            <Descriptions.Item label="采样率">{selectedRecord.samplingRate} Hz</Descriptions.Item>
            <Descriptions.Item label="时长">{selectedRecord.duration}s</Descriptions.Item>
            <Descriptions.Item label="信号质量">
              <Tag color={selectedRecord.signalQuality > 70 ? 'green' : 'orange'}>{selectedRecord.signalQuality}%</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="标注数">{selectedRecord.annotations.length} 条</Descriptions.Item>
            <Descriptions.Item label="诊断">
              {selectedRecord.diagnosis ? (
                <Tag color={diagnosisPalette[selectedRecord.diagnosis.label] || 'blue'}>
                  {selectedRecord.diagnosis.label} ({Math.round(selectedRecord.diagnosis.confidence * 100)}%)
                </Tag>
              ) : (
                <Text type="secondary">未诊断</Text>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="操作">
              <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/annotation/${selectedRecord.id}`)}>
                打开标注
              </Button>
            </Descriptions.Item>
          </Descriptions>

          {selectedRecord.annotations.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <Text strong>标注列表</Text>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {selectedRecord.annotations.map((ann: Annotation) => (
                  <Tag key={ann.id} color={ann.manual ? 'blue' : 'geekblue'}>
                    {ann.type} · {Math.round(ann.position)} · {Math.round(ann.confidence * 100)}%
                  </Tag>
                ))}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </Space>
  );
};

export default CaseDetailPanel;
