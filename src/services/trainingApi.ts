const API_BASE = 'http://localhost:6090';

export interface TrainingState {
  status: 'idle' | 'training' | 'running' | 'done' | 'error';
  round?: string;
  current_epoch?: number;
  total_epochs?: number;
  stage?: string;
  train_loss?: number;
  train_acc?: number;
  train_f1?: number;
  val_acc?: number;
  val_macro_f1?: number;
  lr?: number;
  message?: string;
  error?: string | null;
  started_at?: string;
  updated_at?: string;
}

export interface ParamStats {
  round: string;
  epoch: number;
  timestamp: string;
  layers: Array<{
    name: string;
    shape: number[];
    mean: number;
    std: number;
    min: number;
    max: number;
    grad_mean?: number;
    grad_std?: number;
  }>;
  global_norm: number;
  trainable_params: number;
  frozen_params: number;
}

export interface TrainTaskConfig {
  dataset: string;
  config: {
    epochs: number;
    batch_size: number;
    lr_backbone: number;
    balance_before_split: boolean;
    unfreeze_mode: string;
  };
}

export interface HistoryRound {
  round: string;
  number: number;
  dataset: string;
  best_f1?: number;
  test_accuracy?: number;
  path: string;
  source_type?: 'result_json' | 'evaluation_json' | 'history_csv' | 'summary_json' | 'unknown' | string;
  status?: 'completed' | 'running' | 'failed' | 'unknown' | string;
  epoch_count?: number;
  best_epoch?: number;
  best_auc?: number;
  best_threshold?: number;
  total_epochs_ran?: number;
}

export interface EpochData {
  epoch: number;
  stage: string;
  train_loss: number;
  train_acc: number;
  train_f1: number;
  val_acc: number;
  val_macro_f1: number;
  val_weighted_f1: number;
  val_auc?: number;
  threshold?: number;
  lr: number;
  lr_backbone?: number;
  lr_head?: number;
  is_best: boolean;
  best_macro_f1?: number;
  best_auc?: number;
  best_epoch?: number;
  best_threshold?: number;
  patience?: number;
  mixup_batches?: number;
  total_train_batches?: number;
}

export interface EvaluationData {
  model: string;
  checkpoint: string;
  val_macro_f1_original: number;
  val_subset_macro_f1: number;
  test_accuracy: number;
  test_macro_f1: number;
  test_weighted_f1: number;
  test_per_class_f1: Record<string, number>;
  confusion_matrix: number[][];
  classification_report: string;
  test_samples_count: number;
  best_epoch?: number;
  best_auc?: number;
  best_threshold?: number;
  source_type?: string;
}

export interface CheckpointInfo {
  round: string;
  number: number;
  dataset: string;
  filename: string;
  size_bytes: number;
  best_f1?: number;
}

export interface ParamHistory {
  round: string;
  epochs: Array<{
    epoch: number;
    timestamp: string;
    global_norm: number;
    trainable_params: number;
    frozen_params: number;
    layer_summary: Array<{ name: string; mean: number; std: number }>;
  }>;
}

export interface TrainingDecision {
  nextAction: 'inspect' | 'continue' | 'stop_and_review' | 'rerun_best' | 'adjust_config' | string;
  confidence: 'low' | 'medium' | 'high' | string;
  reason: string;
}

export interface TrainingWarning {
  code: string;
  message: string;
}

export interface RecommendedCheckpointDirection {
  action: 'keep_best_round' | 'generate_evaluation' | 'rerun_best' | 'adjust_config' | string;
  round?: string | null;
  reason: string;
}

export interface TrainingDiagnosis {
  status: string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  recommendations: string[];
  evidence: Array<{
    label: string;
    value: string;
  }>;
  recommendedRound?: HistoryRound | null;
  decision?: TrainingDecision;
  warnings?: TrainingWarning[];
}

export interface TrainingHistoryDiagnosis {
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  bestRound?: HistoryRound | null;
  trend: {
    direction: 'improving' | 'declining' | 'stable';
    delta: number;
    window: number;
  };
  anomalies: Array<{
    round: string;
    reason: string;
  }>;
  recommendations: string[];
  recommendedCheckpointDirection?: RecommendedCheckpointDirection;
  rankedRounds: HistoryRound[];
}

const getMetricValue = (round: HistoryRound, key: 'best_f1' | 'test_accuracy'): number => {
  const value = round[key];
  return typeof value === 'number' ? value : 0;
};

