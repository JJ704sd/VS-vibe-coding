const API_BASE = 'http://localhost:6090';

export interface TrainingState {
  status: 'idle' | 'training' | 'done' | 'error';
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
  best_f1?: number;
  test_accuracy?: number;
  path: string;
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
  lr: number;
  is_best: boolean;
  best_macro_f1?: number;
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
}

export interface CheckpointInfo {
  round: string;
  number: number;
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
    onMessage(JSON.parse(e.data));
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
    onMessage(JSON.parse(e.data));
  });
  if (onError) es.onerror = onError;
  return () => es.close();
}

// Training control
export async function submitTrainingTask(config: TrainTaskConfig): Promise<{ ok: boolean; task_id: string }> {
  const res = await fetch(`${API_BASE}/api/training/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to submit training task');
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