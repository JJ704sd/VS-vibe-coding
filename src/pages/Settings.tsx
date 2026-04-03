import React, { useEffect, useRef } from 'react';
import { Card, Form, Input, Select, Switch, Button, message, Row, Col, Divider, InputNumber } from 'antd';

const Settings: React.FC = () => {
  const [form] = Form.useForm();

  const handleSave = async () => {
    const values = await form.validateFields();
    console.log('[Settings] Saved settings:', values);
    message.success('设置已保存');
  };

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 24 }}>系统设置</h1>

      <Form
        form={form}
        layout="vertical"
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
        <Card title="基本设置">
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

        <Card title="显示设置" style={{ marginTop: 16 }}>
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

        <Card title="AI 推理设置" style={{ marginTop: 16 }}>
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
      </Form>

      <Card title="快捷键" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 14, lineHeight: 1.9 }}>
          <p><code>Ctrl + 1</code> - 标注 P 波</p>
          <p><code>Ctrl + 2</code> - 标注 R 峰 / QRS</p>
          <p><code>Ctrl + 3</code> - 标注 T 波</p>
          <p><code>Space</code> - 播放/暂停</p>
          <p><code>Esc</code> - 切换回平移模式</p>
        </div>
      </Card>

      <Divider />

      <Button type="primary" size="large" onClick={handleSave}>
        保存设置
      </Button>
    </div>
  );
};

export default Settings;
