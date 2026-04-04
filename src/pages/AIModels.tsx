import React, { useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Switch, Table, Tag, Typography, message, Progress } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';

interface ModelInfo {
  id: string;
  name: string;
  version: string;
  accuracy: number;
  status: 'loaded' | 'loading' | 'unloaded';
  size: string;
}

const { Title, Text } = Typography;

const mockModels: ModelInfo[] = [
  { id: '1', name: 'ECG Classifier', version: '1.0.0', accuracy: 92.5, status: 'loaded', size: '25MB' },
  { id: '2', name: 'Heart Segmentation', version: '2.1.0', accuracy: 88.3, status: 'unloaded', size: '45MB' },
  { id: '3', name: 'Arrhythmia Detector', version: '1.2.0', accuracy: 95.1, status: 'unloaded', size: '18MB' },
];

const modelMetrics = [
  { title: '已加载模型', value: 1, note: '当前在线推理', accent: 'metric-card--blue' },
  { title: '平均准确率', value: 92, note: '来自最近评估', accent: 'metric-card--teal' },
  { title: '模型包数量', value: 3, note: '可切换的模型配置', accent: 'metric-card--amber' },
  { title: '离线就绪', value: 87, note: '本地资源完整性', accent: 'metric-card--rose' },
];

const AIModels: React.FC = () => {
  const [models, setModels] = useState<ModelInfo[]>(mockModels);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(mockModels[0]);

  const handleLoadModel = (model: ModelInfo) => {
    setModels((previous) =>
      previous.map((item) => (item.id === model.id ? { ...item, status: 'loading' } : item))
    );

    setTimeout(() => {
      setModels((previous) =>
        previous.map((item) => (item.id === model.id ? { ...item, status: 'loaded' } : item))
      );
      message.success(`模型 ${model.name} 加载成功`);
    }, 1200);
  };

  const columns = [
    {
      title: '模型名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 110,
    },
    {
      title: '准确率',
      dataIndex: 'accuracy',
      key: 'accuracy',
      width: 180,
      render: (accuracy: number) => <Progress percent={accuracy} size="small" />,
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 90,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: ModelInfo['status']) => (
        <Tag color={status === 'loaded' ? 'green' : status === 'loading' ? 'orange' : 'default'}>
          {status === 'loaded' ? '已加载' : status === 'loading' ? '加载中' : '未加载'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      render: (_: unknown, record: ModelInfo) => (
        <Space>
          {record.status === 'unloaded' ? (
            <Button size="small" onClick={() => handleLoadModel(record)}>
              加载
            </Button>
          ) : null}
          <Button size="small" icon={<DownloadOutlined />}>
            更新
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">Models</div>
        <Title className="page-title">AI 模型管理</Title>
        <Text className="page-subtitle">
          用更明确的层级展示推理模型状态、准确率和基础配置。这里的重点不是堆参数，而是让加载、切换和判断更直观。
        </Text>
        <div className="page-actions">
          <Button type="primary">同步模型库</Button>
          <Button>刷新状态</Button>
        </div>
      </section>

      <Row gutter={[16, 16]} className="stat-grid" style={{ marginTop: 18 }}>
        {modelMetrics.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.title}>
            <Card className={`metric-card ${metric.accent}`}>
              <Statistic title={<span className="metric-label">{metric.title}</span>} value={metric.value} valueStyle={{ display: 'none' }} />
              <div className="metric-value">{metric.value}</div>
              <div className="metric-note">{metric.note}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 18 }}>
        <Col xs={24} lg={16}>
          <Card className="section-card" title="模型列表">
            <Table
              className="table-card"
              columns={columns}
              dataSource={models}
              rowKey="id"
              pagination={false}
              onRow={(record) => ({
                onClick: () => setSelectedModel(record),
                style: { cursor: 'pointer' },
              })}
              scroll={{ x: 780 }}
            />
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="section-card" title="模型详情">
              {selectedModel ? (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div>
                    <Text type="secondary">名称</Text>
                    <div>{selectedModel.name}</div>
                  </div>
                  <div>
                    <Text type="secondary">版本</Text>
                    <div>{selectedModel.version}</div>
                  </div>
                  <div>
                    <Text type="secondary">准确率</Text>
                    <div>{selectedModel.accuracy}%</div>
                  </div>
                  <div>
                    <Text type="secondary">大小</Text>
                    <div>{selectedModel.size}</div>
                  </div>
                  <Tag color={selectedModel.status === 'loaded' ? 'green' : 'orange'}>
                    {selectedModel.status === 'loaded' ? '当前在线' : '等待加载'}
                  </Tag>
                </Space>
              ) : (
                <Text type="secondary">请选择模型查看详情</Text>
              )}
            </Card>

            <Card className="section-card" title="模型设置">
              <Space direction="vertical" style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>自动推理</span>
                  <Switch defaultChecked />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>显示热力图</span>
                  <Switch defaultChecked />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>离线模式</span>
                  <Switch />
                </div>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </div>
  );
};

export default AIModels;
