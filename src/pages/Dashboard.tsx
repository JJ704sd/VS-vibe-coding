import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Progress, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileOutlined,
  FireOutlined,
  HeartOutlined,
  RiseOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { DashboardOverview, getDashboardOverview } from '../services/clinicApi';

const { Title, Text } = Typography;

const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);

  useEffect(() => {
    let mounted = true;

    getDashboardOverview()
      .then((data) => {
        if (mounted) {
          setOverview(data);
        }
      })
      .catch(() => {
        if (mounted) {
          setOverview(null);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">
          <HeartOutlined />
          Clinical overview
        </div>
        <Title className="page-title">心电工作台总览</Title>
        <Text className="page-subtitle">
          这是为标注、复核与分析设计的临床工作台。把最重要的信息放在最先看到的位置，让处理路径更短、层级更清楚、操作更稳定。
        </Text>
        <Tag color={overview?.sourceLabel === '本地 mock API' ? 'blue' : 'gold'}>
          {overview?.sourceLabel || '加载中'}
        </Tag>
        <div className="page-actions">
          <Button type="primary">进入标注工作台</Button>
          <Button>查看病例列表</Button>
          <Button icon={<FireOutlined />}>高优先级任务</Button>
        </div>
      </section>

      {overview ? (
        <>
          <Row gutter={[16, 16]} className="stat-grid" style={{ marginTop: 18 }}>
            {overview.metrics.map((metric) => (
              <Col xs={24} sm={12} xl={6} key={metric.title}>
                <Card className={`metric-card ${metric.accent}`}>
                  <Statistic
                    title={<span className="metric-label">{metric.title}</span>}
                    value={metric.value}
                    prefix={
                      metric.title === '总病例数' ? (
                        <FileOutlined />
                      ) : metric.title === '总心电图数' ? (
                        <TeamOutlined />
                      ) : metric.title === '已标注' ? (
                        <CheckCircleOutlined />
                      ) : (
                        <ClockCircleOutlined />
                      )
                    }
                    valueStyle={{ display: 'none' }}
                  />
                  <div className="metric-value">{metric.value}</div>
                  <div className="metric-note">{metric.note}</div>
                </Card>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 18 }}>
            <Col xs={24} lg={14}>
              <Card className="section-card" title="最近活动" extra={<Text type="secondary">最近 24 小时</Text>}>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  {overview.recentActivities.map((item, index) => (
                    <div
                      key={item}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        padding: '12px 14px',
                        borderRadius: 16,
                        background: index % 2 === 0 ? 'rgba(39, 94, 241, 0.03)' : 'rgba(15, 157, 154, 0.03)',
                      }}
                    >
                      <RiseOutlined style={{ color: '#275ef1', marginTop: 4 }} />
                      <div style={{ flex: 1 }}>
                        <Text strong>{item}</Text>
                        <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                          已同步到临床工作流
                        </div>
                      </div>
                      <Tag color="blue">Now</Tag>
                    </div>
                  ))}
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card className="section-card" title="AI 诊断统计" extra={<Text type="secondary">模型输出分布</Text>}>
                  <Space direction="vertical" style={{ width: '100%' }} size={12}>
                    {overview.diagnosisStats.map((item) => (
                      <div key={item.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <Text>{item.name}</Text>
                          <Tag color={item.color}>{item.value}%</Tag>
                        </div>
                        <Progress percent={item.value} showInfo={false} strokeColor={item.color} />
                      </div>
                    ))}
                  </Space>
                </Card>

                <Card className="section-card" title="今日节奏">
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary">平均处理时长</Text>
                      <Text strong>8.2 分钟</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary">模型在线率</Text>
                      <Text strong>99.4%</Text>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary">人工复核比例</Text>
                      <Text strong>27%</Text>
                    </div>
                    <Progress percent={84} strokeColor={{ from: '#275ef1', to: '#0f9d9a' }} />
                    <Text type="secondary">当前排队压力可控，优先处理高置信度异常项。</Text>
                  </Space>
                </Card>
              </Space>
            </Col>
          </Row>
        </>
      ) : (
        <Card className="section-card" style={{ marginTop: 18 }}>
          <div style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
            <Spin size="large" />
          </div>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
