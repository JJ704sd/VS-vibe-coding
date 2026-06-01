import { ASSISTANT_API_BASE_URL } from '../config/env.ts';

const API_BASE = ASSISTANT_API_BASE_URL;

export interface AssistantHealth {
  available: boolean;
  service?: string;
  message: string;
}

export interface AssistantCaseSnapshot {
  patientId: string;
  recordId: string;
  leadCount: number;
  primaryLead: string;
  annotationCount: number;
  signalQuality: number;
  annotations: Array<{
    id: string;
    type: string;
    position: number;
    confidence: number;
    manual: boolean;
  }>;
  aiResults: Array<{
    className: string;
    probability: number;
  }>;
  note?: string;
}

export interface AssistantSource {
  type: 'memory' | 'knowledge' | 'case';
  title: string;
  path: string;
  score: number;
  snippet: string;
}

export interface AssistantRecommendation {
  priority: 'low' | 'medium' | 'high' | string;
  text: string;
}

export interface AssistantWarning {
  code: string;
  message: string;
}

export interface AssistantMetric {
  label: string;
  value: string;
}

export interface AssistantCaseAnalysis {
  status: 'ready' | 'attention' | 'insufficient' | string;
  severity: 'info' | 'warning' | 'critical';
  summary: string;
  metrics: AssistantMetric[];
  warnings: AssistantWarning[];
  recommendations: AssistantRecommendation[];
  sources: AssistantSource[];
}

export interface AssistantAnswer {
  mode: 'memory' | 'knowledge' | 'case';
  answer: string;
  sources: AssistantSource[];
}

export async function checkAssistantHealth(): Promise<AssistantHealth> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) {
      return { available: false, message: '助手服务未启动' };
    }
    const body = (await res.json()) as { status?: string; service?: string };
    if (body.status !== 'ok') {
      return { available: false, service: body.service, message: '助手服务状态异常' };
    }
    return {
      available: true,
      service: body.service,
      message: '助手服务已连接',
    };
  } catch {
    return { available: false, message: '助手服务未启动' };
  }
}

export async function rebuildAssistantKnowledge(): Promise<{ ok: boolean; indexedDocuments: number; chunks: number }> {
  const res = await fetch(`${API_BASE}/api/assistant/knowledge/rebuild`, { method: 'POST' });
  if (!res.ok) throw new Error('知识库重建失败');
  return res.json();
}

export async function recordAssistantCaseSnapshot(
  snapshot: AssistantCaseSnapshot
): Promise<{ ok: boolean; memoryId: string; storedAt: string }> {
  const res = await fetch(`${API_BASE}/api/assistant/memory/case`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!res.ok) throw new Error('病例上下文记录失败');
  return res.json();
}

export async function analyzeAssistantCase(snapshot: AssistantCaseSnapshot): Promise<AssistantCaseAnalysis> {
  const res = await fetch(`${API_BASE}/api/assistant/case/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: snapshot }),
  });
  if (!res.ok) throw new Error('病例风险分析失败');
  return res.json();
}

export async function askECGAssistant(
  question: string,
  context: Partial<AssistantCaseSnapshot>
): Promise<AssistantAnswer> {
  const res = await fetch(`${API_BASE}/api/assistant/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, context }),
  });
  if (!res.ok) throw new Error('助手查询失败');
  return res.json();
}
