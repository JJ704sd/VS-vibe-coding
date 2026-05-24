# 病例标注与训练决策 Agent 增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `2026-05-24-case-and-training-agent-enhancements-design.md` 增强病例标注 Agent 与训练决策 Agent，保持只读、可测试、可回退。

**Architecture:** 后端新增确定性病例风险分析 helper，并扩展训练诊断输出的 decision / warnings 字段；前端扩展 API 类型和三个现有 Agent 面板的结构化展示。所有新增行为先写测试，后写最小实现。

**Tech Stack:** Python FastAPI sidecar + pytest；React 18 + TypeScript + Ant Design；Node built-in test runner。

---

## File Changes Overview

| 文件 | 责任 |
| --- | --- |
| `proxy-server/assistant/case_analysis.py` | 新增病例风险分析规则，输入当前病例快照，输出 status/severity/metrics/warnings/recommendations/sources。 |
| `proxy-server/tests/test_case_analysis.py` | 覆盖无导联、低信号质量、标注类型不均衡、AI 概率歧义。 |
| `proxy-server/main.py` | 新增 `POST /api/assistant/case/analyze`，调用病例分析 helper。 |
| `proxy-server/tests/test_assistant_service.py` | 保留现有助手行为，增加 ask 输出 warnings/recommendations 兼容性检查。 |
| `proxy-server/assistant/training_diagnostics.py` | 扩展当前训练与历史训练诊断，新增 decision、warnings、recommendedCheckpointDirection。 |
| `proxy-server/tests/test_training_diagnostics.py` | 新增 stale training、decision 字段、历史 checkpoint 方向测试。 |
| `src/services/ecgAssistantApi.ts` | 新增病例分析类型和 `analyzeAssistantCase()`。 |
| `src/services/ecgAssistantApi.test.ts` | 覆盖病例分析 API 请求和响应解析。 |
| `src/services/trainingApi.ts` | 扩展 TrainingDiagnosis / TrainingHistoryDiagnosis 类型和前端 fallback builder。 |
| `src/services/trainingApi.test.ts` | 覆盖 fallback history diagnosis 的新增字段。 |
| `src/pages/components/SmartAssistancePanel.tsx` | 增加病例风险概览、离线轻量摘要、warnings/recommendations/sources 展示。 |
| `src/pages/components/TrainingAgentPanel.tsx` | 展示训练决策摘要。 |
| `src/pages/components/HistoryTrainingAgentPanel.tsx` | 展示推荐 checkpoint / 下一轮方向。 |

---

### Task 1: Backend Case Analysis Helper

**Files:**
- Create: `proxy-server/assistant/case_analysis.py`
- Test: `proxy-server/tests/test_case_analysis.py`

- [ ] **Step 1: Write the failing tests**

Create `proxy-server/tests/test_case_analysis.py`:

```python
from assistant.case_analysis import analyze_case_snapshot


def test_case_analysis_returns_critical_when_no_leads():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 0,
        "primaryLead": "II",
        "annotationCount": 0,
        "signalQuality": 88,
        "annotations": [],
        "aiResults": [],
    })

    assert result["status"] == "insufficient"
    assert result["severity"] == "critical"
    assert any(item["code"] == "no_leads" for item in result["warnings"])


def test_case_analysis_warns_on_low_signal_quality():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 2,
        "signalQuality": 62,
        "annotations": [
            {"id": "a1", "type": "R", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "R", "position": 240, "confidence": 0.88, "manual": False},
        ],
        "aiResults": [{"className": "Normal", "probability": 0.78}],
    })

    assert result["status"] == "attention"
    assert result["severity"] == "warning"
    assert any(item["code"] == "medium_signal_quality" for item in result["warnings"])


def test_case_analysis_warns_on_annotation_type_imbalance():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 3,
        "signalQuality": 90,
        "annotations": [
            {"id": "a1", "type": "P", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "P", "position": 240, "confidence": 0.88, "manual": False},
            {"id": "a3", "type": "T", "position": 360, "confidence": 0.84, "manual": False},
        ],
        "aiResults": [{"className": "Normal", "probability": 0.81}],
    })

    assert any(item["code"] == "missing_r_anchor" for item in result["warnings"])


def test_case_analysis_warns_on_ambiguous_ai_results():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 3,
        "signalQuality": 90,
        "annotations": [
            {"id": "a1", "type": "P", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "R", "position": 240, "confidence": 0.88, "manual": False},
            {"id": "a3", "type": "T", "position": 360, "confidence": 0.84, "manual": False},
        ],
        "aiResults": [
            {"className": "Normal", "probability": 0.48},
            {"className": "AF", "probability": 0.45},
        ],
    })

    assert any(item["code"] == "ambiguous_ai_result" for item in result["warnings"])
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test:backend
```

