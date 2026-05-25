import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  InputNumber,
  Modal,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { DownloadOutlined, StopOutlined } from '@ant-design/icons';
import * as trainingApi from '../services/trainingApi';
import type {
  HistoryRound,
  EpochData,
  EvaluationData,
  ParamHistory,
  ParamStats,
  TrainTaskConfig,
  TrainingState,
  CheckpointInfo,
} from '../services/trainingApi';
import TrainingCharts from './components/TrainingCharts';
import ParamStatsPanel from './components/ParamStatsPanel';
import TrainingAgentPanel from './components/TrainingAgentPanel';
import HistoryTrainingAgentPanel from './components/HistoryTrainingAgentPanel';
import { loadTrainingRoundDetails } from './components/trainingRoundDetails';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

const formatMetric = (value?: number, digits = 4): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return value.toFixed(digits);
};

const formatPercent = (value?: number): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '-';
  return `${(value * 100).toFixed(2)}%`;
};

const sourceColor = (source?: string): string => {
  if (source === 'history_csv') return 'cyan';
  if (source === 'evaluation_json') return 'purple';
  if (source === 'summary_json') return 'geekblue';
  if (source === 'result_json') return 'green';
  return 'default';
};

const metricScopeLabel = (scope?: string): string => {
  if (scope === 'test') return 'Test';
  if (scope === 'validation') return 'Validation-derived';
  return scope || '-';
};

// ==================== HistoryTable ====================
interface HistoryTableProps {
  rounds: HistoryRound[];
  loading: boolean;
  onSelectRound: (round: HistoryRound) => void;
  onDeleteRound: (round: string) => void;
}

