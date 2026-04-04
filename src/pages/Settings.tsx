import React from 'react';
import { Button, Card, Col, Divider, Form, Input, InputNumber, Row, Select, Space, Switch, Tag, Typography, message } from 'antd';

const { Title, Text } = Typography;

const Settings: React.FC = () => {
  const [form] = Form.useForm();

  const handleSave = async () => {
    const values = await form.validateFields();
    console.log('[Settings] Saved settings:', values);
    message.success('设置已保存');
  };

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">Preferences</div>
        <Title className="page-title">系统设置</Title>
        <Text className="page-subtitle">
          让显示、采样和推理偏好保持一致。设置页采用更清晰的分组和更轻的视觉重量，便于快速调整而不打断工作流。
        </Text>
        <div className="page-actions">
          <Button type="primary" onClick={handleSave}>保存设置</Button>
          <Button onClick={() => form.resetFields()}>重置为默认值</Button>
        </div>
      </section>

      <Form
        form={form}
        layout="vertical"
        style={{ marginTop: 18 }}
        initialValues={{
          systemName: 'ECG Annotation Platform',
          language: 'zh-CN',
          timezone: 'Asia/Shanghai',
          storage: 'local',
          defaultZoom: 100,
          gridColor: '#1a1a1a',
          waveformColor: 'classic',
          refreshRate: 60,
          inferenceMode: 'auto',
          confidenceThreshold: 0.7,
          offlineMode: true,
        }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card className="section-card" title="基本设置">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="系统名称" name="systemName" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="语言" name="language">
                    <Select
                      options={[
                        { value: 'zh-CN', label: '中文' },
                        { value: 'en-US', label: 'English' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="时区" name="timezone">
                    <Select
                      options={[
                        { value: 'Asia/Shanghai', label: '中国标准时间' },
                        { value: 'UTC', label: 'UTC' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="数据存储" name="storage">
                    <Select
                      options={[
                        { value: 'local', label: '本地存储' },
                        { value: 'firebase', label: 'Firebase 云端' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card className="section-card" title="显示设置">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="默认缩放" name="defaultZoom">
                    <Select
                      options={[
                        { value: 50, label: '50%' },
                        { value: 100, label: '100%' },
                        { value: 150, label: '150%' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="网格颜色" name="gridColor">
                    <Input type="color" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="波形配色" name="waveformColor">
                    <Select
                      options={[
                        { value: 'classic', label: '经典' },
                        { value: 'modern', label: '现代' },
                        { value: 'medical', label: '医疗' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="刷新率" name="refreshRate">
                    <Select
                      options={[
                        { value: 30, label: '30 FPS' },
                        { value: 60, label: '60 FPS' },
                      ]}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card className="section-card" title="AI 推理设置">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label="推理模式" name="inferenceMode">
                    <Select
                      options={[
                        { value: 'auto', label: '自动' },
                        { value: 'manual', label: '手动' },
                      ]}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="置信度阈值" name="confidenceThreshold">
                    <InputNumber min={0} max={1} step={0.1} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item label="离线模式" name="offlineMode" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card className="section-card" title="快捷键与提示">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>Ctrl + 1</Text>
                  <Tag color="blue">标注 P 波</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>Ctrl + 2</Text>
                  <Tag color="blue">标注 R 峰 / QRS</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>Ctrl + 3</Text>
                  <Tag color="blue">标注 T 波</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>Space</Text>
                  <Tag color="geekblue">播放 / 暂停</Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <Text>Esc</Text>
                  <Tag color="default">切换平移模式</Tag>
                </div>
              </Space>
            </Card>
          </Col>
        </Row>

        <Card className="section-card" style={{ marginTop: 16 }}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text strong>保存说明</Text>
            <Text type="secondary">
              这里的设置会影响整个工作台的默认显示与推理流程。修改后建议重新加载标注页面，以确保网格、回放与自动分析状态同步。
            </Text>
          </Space>
        </Card>

        <Divider />

        <Button type="primary" size="large" onClick={handleSave}>
          保存设置
        </Button>
      </Form>
    </div>
  );
};

export default Settings;