Expected: pytest fails because `assistant.case_analysis` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `proxy-server/assistant/case_analysis.py`:

```python
from collections import Counter
from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) else default


def _count_by_type(annotations: list[dict[str, Any]]) -> Counter:
    return Counter(str(item.get("type") or "").upper() for item in annotations if item.get("type"))


def analyze_case_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    lead_count = int(_number(snapshot.get("leadCount"), 0))
    annotation_count = int(_number(snapshot.get("annotationCount"), 0))
    signal_quality = _number(snapshot.get("signalQuality"), 0)
    annotations = snapshot.get("annotations") if isinstance(snapshot.get("annotations"), list) else []
    ai_results = snapshot.get("aiResults") if isinstance(snapshot.get("aiResults"), list) else []
    type_counts = _count_by_type(annotations)

    warnings: list[dict[str, str]] = []
    recommendations: list[dict[str, str]] = []
    severity = "info"
    status = "ready"

    if lead_count <= 0:
        warnings.append({"code": "no_leads", "message": "当前病例没有可分析导联。"})
        recommendations.append({"priority": "high", "text": "请先导入 ECG 数据或切换到包含导联的记录。"})
        severity = "critical"
        status = "insufficient"

    if signal_quality < 50:
        warnings.append({"code": "low_signal_quality", "message": "当前信号质量偏低。"})
        recommendations.append({"priority": "high", "text": "建议重新导入数据，或先检查噪声与基线漂移。"})
        severity = "critical"
        status = "insufficient"
    elif signal_quality < 75:
        warnings.append({"code": "medium_signal_quality", "message": "当前信号质量需要人工复核。"})
        recommendations.append({"priority": "medium", "text": "参考 AI 结果前，请先检查主导联波形质量。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"

    if annotation_count == 0:
        warnings.append({"code": "no_annotations", "message": "当前记录还没有标注。"})
        recommendations.append({"priority": "medium", "text": "建议先添加或导入 P/R/T 标注。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"
    elif len(type_counts) == 1:
        only_type = next(iter(type_counts))
        warnings.append({"code": "single_annotation_type", "message": f"当前标注集中在 {only_type} 类型。"})
        recommendations.append({"priority": "medium", "text": "建议检查 P/R/T 标注是否缺失。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"

    if annotation_count > 0 and "R" not in type_counts and ("P" in type_counts or "T" in type_counts):
        warnings.append({"code": "missing_r_anchor", "message": "存在 P/T 标注但缺少 R 峰锚点。"})
        recommendations.append({"priority": "high", "text": "建议先核对 R 峰，再判断 P/T 标注完整性。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"

    probabilities = sorted(
        [_number(item.get("probability"), 0) for item in ai_results if isinstance(item, dict)],
        reverse=True,
    )
    if len(probabilities) >= 2 and probabilities[0] - probabilities[1] <= 0.08:
        warnings.append({"code": "ambiguous_ai_result", "message": "AI 前两名概率接近，结果存在歧义。"})
        recommendations.append({"priority": "medium", "text": "建议人工复核 AI 最高概率类别。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"
    elif probabilities and probabilities[0] < 0.6:
        warnings.append({"code": "low_ai_confidence", "message": "AI 最高概率偏低。"})
        recommendations.append({"priority": "medium", "text": "建议不要单独依赖该 AI 结果。"})
        if severity != "critical":
            severity = "warning"
            status = "attention"

    summary = (
        f"当前记录 {snapshot.get('recordId') or '-'}：{lead_count} 个导联，"
        f"主导联 {snapshot.get('primaryLead') or '-'}，信号质量 {signal_quality:.0f}%，"
        f"标注 {annotation_count} 个。"
    )
    if warnings:
        summary += " 存在需要复核的风险项。"
    else:
        summary += " 暂未发现明显病例质量风险。"

    return {
        "status": status,
        "severity": severity,
        "summary": summary,
        "metrics": [
            {"label": "导联数", "value": str(lead_count)},
            {"label": "主导联", "value": str(snapshot.get("primaryLead") or "-")},
            {"label": "信号质量", "value": f"{signal_quality:.0f}%"},
            {"label": "标注数量", "value": str(annotation_count)},
        ],
        "warnings": warnings,
        "recommendations": recommendations,
        "sources": [{
            "type": "case",
            "title": "当前病例快照",
            "path": "request.context",
            "score": 1,
            "snippet": summary,
        }],
    }
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test:backend
```

