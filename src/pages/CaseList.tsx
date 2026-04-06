import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Spin,
} from 'antd';
import { EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { mockPatients } from '../data/mockClinic';
import { Patient } from '../types';
import { createPatient, getPatients, PatientsResponse } from '../services/clinicApi';

const { Search } = Input;
const { Title, Text } = Typography;

type CreatePatientForm = {
  name: string;
  age: number;
  gender: 'M' | 'F';
};

const CaseList: React.FC = () => {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>(mockPatients);
  const [searchText, setSearchText] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('PTB-XL 20 条备份');
  const [form] = Form.useForm<CreatePatientForm>();

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    getPatients()
      .then((response: PatientsResponse) => {
        if (!mounted) {
          return;
        }

        setPatients(response.patients);
        setSourceLabel(response.sourceLabel);
      })
      .catch(() => {
        if (!mounted) {
          return;
        }

        setPatients(mockPatients);
        setSourceLabel('PTB-XL 20 条备份');
        message.error('病例数据加载失败');
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const filteredPatients = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return patients;
    }

    return patients.filter((patient) => {
      const diagnosisText = patient.records
        .map((record) => record.diagnosis?.label || '')
        .join(' ')
        .toLowerCase();

      return (
        patient.name.toLowerCase().includes(keyword) ||
        patient.id.toLowerCase().includes(keyword) ||
        diagnosisText.includes(keyword)
      );
    });
  }, [patients, searchText]);

  const caseMetrics = [
    {
      title: '患者总数',
      value: patients.length,
      note: sourceLabel.includes('PTB-XL') ? '来自 PTB-XL 备份' : '本地兜底数据',
      accent: 'metric-card--blue',
    },
    {
      title: '活跃病例',
      value: patients.filter((patient) =>
        patient.records.some((record) => (record.annotations?.length || 0) > 0)
      ).length,
      note: '过去 48 小时有更新',
      accent: 'metric-card--teal',
    },
    {
      title: '待标注',
      value: patients.reduce(
        (sum, patient) =>
          sum + patient.records.filter((record) => (record.annotations?.length || 0) === 0).length,
        0
      ),
      note: '优先级从高到低排序',
      accent: 'metric-card--amber',
    },
    {
      title: '新建速度',
      value: Math.max(patients.length, 0),
      note: '当前会话新增病例数',
      accent: 'metric-card--rose',
    },
  ];

  const columns: ColumnsType<Patient> = [
    {
      title: '患者 ID',
      dataIndex: 'id',
      key: 'id',
      width: 100,
      render: (id: string) => <Tag color="blue">{id}</Tag>,
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '年龄',
      dataIndex: 'age',
      key: 'age',
      width: 80,
    },
    {
      title: '性别',
      dataIndex: 'gender',
      key: 'gender',
      width: 80,
      render: (gender: Patient['gender']) => (
        <Tag color={gender === 'M' ? 'blue' : 'magenta'}>{gender === 'M' ? '男' : '女'}</Tag>
      ),
    },
    {
      title: '记录数',
      key: 'recordCount',
      width: 100,
      render: (_, record) => <Tag color="purple">{record.records.length}</Tag>,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (date: string) => new Date(date).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => navigate(`/cases/${record.id}`)}
          >
            查看
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => navigate(`/annotation?patientId=${record.id}`)}
          >
            标注
          </Button>
        </Space>
      ),
    },
  ];

  const handleAddPatient = async (values: CreatePatientForm) => {
    try {
      const newPatient = await createPatient(values);
      setPatients((current) => [newPatient, ...current]);
      setIsModalVisible(false);
      form.resetFields();
      message.success('患者已创建');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建患者失败');
    }
  };

  const patientCards = filteredPatients;

  return (
    <div className="page-shell page-shell-wide">
      <section className="page-hero">
        <div className="page-kicker">Registry</div>
        <Title className="page-title">病例管理</Title>
        <Text className="page-subtitle">
          从同一条本地 API 管线查看、搜索和创建患者。把入口收紧后，病例登记与标注跳转会更直观。
        </Text>
        <Space wrap>
          <Tag color={sourceLabel.includes('PTB-XL') ? 'blue' : 'gold'}>{sourceLabel}</Tag>
          <Tag color="default">{patients.length} 条记录已就绪</Tag>
        </Space>
        <div className="page-actions">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
            新建患者
          </Button>
          <Button onClick={() => setSearchText('')}>清空搜索</Button>
        </div>
      </section>

      <div className="section-spacer">
        <Space wrap size={10}>
          <span className="summary-chip">患者 {patients.length}</span>
          <span className="summary-chip">筛选 {filteredPatients.length}</span>
          <span className="summary-chip">待标注 {caseMetrics[2].value}</span>
          <span className="summary-chip">{sourceLabel}</span>
        </Space>
      </div>

      <Row gutter={[16, 16]} className="stat-grid section-spacer">
        {caseMetrics.map((metric) => (
          <Col xs={24} sm={12} xl={6} key={metric.title}>
            <Card className={`metric-card ${metric.accent}`}>
              <Statistic
                title={<span className="metric-label">{metric.title}</span>}
                value={metric.value}
                valueStyle={{ display: 'none' }}
              />
              <div className="metric-value">{metric.value}</div>
              <div className="metric-note">{metric.note}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="section-card section-spacer" title="卡片流" extra={<Tag color="blue">默认视图</Tag>}>
        {patientCards.length > 0 ? (
          <Row gutter={[16, 16]}>
            {patientCards.map((patient) => {
              const diagnosis = patient.records[0]?.diagnosis?.label || '未诊断';
              const quality = patient.records[0]?.signalQuality ?? 0;
              const updatedAt = new Date(patient.updatedAt).toLocaleDateString('zh-CN');

              return (
                <Col xs={24} sm={12} xl={8} key={patient.id}>
                  <Card className="patient-card">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                        <div>
                          <div className="page-kicker">Record {patient.id}</div>
                          <Title level={4} style={{ margin: '4px 0 0' }}>
                            {patient.name}
                          </Title>
                        </div>
                        <Tag color={patient.gender === 'M' ? 'blue' : 'magenta'}>
                          {patient.gender === 'M' ? '男' : '女'}
                        </Tag>
                      </Space>
                      <div className="summary-chip">年龄 {patient.age}</div>
                      <div className="summary-chip">诊断 {diagnosis}</div>
                      <div className="summary-chip">信号质量 {quality}</div>
                      <div className="summary-chip">更新时间 {updatedAt}</div>
                      <div className="patient-card-actions">
                        <Button
                          type="primary"
                          icon={<EyeOutlined />}
                          onClick={() => navigate(`/cases/${patient.id}`)}
                        >
                          查看详情
                        </Button>
                        <Button
                          className="patient-card-secondary"
                          icon={<EditOutlined />}
                          onClick={() => navigate(`/annotation?patientId=${patient.id}`)}
                        >
                          进入标注
                        </Button>
                      </div>
                      <Text type="secondary" className="patient-card-hint">
                        建议先查看病例详情，再进入标注工作流
                      </Text>
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        ) : (
          <div className="empty-panel patient-empty-state">
            <Empty description="没有匹配的病例" image={Empty.PRESENTED_IMAGE_SIMPLE}>
              <Button onClick={() => setSearchText('')}>清空搜索条件</Button>
            </Empty>
          </div>
        )}
      </Card>

      <Card className="section-card section-spacer" title="表格视图" extra={<Tag color="gold">管理入口</Tag>}>
        <div
          style={{
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <div style={{ minWidth: 280, flex: '1 1 320px' }}>
            <Search
              placeholder="搜索患者姓名、ID 或诊断"
              onSearch={(value) => setSearchText(value)}
              onChange={(event) => setSearchText(event.target.value)}
              allowClear
            />
          </div>
          <Space wrap>
            <Text type="secondary">当前筛选结果</Text>
            <Tag color="blue">{filteredPatients.length} 位患者</Tag>
          </Space>
        </div>

        {loading ? (
          <div className="empty-panel" style={{ minHeight: 92, display: 'grid', placeItems: 'center' }}>
            <Space align="center">
              <Spin size="small" />
              <Text type="secondary">正在同步病例数据，已先展示本地备份。</Text>
            </Space>
          </div>
        ) : null}

          {filteredPatients.length > 0 ? (
            <div className="glass-panel" style={{ padding: 16 }}>
              <Table
                className="table-card"
                columns={columns}
                dataSource={filteredPatients}
                rowKey="id"
                pagination={{ pageSize: 10 }}
                scroll={{ x: 860 }}
              />
            </div>
          ) : (
            <div className="empty-panel patient-empty-state">
              <Empty description="表格中没有可显示的病例" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button onClick={() => setSearchText('')}>清空搜索条件</Button>
              </Empty>
            </div>
          )}
        </Card>

      <Modal
        title="新建患者"
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form<CreatePatientForm> form={form} layout="vertical" onFinish={handleAddPatient}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="age" label="年龄" rules={[{ required: true, message: '请输入年龄' }]}>
            <InputNumber min={0} max={150} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
            <Select options={[{ value: 'M', label: '男' }, { value: 'F', label: '女' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CaseList;
