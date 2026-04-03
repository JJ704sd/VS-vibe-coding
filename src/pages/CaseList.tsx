import React, { useState } from 'react';
import {
  Table,
  Button,
  Input,
  Space,
  Tag,
  Modal,
  Form,
  Select,
  InputNumber,
  message,
  Card,
  Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, EyeOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import { Patient } from '../types';
import { mockPatients } from '../data/mockClinic';

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
  const [form] = Form.useForm<CreatePatientForm>();

  const filteredPatients = patients.filter((patient) => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) {
      return true;
    }

    return (
      patient.name.toLowerCase().includes(keyword) || patient.id.toLowerCase().includes(keyword)
    );
  });

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
        <Tag color={gender === 'M' ? 'blue' : 'pink'}>{gender === 'M' ? '男' : '女'}</Tag>
      ),
    },
    {
      title: '记录数',
      key: 'recordCount',
      width: 100,
      render: (_, record) => record.records.length,
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
          <Button type="link" icon={<EyeOutlined />} onClick={() => navigate(`/cases/${record.id}`)}>
            查看
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => navigate(`/annotation?patientId=${record.id}`)}
          >
            标注
          </Button>
        </Space>
      ),
    },
  ];

  const handleAddPatient = (values: CreatePatientForm) => {
    const newPatient: Patient = {
      id: `P${String(patients.length + 1).padStart(3, '0')}`,
      ...values,
      records: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setPatients((current) => [...current, newPatient]);
    setIsModalVisible(false);
    form.resetFields();
    message.success('患者已创建');
  };

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size={2} style={{ marginBottom: 18 }}>
        <Title level={3} style={{ margin: 0 }}>
          病例管理
        </Title>
        <Text type="secondary">查询、创建并进入患者的标注流程</Text>
      </Space>

      <Card>
        <div
          style={{
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <Search
            placeholder="搜索患者姓名或 ID"
            onSearch={(value) => setSearchText(value)}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ width: 320, maxWidth: '100%' }}
            allowClear
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
            新建患者
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={filteredPatients}
          rowKey="id"
          pagination={{ pageSize: 10 }}
          scroll={{ x: 860 }}
        />
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