Expected: all pytest tests pass.

- [ ] **Step 5: Commit**

```bash
git add proxy-server/assistant/case_analysis.py proxy-server/tests/test_case_analysis.py
git commit -m "feat: add case annotation risk analysis"
```

---

### Task 2: Backend Case Analysis Endpoint

**Files:**
- Modify: `proxy-server/main.py`
- Test: `proxy-server/tests/test_assistant_service.py`

- [ ] **Step 1: Write the failing endpoint test**

Add to `proxy-server/tests/test_assistant_service.py`:

```python
def test_case_analyze_endpoint_returns_structured_risk(monkeypatch):
    import asyncio
    import main

    result = asyncio.run(main.analyze_assistant_case({
        "context": {
            "patientId": "p1",
            "recordId": "r1",
            "leadCount": 0,
            "primaryLead": "II",
            "annotationCount": 0,
            "signalQuality": 80,
            "annotations": [],
            "aiResults": [],
        }
    }))

    assert result["severity"] == "critical"
    assert any(item["code"] == "no_leads" for item in result["warnings"])
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:backend
```

Expected: FAIL because `main.analyze_assistant_case` is not defined.

- [ ] **Step 3: Add endpoint implementation**

In `proxy-server/main.py`:

```python
from assistant.case_analysis import analyze_case_snapshot
```

Add after assistant ask route:

```python
@app.post("/api/assistant/case/analyze")
async def analyze_assistant_case(body: dict):
    context = body.get("context") or {}
    if not isinstance(context, dict):
        raise HTTPException(status_code=400, detail="context must be an object")
    return analyze_case_snapshot(context)
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test:backend
```

Expected: all pytest tests pass.

- [ ] **Step 5: Commit**

```bash
git add proxy-server/main.py proxy-server/tests/test_assistant_service.py
git commit -m "feat: expose case analysis endpoint"
```

---

### Task 3: Backend Training Decision Fields

**Files:**
- Modify: `proxy-server/assistant/training_diagnostics.py`
- Test: `proxy-server/tests/test_training_diagnostics.py`

- [ ] **Step 1: Write failing tests**

Add to `proxy-server/tests/test_training_diagnostics.py`:

```python
def test_training_diagnosis_includes_decision_for_error_state():
    result = diagnose_training(
        state={"status": "error", "error": "OOM"},
        param_stats=None,
        history_rounds=[],
    )

    assert result["severity"] == "critical"
    assert result["decision"]["nextAction"] == "stop_and_review"
    assert result["warnings"][0]["code"] == "training_error"


def test_training_diagnosis_warns_when_running_without_param_stats():
    result = diagnose_training(
        state={"status": "running", "current_epoch": 3, "total_epochs": 5},
        param_stats=None,
        history_rounds=[],
    )

    assert result["decision"]["nextAction"] in {"continue", "inspect"}
    assert any(item["code"] == "missing_param_stats" for item in result["warnings"])


def test_history_diagnosis_returns_checkpoint_direction():
    result = diagnose_training_history([
        {"round": "round_1", "dataset": "MIT-BIH", "best_f1": 0.62, "test_accuracy": 0.7, "source_type": "evaluation_json"},
        {"round": "round_2", "dataset": "MIT-BIH", "best_f1": 0.82, "test_accuracy": 0.84, "source_type": "evaluation_json"},
    ])

    assert result["recommendedCheckpointDirection"]["round"] == "round_2"
    assert result["recommendedCheckpointDirection"]["action"] == "keep_best_round"
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm run test:backend
```

Expected: FAIL because `decision`, `warnings`, and `recommendedCheckpointDirection` are missing.

- [ ] **Step 3: Extend diagnostics minimally**

Modify `diagnose_training()` so all return paths include:

```python
"decision": {
    "nextAction": "inspect",
    "confidence": "medium",
    "reason": "当前没有训练任务在运行，建议先查看历史最佳轮次或提交小规模基线训练。",
},
"warnings": [],
```

For error state:

```python
if status == "error":
    return {
        "status": status,
        "severity": "critical",
        "summary": "训练任务处于错误状态，需要先检查错误信息。",
        "recommendations": ["先检查训练日志和错误信息，再决定是否重跑。"],
        "evidence": evidence + [{"label": "Error", "value": str(state.get("error") or "-")}],
        "recommendedRound": best,
        "decision": {
            "nextAction": "stop_and_review",
            "confidence": "high",
            "reason": "训练状态为 error，继续提交新任务前应先定位失败原因。",
        },
        "warnings": [{"code": "training_error", "message": str(state.get("error") or "训练失败。")}],
    }
```

