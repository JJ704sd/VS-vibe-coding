import React from 'react';
import { useParams } from 'react-router-dom';
import { Card, Row, Col, Descriptions, Tag, Button, Timeline, Space, Typography } from 'antd';
import { PlayCircleOutlined, DownloadOutlined } from '@ant-design/icons';
import ECGCanvas from '../components/Canvas/ECGCanvas';
import { mockRecordsByPatientId } from '../data/mockClinic';

const { Title, Text } = Typography;

const CaseDetail: React.FC = () => {
  const { patientId } = useParams<{ patientId: string }>();
  const selectedRecord = (patientId && mockRecordsByPatientId[patientId]) || null;

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={2} style={{ marginBottom: 18 }}>
        <Title level={3} style={{ margin: 0 }}>
          病例详情
        </Title>
        <Text type="secondary">查看患者信息、心电记录与诊断时间线</Text>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={7} xxl={6}>
          <Card title="患者信息" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="患者 ID">{patientId}</Descriptions.Item>
              <Descriptions.Item label="姓名">张三</Descriptions.Item>
              <Descriptions.Item label="年龄">65 岁</Descriptions.Item>
              <Descriptions.Item label="性别">男</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="心电记录列表" size="small" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Tag color="blue" style={{ padding: '4px 8px' }}>
                2026-03-25 房颤 (92%)
              </Tag>
              <Tag color="green" style={{ padding: '4px 8px' }}>
                2026-03-20 正常
              </Tag>
              <Tag style={{ padding: '4px 8px' }}>2026-03-15 正常</Tag>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={17} xxl={18}>
          <Card
            title={selectedRecord ? `心电图详情 - ${selectedRecord.diagnosis?.label || '未诊断'}` : '请选择记录'}
            extra={
              <Space>
                <Button icon={<PlayCircleOutlined />}>预览</Button>
                <Button icon={<DownloadOutlined />}>导出</Button>
              </Space>
            }
          >
            {selectedRecord ? (
              <>
                <Descriptions column={4} size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="设备">{selectedRecord.deviceId}</Descriptions.Item>
                  <Descriptions.Item label="采样率">{selectedRecord.samplingRate} Hz</Descriptions.Item>
                  <Descriptions.Item label="时长">{selectedRecord.duration}s</Descriptions.Item>
                  <Descriptions.Item label="信号质量">{selectedRecord.signalQuality}%</Descriptions.Item>
                </Descriptions>
                <ECGCanvas leads={selectedRecord.leads} />
              </>
            ) : null}
          </Card>

          <Card title="诊断时间线" style={{ marginTop: 16 }}>
            <Timeline>
              <Timeline.Item color="green">2026-03-25 10:30 - 房颤确诊（AI 辅助诊断）</Timeline.Item>
              <Timeline.Item color="green">2026-03-20 14:20 - 心电图检查正常</Timeline.Item>
              <Timeline.Item>2026-03-15 09:00 - 初诊建档</Timeline.Item>
            </Timeline>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default CaseDetail;