export function buildTrainingHistoryDiagnosis(rounds: HistoryRound[]): TrainingHistoryDiagnosis {
  const rankedRounds = [...rounds].sort((a, b) => getMetricValue(b, 'best_f1') - getMetricValue(a, 'best_f1'));
  const bestRound = rankedRounds[0] ?? null;
  const anomalies = rounds.flatMap((round) => {
    const bestF1 = getMetricValue(round, 'best_f1');
    const accuracy = getMetricValue(round, 'test_accuracy');
    if (bestF1 <= 0) {
      return [{ round: round.round, reason: '缺少有效 F1，可能没有评估结果或训练失败。' }];
    }
    if (accuracy >= 0.8 && bestF1 <= 0.4) {
      return [{ round: round.round, reason: 'accuracy 高但 F1 低，可能存在类别不平衡或少数类表现较差。' }];
    }
    return [];
  });

  const recent = [...rounds].sort((a, b) => a.number - b.number).slice(-3);
  const delta = recent.length >= 2 ? getMetricValue(recent[recent.length - 1], 'best_f1') - getMetricValue(recent[0], 'best_f1') : 0;
  const direction = delta >= 0.05 ? 'improving' : delta <= -0.05 ? 'declining' : 'stable';
  const recommendations = bestRound
    ? [`优先保留或下载 ${bestRound.round}，当前历史 best F1 为 ${getMetricValue(bestRound, 'best_f1').toFixed(4)}。`]
    : ['暂无可排序历史记录，建议先完成一次训练并生成评估结果。'];

  if (direction === 'improving') {
    recommendations.push('最近轮次整体在提升，可以沿用当前训练配置继续小步试验。');
  } else if (direction === 'declining') {
    recommendations.push('最近轮次指标在下降，建议回看最佳轮次配置，避免继续扩大退化趋势。');
  } else {
    recommendations.push('最近轮次变化不明显，建议比较数据切分、学习率和解冻策略。');
  }

  if (anomalies.length > 0) {
    recommendations.push('存在异常历史记录，建议优先检查评估文件、类别分布和训练日志完整性。');
  }

  return {
    severity: anomalies.length > 0 ? 'warning' : 'info',
    summary: bestRound ? `已分析 ${rounds.length} 个历史轮次，最佳轮次为 ${bestRound.round}。` : '暂无历史训练记录可分析。',
    bestRound,
    trend: {
      direction,
      delta: Number(delta.toFixed(6)),
      window: recent.length,
    },
    anomalies,
    recommendations,
    recommendedCheckpointDirection: {
      action: bestRound ? 'keep_best_round' : 'generate_evaluation',
      round: bestRound?.round ?? null,
      reason: bestRound
        ? `${bestRound.round} 当前 best F1 最高，优先保留该 checkpoint。`
        : '暂无有效历史轮次，需要先生成评估结果。',
    },
    rankedRounds: rankedRounds.slice(0, 5),
  };
}

export function parseTrainingStreamEvent<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

// History endpoints
export async function getHistoryRounds(): Promise<HistoryRound[]> {
  const res = await fetch(`${API_BASE}/api/training/history`);
  if (!res.ok) throw new Error('Failed to fetch history rounds');
  return res.json();
}

export async function getHistoryLog(round: string): Promise<{ round: string; epochs: EpochData[] }> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/log`);
  if (!res.ok) throw new Error('Failed to fetch history log');
  return res.json();
}

export async function getHistoryEval(round: string): Promise<EvaluationData> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/eval`);
  if (!res.ok) throw new Error('Failed to fetch history eval');
  return res.json();
}

export async function getHistoryParamStats(round: string): Promise<ParamHistory | null> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/param-stats`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch param stats');
  return res.json();
}

// Current training state
export async function getTrainingState(): Promise<TrainingState> {
  const res = await fetch(`${API_BASE}/api/training/state`);
  if (!res.ok) throw new Error('Failed to fetch training state');
  return res.json();
}

export function createTrainingStateStream(
  onMessage: (state: TrainingState) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/training/state/stream`);
  es.addEventListener('state_update', (e) => {
    const state = parseTrainingStreamEvent<TrainingState>(e);
    if (state) {
      onMessage(state);
      return;
    }
    onError?.(new Event('parse_error'));
  });
  if (onError) es.onerror = onError;
  return () => es.close();
}

// Current param stats
export async function getParamStats(): Promise<ParamStats | null> {
  const res = await fetch(`${API_BASE}/api/training/param-stats`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch param stats');
  return res.json();
}

export function createParamStatsStream(
  onMessage: (stats: ParamStats) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/training/param-stats/stream`);
  es.addEventListener('param_update', (e) => {
    const stats = parseTrainingStreamEvent<ParamStats>(e);
    if (stats) {
      onMessage(stats);
      return;
    }
    onError?.(new Event('parse_error'));
  });
  if (onError) es.onerror = onError;
  return () => es.close();
}

// Training control
export async function submitTrainingTask(config: TrainTaskConfig): Promise<{ ok: boolean; task_id: string }> {
  const res = await fetch(`${API_BASE}/api/training/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to submit training task');
  return res.json();
}

export async function stopTraining(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/api/training/stop`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop training');
  return res.json();
}

// Delete history round
export async function deleteTrainingRound(round: string): Promise<{ ok: boolean; deleted: string }> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete training round');
  return res.json();
}

// Checkpoints
export async function getCheckpoints(): Promise<CheckpointInfo[]> {
  const res = await fetch(`${API_BASE}/api/training/checkpoints`);
  if (!res.ok) throw new Error('Failed to fetch checkpoints');
  return res.json();
}

export function getCheckpointUrl(round: string, filename: string): string {
  return `${API_BASE}/api/training/checkpoints/${round}/${filename}`;
}

export async function getTrainingDiagnosis(): Promise<TrainingDiagnosis> {
  const res = await fetch(`${API_BASE}/api/assistant/training/diagnose`);
  if (!res.ok) throw new Error('Failed to fetch training diagnosis');
  return res.json();
}

export async function getTrainingHistoryDiagnosis(): Promise<TrainingHistoryDiagnosis> {
  const res = await fetch(`${API_BASE}/api/assistant/training/history/diagnose`);
  if (res.ok) return res.json();
  if (res.status !== 404) throw new Error('Failed to fetch training history diagnosis');
  const rounds = await getHistoryRounds();
  return buildTrainingHistoryDiagnosis(rounds);
}
