import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card, Col, Descriptions, Empty, List, Row, Space, Spin, Tag, Timeline, Typography } from 'antd';
import { DownloadOutlined, PlayCircleOutlined } from '@ant-design/icons';
import ECGCanvas from '../components/Canvas/ECGCanvas';
import { ECGRecord } from '../types';
import { getPatientBundle, PatientBundle } from '../services/clinicApi';

const { Title, Text } = Typography;

const CaseDetail: React.FC = () => {
  const { patientId } = useParams<{ patientId: string }>();
  const [bundle, setBundle] = useState<PatientBundle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    if (!patientId) {
      setBundle({ sourceLabel: '本地 mock 数据', patient: null, record: null });
      setLoading(false);
      return;
    }

    setLoading(true);
    getPatientBundle(patientId)
      .then((nextBundle) => {
        if (mounted) {
          setBundle(nextBundle);
        }
      })
      .catch(() => {
        if (mounted) {
          setBundle({ sourceLabel: '本地 mock 数据', patient: null, record: null });
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [patientId]);

  const patient = bundle?.patient || null;
  const selectedRecord = bundle?.record || patient?.records?.[0] || null;

  const recordList = useMemo(
    () =>
      (patient?.records || []).map((record: ECGRecord) => ({
        label: new Date(record.timestamp).toLocaleDateString('zh-CN'),
        status: record.diagnosis?.label || '未诊断',
        color: record.diagnosis?.label === '正常' ? 'green' : 'red',
        record,
      })),
    [patient]
  );

  const sourceLabel = bundle?.sourceLabel || '加载中';

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">Patient detail</div>
        <Title className="page-title">病例详情</Title>
        <Text className="page-subtitle">
          在一个页面里查看患者信息、记录列表、波形和诊断时间线。布局更收敛后，重点会落在当前记录本身。
        </Text>
        <Space wrap>
          <Tag color={sourceLabel === '本地 mock API' ? 'blue' : 'gold'}>{sourceLabel}</Tag>
          {patient ? <Tag color="blue">{patient.id}</Tag> : null}
        </Space>
        <div className="page-actions">
          <Button type="primary" icon={<PlayCircleOutlined />}>
            预览波形
          </Button>
          <Button icon={<DownloadOutlined />}>导出记录</Button>
        </div>
      </section>

      <div className="section-spacer">
        <Space wrap size={10}>
          <span className="summary-chip">记录 {recordList.length}</span>
          <span className="summary-chip">当前 {selectedRecord ? selectedRecord.diagnosis?.label || '未诊断' : '无记录'}</span>
          <span className="summary-chip">来源 {sourceLabel}</span>
        </Space>
      </div>

      {loading ? (
        <Card className="section-card" style={{ marginTop: 18 }}>
          <div className="empty-panel" style={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
            <Space direction="vertical" align="center">
              <Spin size="large" />
              <Text type="secondary">正在加载病例详情...</Text>
            </Space>
          </div>
        </Card>
      ) : (
        <Row gutter={[16, 16]} className="section-spacer">
          <Col xs={24} xl={8}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card className="section-card" title="患者信息" extra={<Tag color="blue">Profile</Tag>}>
                {patient ? (
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="患者 ID">{patient.id}</Descriptions.Item>
                    <Descriptions.Item label="姓名">{patient.name}</Descriptions.Item>
                    <Descriptions.Item label="年龄">{patient.age} 岁</Descriptions.Item>
                    <Descriptions.Item label="性别">{patient.gender === 'M' ? '男' : '女'}</Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Empty description="未找到患者" />
                )}
              </Card>

              <Card className="section-card" title="心电记录列表" extra={<Tag color="geekblue">Records</Tag>}>
                {recordList.length > 0 ? (
                  <List
                    dataSource={recordList}
                    renderItem={(item) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                          <Space>
                            <Tag color={item.color}>{item.label}</Tag>
                            <Text strong>{item.status}</Text>
                          </Space>
                          <Text type="secondary">设备：{item.record.deviceId}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty description="没有记录" />
                )}
              </Card>
            </Space>
          </Col>

          <Col xs={24} xl={16}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card
                className="workspace-card"
                title={selectedRecord ? `心电图详情 - ${selectedRecord.diagnosis?.label || '未诊断'}` : '请选择记录'}
                extra={<Tag color={selectedRecord ? 'blue' : 'default'}>{selectedRecord ? 'Active' : 'Idle'}</Tag>}
              >
                {selectedRecord ? (
                  <>
                    <Space wrap size={8} style={{ marginBottom: 14 }}>
                      <span className="summary-chip">设备 {selectedRecord.deviceId}</span>
                      <span className="summary-chip">采样率 {selectedRecord.samplingRate} Hz</span>
                      <span className="summary-chip">时长 {selectedRecord.duration}s</span>
                      <span className="summary-chip">质量 {selectedRecord.signalQuality}%</span>
                    </Space>
                    <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small" style={{ marginBottom: 16 }}>
                      <Descriptions.Item label="设备">{selectedRecord.deviceId}</Descriptions.Item>
                      <Descriptions.Item label="采样率">{selectedRecord.samplingRate} Hz</Descriptions.Item>
                      <Descriptions.Item label="时长">{selectedRecord.duration}s</Descriptions.Item>
                      <Descriptions.Item label="信号质量">{selectedRecord.signalQuality}%</Descriptions.Item>
                    </Descriptions>
                    <ECGCanvas leads={selectedRecord.leads} />
                  </>
                ) : (
                  <Empty description="该患者暂无可用记录" />
                )}
              </Card>

              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card className="section-card" title="诊断时间线" extra={<Tag color="cyan">Timeline</Tag>}>
                    {selectedRecord ? (
                      <Timeline
                        items={[
                          {
                            color: 'green',
                            children: `${new Date(selectedRecord.timestamp).toLocaleString('zh-CN')} - ${selectedRecord.diagnosis?.label || '未诊断'}`,
                          },
                          { color: 'blue', children: '记录已同步到本地 mock API' },
                        ]}
                      />
                    ) : (
                      <Empty description="暂无时间线" />
                    )}
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card className="section-card" title="当前状态" extra={<Tag color="green">Status</Tag>}>
                    {selectedRecord ? (
                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary">最后更新</Text>
                          <Text strong>{new Date(selectedRecord.timestamp).toLocaleString('zh-CN')}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary">异常类型</Text>
                          <Text strong>{selectedRecord.diagnosis?.label || '未诊断'}</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <Text type="secondary">复核状态</Text>
                          <Text strong>待人工确认</Text>
                        </div>
                        <Tag color={selectedRecord.diagnosis?.label === '正常' ? 'green' : 'red'}>
                          {selectedRecord.diagnosis?.label === '正常' ? '建议常规随访' : '建议优先处理'}
                        </Tag>
                      </Space>
                    ) : (
                      <Empty description="暂无状态数据" />
                    )}
                  </Card>
                </Col>
              </Row>
            </Space>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default CaseDetail;