When status is training/running and `param_stats` is missing:

```python
warnings.append({"code": "missing_param_stats", "message": "训练运行中但缺少参数统计。"})
recommendations.append("建议检查 param_observer 是否运行，确认参数统计文件是否正常更新。")
```

Modify `diagnose_training_history()` return:

```python
"recommendedCheckpointDirection": {
    "action": "keep_best_round" if best else "generate_evaluation",
    "round": best.get("round") if best else None,
    "reason": f"{best.get('round')} 当前 best F1 最高，优先保留该 checkpoint。" if best else "暂无有效历史轮次，需要先生成评估结果。",
},
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test:backend
```

Expected: all pytest tests pass.

- [ ] **Step 5: Commit**

```bash
git add proxy-server/assistant/training_diagnostics.py proxy-server/tests/test_training_diagnostics.py
git commit -m "feat: add training agent decision fields"
```

---

### Task 4: Frontend API Types And Tests

**Files:**
- Modify: `src/services/ecgAssistantApi.ts`
- Modify: `src/services/ecgAssistantApi.test.ts`
- Modify: `src/services/trainingApi.ts`
- Modify: `src/services/trainingApi.test.ts`

- [ ] **Step 1: Write failing API tests**

Add to `src/services/ecgAssistantApi.test.ts`:

```typescript
import { analyzeAssistantCase } from './ecgAssistantApi.ts';

test('analyzeAssistantCase posts the current case context', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'http://localhost:6090/api/assistant/case/analyze');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      context: {
        patientId: 'p1',
        recordId: 'r1',
        leadCount: 0,
        primaryLead: 'II',
        annotationCount: 0,
        signalQuality: 88,
        annotations: [],
        aiResults: [],
      },
    });
    return new Response(JSON.stringify({
      status: 'insufficient',
      severity: 'critical',
      summary: 'no leads',
      metrics: [],
      warnings: [],
      recommendations: [],
      sources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const result = await analyzeAssistantCase({
    patientId: 'p1',
    recordId: 'r1',
    leadCount: 0,
    primaryLead: 'II',
    annotationCount: 0,
    signalQuality: 88,
    annotations: [],
    aiResults: [],
  });

  assert.equal(result.severity, 'critical');
});
```

Add to `src/services/trainingApi.test.ts`:

```typescript
test('buildTrainingHistoryDiagnosis includes checkpoint direction fallback', () => {
  const result = buildTrainingHistoryDiagnosis([
    { round: 'round_1', number: 1, dataset: 'MIT-BIH', best_f1: 0.7, test_accuracy: 0.72, path: 'r1' },
  ]);

  assert.equal(result.recommendedCheckpointDirection?.round, 'round_1');
  assert.equal(result.recommendedCheckpointDirection?.action, 'keep_best_round');
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm run test:unit
```

Expected: FAIL because `analyzeAssistantCase` and `recommendedCheckpointDirection` are missing.

- [ ] **Step 3: Implement API types**

In `src/services/ecgAssistantApi.ts`, add:

```typescript
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

export async function analyzeAssistantCase(snapshot: AssistantCaseSnapshot): Promise<AssistantCaseAnalysis> {
  const res = await fetch(`${API_BASE}/api/assistant/case/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: snapshot }),
  });
  if (!res.ok) throw new Error('病例风险分析失败');
  return res.json();
}
```

In `src/services/trainingApi.ts`, add:

```typescript
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
```

Extend `TrainingDiagnosis`:

```typescript
decision?: TrainingDecision;
warnings?: TrainingWarning[];
```

Extend `TrainingHistoryDiagnosis`:

```typescript
recommendedCheckpointDirection?: RecommendedCheckpointDirection;
```

In `buildTrainingHistoryDiagnosis()`, include `recommendedCheckpointDirection`.

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
npm run test:unit
```

