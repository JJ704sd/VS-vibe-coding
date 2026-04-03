import React, { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Table,
  Tag,
  Button,
  Progress,
  Switch,
  Space,
  message,
  Typography,
} from 'antd';
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
  {
    id: '2',
    name: 'Heart Segmentation',
    version: '2.1.0',
    accuracy: 88.3,
    status: 'unloaded',
    size: '45MB',
  },
  {
    id: '3',
    name: 'Arrhythmia Detector',
    version: '1.2.0',
    accuracy: 95.1,
    status: 'unloaded',
    size: '18MB',
  },
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
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={2} style={{ marginBottom: 18 }}>
        <Title level={3} style={{ margin: 0 }}>
          AI 模型管理
        </Title>
        <Text type="secondary">管理推理模型、查看状态与基础配置</Text>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card title="模型列表">
            <Table
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
          <Card title="模型详情">
            {selectedModel ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
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
              </Space>
            ) : (
              <Text type="secondary">请选择模型查看详情</Text>
            )}
          </Card>

          <Card title="模型设置" style={{ marginTop: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>自动推理</span>
                <Switch defaultChecked />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>显示热力图</span>
                <Switch defaultChecked />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>离线模式</span>
                <Switch />
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default AIModels;
