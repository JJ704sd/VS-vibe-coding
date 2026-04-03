import React from 'react';
import { Card, Row, Col, Statistic, List, Tag, Typography, Space } from 'antd';
import {
  FileOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { mockDiagnosisStats, mockRecentActivities } from '../data/mockClinic';

const { Title, Text } = Typography;

const Dashboard: React.FC = () => {
  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={2} style={{ marginBottom: 18 }}>
        <Title level={3} style={{ margin: 0 }}>
          仪表盘
        </Title>
        <Text type="secondary">系统运行总览与近期处理情况</Text>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="总病例数" value={156} prefix={<FileOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="总心电图数" value={428} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="已标注" value={312} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="待处理" value={116} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
        <Col xs={24} lg={14}>
            <Card title="最近活动" extra={<Text type="secondary">最近 24 小时</Text>}>
            <List
              dataSource={mockRecentActivities}
              renderItem={(item) => (
                <List.Item>
                  <Space>
                    <RiseOutlined style={{ color: '#276ef1' }} />
                    <Text>{item}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="AI 诊断统计" extra={<Text type="secondary">模型输出分布</Text>}>
            <Space direction="vertical" style={{ width: '100%' }} size={10}>
              {mockDiagnosisStats.map((item) => (
                <div
                  key={item.name}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Text>{item.name}</Text>
                  <Tag color={item.color}>{item.value}%</Tag>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
