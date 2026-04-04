import React, { useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { FilterValue, SorterResult, TablePaginationConfig } from 'antd/es/table/interface';
import { Patient } from '../../types';

interface CaseListTableProps {
  patients: Patient[];
  loading?: boolean;
  onRefresh?: () => void;
  onPatientClick?: (patient: Patient) => void;
  onPatientEdit?: (patient: Patient) => void;
  onPatientDelete?: (patientId: string) => void;
  onAddPatient?: (patient: Omit<Patient, 'id' | 'records' | 'createdAt' | 'updatedAt'>) => void;
}

interface TableParams {
  pagination: TablePaginationConfig;
  sortField?: string;
  sortOrder?: string;
  filters: Record<string, FilterValue | null>;
}

type CreatePatientForm = {
  name: string;
  age: number;
  gender: 'M' | 'F';
};

export const CaseListTable: React.FC<CaseListTableProps> = ({
  patients,
  loading = false,
  onRefresh,
  onPatientClick,
  onPatientEdit,
  onPatientDelete,
  onAddPatient,
}) => {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [form] = Form.useForm<CreatePatientForm>();
  const [tableParams, setTableParams] = useState<TableParams>({
    pagination: {
      current: 1,
      pageSize: 10,
      total: patients.length,
    },
    filters: {},
  });

  const filteredPatients = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return patients;

    return patients.filter((patient) => {
      const diagnosisText = patient.records
        .map((record) => record.diagnosis?.label ?? '')
        .join(' ')
        .toLowerCase();

      return (
        patient.name.toLowerCase().includes(keyword) ||
        patient.id.toLowerCase().includes(keyword) ||
        diagnosisText.includes(keyword)
      );
    });
  }, [patients, searchText]);

  const columns: ColumnsType<Patient> = useMemo(
    () => [
      {
        title: '患者 ID',
        dataIndex: 'id',
        key: 'id',
        width: 120,
        sorter: (a, b) => a.id.localeCompare(b.id),
        render: (id: string) => <Tag color="blue">{id}</Tag>,
      },
      {
        title: '姓名',
        dataIndex: 'name',
        key: 'name',
        width: 140,
        sorter: (a, b) => a.name.localeCompare(b.name),
        render: (name: string, record: Patient) => (
          <button
            type="button"
            onClick={() => onPatientClick?.(record)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--brand-strong)',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {name}
          </button>
        ),
      },
      {
        title: '年龄',
        dataIndex: 'age',
        key: 'age',
        width: 80,
        sorter: (a, b) => a.age - b.age,
      },
      {
        title: '性别',
        dataIndex: 'gender',
        key: 'gender',
        width: 90,
        filters: [
          { text: '男', value: 'M' },
          { text: '女', value: 'F' },
        ],
        onFilter: (value, record) => record.gender === value,
        render: (gender: Patient['gender']) => (
          <Tag color={gender === 'M' ? 'blue' : 'magenta'}>{gender === 'M' ? '男' : '女'}</Tag>
        ),
      },
      {
        title: '记录数',
        key: 'recordCount',
        width: 100,
        sorter: (a, b) => a.records.length - b.records.length,
        render: (_, record) => <Tag color="purple">{record.records.length}</Tag>,
      },
      {
        title: '最新诊断',
        key: 'latestDiagnosis',
        width: 180,
        render: (_, record) => {
          const latestRecord = record.records[0];
          if (!latestRecord?.diagnosis) return <Tag>暂无诊断</Tag>;

          const { label, confidence } = latestRecord.diagnosis;
          const color = confidence > 0.8 ? 'red' : confidence > 0.5 ? 'orange' : 'green';
          return <Tag color={color}>{label} ({Math.round(confidence * 100)}%)</Tag>;
        },
      },
      {
        title: '更新时间',
        dataIndex: 'updatedAt',
        key: 'updatedAt',
        width: 180,
        sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
        render: (date: string) => new Date(date).toLocaleString('zh-CN'),
      },
      {
        title: '操作',
        key: 'action',
        width: 220,
        fixed: 'right',
        render: (_, record) => (
          <Space size="small">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/cases/${record.id}`)}>
              查看
            </Button>
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => onPatientEdit?.(record)}>
              编辑
            </Button>
            <Popconfirm
              title="确定删除该患者吗？"
              okText="确定"
              cancelText="取消"
              onConfirm={() => onPatientDelete?.(record.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [navigate, onPatientClick, onPatientDelete, onPatientEdit]
  );

  const handleTableChange = (
    pagination: TablePaginationConfig,
    filters: Record<string, FilterValue | null>,
    sorter: SorterResult<Patient> | SorterResult<Patient>[]
  ) => {
    setTableParams({
      pagination,
      filters,
      sortField: Array.isArray(sorter) ? undefined : (sorter.field as string | undefined),
      sortOrder: Array.isArray(sorter) ? undefined : sorter.order ?? undefined,
    });
  };

  const handleAddPatient = (values: CreatePatientForm) => {
    onAddPatient?.({
      name: values.name,
      age: values.age,
      gender: values.gender,
    });
    setIsModalVisible(false);
    form.resetFields();
    message.success('患者已创建');
  };

  return (
    <div className="section-card" style={{ padding: 16 }}>
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
        <Space wrap>
          <Input
            placeholder="搜索患者姓名、ID 或诊断"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            style={{ width: 280 }}
            prefix={<SearchOutlined />}
            allowClear
          />
          {onRefresh ? <Button onClick={onRefresh}>刷新</Button> : null}
        </Space>

        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalVisible(true)}>
          新建患者
        </Button>
      </div>

      <Table
        className="table-card"
        columns={columns}
        dataSource={filteredPatients}
        rowKey="id"
        loading={loading}
        pagination={{
          current: tableParams.pagination.current,
          pageSize: tableParams.pagination.pageSize,
          total: filteredPatients.length,
          showSizeChanger: true,
          showQuickJumper: true,
          showTotal: (total) => `共 ${total} 条记录`,
        }}
        onChange={handleTableChange}
        scroll={{ x: 1200 }}
      />

      <Modal
        title="新建患者"
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        onOk={() => form.submit()}
        okText="创建"
        cancelText="取消"
      >
        <Form<CreatePatientForm> form={form} layout="vertical" onFinish={handleAddPatient}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入患者姓名' }]}>
            <Input placeholder="请输入患者姓名" />
          </Form.Item>
          <Form.Item name="age" label="年龄" rules={[{ required: true, message: '请输入患者年龄' }]}>
            <InputNumber min={0} max={150} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="gender" label="性别" rules={[{ required: true, message: '请选择性别' }]}>
            <Select
              placeholder="请选择性别"
              options={[
                { value: 'M', label: '男' },
                { value: 'F', label: '女' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CaseListTable;