Expected: all Node tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/ecgAssistantApi.ts src/services/ecgAssistantApi.test.ts src/services/trainingApi.ts src/services/trainingApi.test.ts
git commit -m "feat: add agent analysis api types"
```

---

### Task 5: Frontend Agent Panel Rendering

**Files:**
- Modify: `src/pages/components/SmartAssistancePanel.tsx`
- Modify: `src/pages/components/TrainingAgentPanel.tsx`
- Modify: `src/pages/components/HistoryTrainingAgentPanel.tsx`

- [ ] **Step 1: Add SmartAssistancePanel state and API call**

Import:

```typescript
AssistantCaseAnalysis,
analyzeAssistantCase,
```

Add state:

```typescript
const [caseAnalysis, setCaseAnalysis] = useState<AssistantCaseAnalysis | null>(null);
```

Add handler:

```typescript
const handleAnalyzeCase = async (): Promise<void> => {
  setAssistantLoading(true);
  try {
    const result = await analyzeAssistantCase(caseSnapshot);
    setCaseAnalysis(result);
  } catch (error) {
    message.error(error instanceof Error ? error.message : '病例风险分析失败');
  } finally {
    setAssistantLoading(false);
  }
};
```

- [ ] **Step 2: Add SmartAssistancePanel rendering**

Add a button near existing assistant controls:

```tsx
<Button disabled={!assistantAvailable} loading={assistantLoading} onClick={handleAnalyzeCase} block>
  生成病例风险概览
</Button>
```

Render summary:

```tsx
{caseAnalysis && (
  <Space direction="vertical" style={{ width: '100%' }}>
    <Tag color={caseAnalysis.severity === 'critical' ? 'red' : caseAnalysis.severity === 'warning' ? 'orange' : 'green'}>
      {caseAnalysis.status}
    </Tag>
    <Text>{caseAnalysis.summary}</Text>
    <List size="small" dataSource={caseAnalysis.metrics} renderItem={(item) => (
      <List.Item>
        <Text type="secondary">{item.label}</Text>
        <Text>{item.value}</Text>
      </List.Item>
    )} />
    <List size="small" header={<Text strong>风险提示</Text>} dataSource={caseAnalysis.warnings} locale={{ emptyText: '暂无风险提示' }} renderItem={(item) => (
      <List.Item>{item.message}</List.Item>
    )} />
    <List size="small" header={<Text strong>建议动作</Text>} dataSource={caseAnalysis.recommendations} locale={{ emptyText: '暂无建议动作' }} renderItem={(item) => (
      <List.Item>
        <Tag>{item.priority}</Tag>
        <Text>{item.text}</Text>
      </List.Item>
    )} />
  </Space>
)}
```

- [ ] **Step 3: Add TrainingAgentPanel decision rendering**

Under summary:

```tsx
{diagnosis.decision && (
  <Alert
    type={diagnosis.severity === 'critical' ? 'error' : diagnosis.severity === 'warning' ? 'warning' : 'info'}
    showIcon
    message={`决策摘要：${diagnosis.decision.nextAction} / ${diagnosis.decision.confidence}`}
    description={diagnosis.decision.reason}
  />
)}
```

Render warnings if present:

```tsx
{diagnosis.warnings && diagnosis.warnings.length > 0 && (
  <List size="small" header={<Text strong>风险提示</Text>} dataSource={diagnosis.warnings} renderItem={(item) => (
    <List.Item>{item.message}</List.Item>
  )} />
)}
```

- [ ] **Step 4: Add HistoryTrainingAgentPanel direction rendering**

Under summary:

```tsx
{diagnosis.recommendedCheckpointDirection && (
  <Alert
    type={diagnosis.severity === 'warning' ? 'warning' : 'info'}
    showIcon
    message={`推荐方向：${diagnosis.recommendedCheckpointDirection.action}`}
    description={diagnosis.recommendedCheckpointDirection.reason}
  />
)}
```

- [ ] **Step 5: Run typecheck and lint**

Run:

```bash
npm run typecheck
npm run lint
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/pages/components/SmartAssistancePanel.tsx src/pages/components/TrainingAgentPanel.tsx src/pages/components/HistoryTrainingAgentPanel.tsx
git commit -m "feat: show agent decision summaries"
```

---

### Task 6: Final Verification And Review Update

**Files:**
- Modify: `REVIEW.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run check
npm run test:backend
```

Expected:

- `npm run check`: lint, typecheck,  unit tests, and build pass.
- `npm run test:backend`: all pytest tests pass.

- [ ] **Step 2: Update REVIEW.md**

Add a note under 最新整理:

```markdown
- 已按 Agent 增强设计完成第一阶段实现：病例风险分析接口、训练决策字段和前端面板展示。
```

Add the final verification command results to 验证结果.

- [ ] **Step 3: Commit review update**

```bash
git add REVIEW.md
git commit -m "docs: update review after agent enhancements"
```

- [ ] **Step 4: Push branch**

```bash
git push origin codex/continue-ecg-hardening
```

Expected: branch pushes to `https://github.com/JJ704sd/VS-vibe-coding.git`.
