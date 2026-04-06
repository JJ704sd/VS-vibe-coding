import React, { useEffect, useState } from 'react';
import { Button, Card, Col, Empty, Progress, Row, Space, Spin, Statistic, Tag, Typography } from 'antd';
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
  const quickMetrics = overview?.metrics.slice(0, 3) ?? [];
  const recentActivities = overview?.recentActivities ?? [];
  const diagnosisStats = overview?.diagnosisStats ?? [];

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
        <Row gutter={[24, 24]} align="middle">
          <Col xs={24} lg={15}>
            <div className="page-kicker">
              <HeartOutlined />
              Clinical overview
            </div>
            <Title className="page-title">心电工作台总览</Title>
            <Text className="page-subtitle">
              这是为标注、复核与分析设计的临床工作台。把最重要的信息放在最先看到的位置，让处理路径更短、层级更清楚、操作更稳定。
            </Text>
            <Space wrap style={{ marginTop: 12 }}>
                <Tag color={overview?.sourceLabel?.includes('PTB-XL') ? 'blue' : 'gold'}>
                {overview?.sourceLabel || '加载中'}
              </Tag>
              <Tag color="default">核心流程在线</Tag>
              <Tag color="default">今日待办已同步</Tag>
            </Space>
            <div className="page-actions">
              <Button type="primary">进入标注工作台</Button>
              <Button>查看病例列表</Button>
              <Button icon={<FireOutlined />}>高优先级任务</Button>
            </div>
          </Col>
          <Col xs={24} lg={9}>
            <Card
              className="panel-card"
              title="今日概览"
              extra={<Tag color="blue">{overview ? 'Live' : 'Syncing'}</Tag>}
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {quickMetrics.length > 0 ? (
                  quickMetrics.map((metric) => (
                    <div key={metric.title} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text type="secondary">{metric.title}</Text>
                      <Text strong>{metric.value}</Text>
                    </div>
                  ))
                ) : (
                  <Text type="secondary">正在同步关键指标...</Text>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">工作台状态</Text>
                  <Text strong>{overview ? '就绪' : '同步中'}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>
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
                  {recentActivities.length > 0 ? (
                    recentActivities.map((item) => (
                      <div
                        key={item}
                        className="glass-panel"
                        style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px' }}
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
                    ))
                  ) : (
                    <Empty description="暂无最近活动" />
                  )}
                </Space>
              </Card>
            </Col>

            <Col xs={24} lg={10}>
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Card className="section-card" title="AI 诊断统计" extra={<Text type="secondary">模型输出分布</Text>}>
                  {diagnosisStats.length > 0 ? (
                    <Space direction="vertical" style={{ width: '100%' }} size={12}>
                      {diagnosisStats.map((item) => (
                        <div key={item.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <Text>{item.name}</Text>
                            <Tag color={item.color}>{item.value}%</Tag>
                          </div>
                          <Progress percent={item.value} showInfo={false} strokeColor={item.color} />
                        </div>
                      ))}
                    </Space>
                  ) : (
                    <Empty description="暂无统计数据" />
                  )}
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
          <div className="empty-panel" style={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
            <Space direction="vertical" align="center">
              <Spin size="large" />
              <Text type="secondary">正在同步工作台数据...</Text>
              <Text type="secondary">如果停留过久，请检查 mock API 服务状态。</Text>
            </Space>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