const HistoryTable: React.FC<HistoryTableProps> = ({ rounds, loading, onSelectRound, onDeleteRound }) => {
  const columns = [
    {
      title: 'Dataset',
      dataIndex: 'dataset',
      key: 'dataset',
      render: (text: string) => <Tag color="green">{text}</Tag>,
    },
    {
      title: 'Round',
      dataIndex: 'round',
      key: 'round',
      render: (text: string) => <Tag color="blue">{text}</Tag>,
    },
    {
      title: 'Best F1',
      dataIndex: 'best_f1',
      key: 'best_f1',
      render: (val?: number) => (val != null && val > 0 ? <Text style={{ color: '#52c41a' }}>{val.toFixed(4)}</Text> : '-'),
    },
    {
      title: 'Best Epoch',
      dataIndex: 'best_epoch',
      key: 'best_epoch',
      render: (val?: number) => (val != null && val > 0 ? val : '-'),
    },
    {
      title: 'AUC',
      dataIndex: 'best_auc',
      key: 'best_auc',
      render: (val?: number) => formatMetric(val),
    },
    {
      title: 'Threshold',
      dataIndex: 'best_threshold',
      key: 'best_threshold',
      render: (val?: number) => formatMetric(val, 3),
    },
    {
      title: 'Epochs',
      dataIndex: 'epoch_count',
      key: 'epoch_count',
      render: (val?: number) => (val != null && val > 0 ? val : '-'),
    },
    {
      title: 'Test Accuracy',
      dataIndex: 'test_accuracy',
      key: 'test_accuracy',
      render: formatPercent,
    },
    {
      title: 'Source',
      dataIndex: 'source_type',
      key: 'source_type',
      render: (source?: string) => <Tag color={sourceColor(source)}>{source || 'unknown'}</Tag>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status?: string) => <Tag color={status === 'completed' ? 'green' : 'default'}>{status || 'unknown'}</Tag>,
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, record: HistoryRound) => (
        <Space>
          <Button type="link" onClick={() => onSelectRound(record)}>
            查看详情
          </Button>
          <Button type="link" danger onClick={() => onDeleteRound(record.round)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card className="table-card">
      <Table columns={columns} dataSource={rounds} rowKey="round" loading={loading} pagination={{ pageSize: 10 }} />
    </Card>
  );
};

// ==================== DetailModal ====================
interface DetailModalProps {
  round: HistoryRound | null;
  visible: boolean;
  onClose: () => void;
}

const DetailModal: React.FC<DetailModalProps> = ({ round, visible, onClose }) => {
  const [epochs, setEpochs] = useState<EpochData[]>([]);
  const [evalData, setEvalData] = useState<EvaluationData | null>(null);
  const [paramHistory, setParamHistory] = useState<ParamHistory | null>(null);

  useEffect(() => {
    if (!round) return;
    loadTrainingRoundDetails(round.round, trainingApi)
      .then((details) => {
        setEpochs(details.epochs);
        setEvalData(details.evalData);
        setParamHistory(details.paramHistory);
      })
      .catch(console.error);
  }, [round]);

  if (!round) return null;

  return (
    <Modal title={`Round ${round.round} 详情`} open={visible} onCancel={onClose} width={1000} footer={null}>
      <Tabs defaultActiveKey="curves">
        <TabPane tab="训练曲线" key="curves">
          <TrainingCharts epochs={epochs} evalData={evalData} />
        </TabPane>
        <TabPane tab="参数统计" key="params">
          <ParamStatsPanel paramHistory={paramHistory} />
        </TabPane>
        <TabPane tab="评估结果" key="eval">
          {evalData ? (
            <Descriptions bordered column={2}>
              <Descriptions.Item label="Test Accuracy">{`${(evalData.test_accuracy * 100).toFixed(2)}%`}</Descriptions.Item>
              <Descriptions.Item label="Test Macro F1">{evalData.test_macro_f1.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="Test Weighted F1">{evalData.test_weighted_f1.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="Test Samples">{evalData.test_samples_count}</Descriptions.Item>
              <Descriptions.Item label="Best Epoch">{evalData.best_epoch ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Best AUC">{formatMetric(evalData.best_auc)}</Descriptions.Item>
              <Descriptions.Item label="Best Threshold">{formatMetric(evalData.best_threshold, 3)}</Descriptions.Item>
              <Descriptions.Item label="Source">{evalData.source_type ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="Metric Scope">{metricScopeLabel(evalData.metric_scope)}</Descriptions.Item>
              {evalData.metric_source_note && (
                <Descriptions.Item label="Metric Note" span={2}>
                  {evalData.metric_source_note}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Per-Class F1" span={2}>
                <pre style={{ fontSize: 12 }}>{JSON.stringify(evalData.test_per_class_f1, null, 2)}</pre>
              </Descriptions.Item>
              <Descriptions.Item label="Classification Report" span={2}>
                <pre style={{ fontSize: 12 }}>{evalData.classification_report}</pre>
              </Descriptions.Item>
            </Descriptions>
          ) : (
            <Text type="secondary">暂无评估数据</Text>
          )}
        </TabPane>
      </Tabs>
    </Modal>
  );
};

// ==================== LiveTrainingPanel ====================
interface LiveTrainingPanelProps {
  onSubmitTask: (config: trainingApi.TrainTaskConfig) => Promise<void>;
}

const LiveTrainingPanel: React.FC<LiveTrainingPanelProps> = ({ onSubmitTask }) => {
  const [state, setState] = useState<TrainingState | null>(null);
  const [paramStats, setParamStats] = useState<ParamStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    trainingApi.getTrainingState().then(setState).catch(console.error);

    const closeState = trainingApi.createTrainingStateStream((s) => setState(s));
    const closeParams = trainingApi.createParamStatsStream((p) => setParamStats(p));

    return () => {
      closeState();
      closeParams();
    };
  }, []);

  const handleSubmit = async (values: { epochs: number; batch_size: number; lr_backbone: number }) => {
    setLoading(true);
    try {
      await onSubmitTask({
        dataset: 'ECG',
        config: {
          ...values,
          balance_before_split: false,
          unfreeze_mode: 'last_layer',
        },
      });
      message.success('训练任务已提交');
    } catch (err) {
      message.error('提交失败');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      await trainingApi.stopTraining();
      message.success('已停止训练');
    } catch (err) {
      message.error('停止失败');
      console.error(err);
    }
  };

  const isTraining = state?.status === 'training';
  const percent =
    state?.current_epoch != null && state?.total_epochs != null
      ? Math.round((state.current_epoch / state.total_epochs) * 100)
      : 0;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={16}>
        <Card className="section-card" title="当前训练状态">
          {isTraining ? (
            <>
              <Progress percent={percent} status="active" />
              <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={12} sm={6}>
                  <Statistic title="Train Loss" value={state?.train_loss ?? '-'} />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic title="Train Acc" value={state?.train_acc ?? '-'} />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic title="Val F1" value={state?.val_macro_f1 ?? '-'} />
                </Col>
                <Col xs={12} sm={6}>
                  <Statistic title="LR" value={state?.lr ?? '-'} />
                </Col>
              </Row>
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                Epoch {state?.current_epoch} / {state?.total_epochs} — {state?.stage}
              </Text>
            </>
          ) : state?.status === 'done' ? (
            <Text type="secondary">训练已完成</Text>
          ) : state?.status === 'error' ? (
            <Text type="danger">训练出错: {state?.message ?? state?.error}</Text>
          ) : (
            <Text type="secondary">等待训练任务...</Text>
          )}
        </Card>

        <Card className="section-card" style={{ marginTop: 16 }} title="参数统计">
          <ParamStatsPanel paramStats={paramStats} live />
        </Card>

        <div style={{ marginTop: 16 }}>
          <TrainingAgentPanel />
        </div>
      </Col>

      <Col xs={24} lg={8}>
        <Card className="section-card" title="提交训练任务">
          <Form form={form} layout="vertical" onFinish={handleSubmit}>
            <Form.Item name="epochs" label="Epochs" initialValue={5}>
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="batch_size" label="Batch Size" initialValue={16}>
              <InputNumber min={1} max={256} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="lr_backbone" label="LR Backbone" initialValue={0.0001}>
              <InputNumber min={0} max={1} step={0.0001} style={{ width: '100%' }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              开始训练
            </Button>
            {(state?.status === 'training' || state?.status === 'running') && (
              <Button danger block style={{ marginTop: 8 }} onClick={handleStop} icon={<StopOutlined />}>
                停止训练
              </Button>
            )}
          </Form>
        </Card>
      </Col>
    </Row>
  );
};

// ==================== CheckpointPanel ====================
const CheckpointPanel: React.FC = () => {
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    trainingApi
      .getCheckpoints()
      .then(setCheckpoints)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: 'Dataset', dataIndex: 'dataset', key: 'dataset', render: (t: string) => <Tag color="green">{t}</Tag> },
    { title: 'Round', dataIndex: 'round', key: 'round', render: (t: string) => <Tag>{t}</Tag> },
    {
      title: 'Size (MB)',
      dataIndex: 'size_bytes',
      key: 'size',
      render: (b: number) => (b / 1024 / 1024).toFixed(2),
    },
    {
      title: 'Best F1',
      dataIndex: 'best_f1',
      key: 'best_f1',
      render: (v?: number) => (v != null && v > 0 ? <Text style={{ color: '#52c41a' }}>{v.toFixed(4)}</Text> : '-'),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, r: CheckpointInfo) => (
        <Button
          icon={<DownloadOutlined />}
          onClick={() => window.open(trainingApi.getCheckpointUrl(r.round, r.filename), '_blank')}
        >
          下载
        </Button>
      ),
    },
  ];

  return (
    <Card className="table-card">
      <Table columns={columns} dataSource={checkpoints} rowKey="filename" loading={loading} pagination={false} />
    </Card>
  );
};

// ==================== TrainingDashboard ====================
const TrainingDashboard: React.FC = () => {
  const [rounds, setRounds] = useState<HistoryRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRound, setSelectedRound] = useState<HistoryRound | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  useEffect(() => {
    setLoading(true);
    trainingApi
      .getHistoryRounds()
      .then(setRounds)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSelectRound = (round: HistoryRound) => {
    setSelectedRound(round);
    setDetailVisible(true);
  };

  const handleDeleteRound = async (round: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除训练记录 ${round} 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      async onOk() {
        try {
          await trainingApi.deleteTrainingRound(round);
          message.success('删除成功');
          setRounds((prev) => prev.filter((r) => r.round !== round));
        } catch (err) {
          message.error('删除失败');
          console.error(err);
        }
      },
    });
  };

  const handleSubmitTask = async (config: trainingApi.TrainTaskConfig) => {
    await trainingApi.submitTrainingTask(config);
  };

  return (
    <div className="page-shell page-shell-wide">
      <div className="page-hero">
        <Title>ECGFounder 训练看板</Title>
      </div>
      <Tabs defaultActiveKey="history">
        <TabPane tab="历史训练记录" key="history">
          <HistoryTrainingAgentPanel />
          <HistoryTable rounds={rounds} loading={loading} onSelectRound={handleSelectRound} onDeleteRound={handleDeleteRound} />
        </TabPane>
        <TabPane tab="实时训练" key="live">
          <LiveTrainingPanel onSubmitTask={handleSubmitTask} />
        </TabPane>
        <TabPane tab="Checkpoint 管理" key="checkpoints">
          <CheckpointPanel />
        </TabPane>
      </Tabs>
      <DetailModal round={selectedRound} visible={detailVisible} onClose={() => setDetailVisible(false)} />
    </div>
  );
};

export default TrainingDashboard;
