# 病例标注 Agent 与训练决策 Agent 增强设计

日期：2026-05-24

## 目标

分别增强两个已有 Agent 方向：

1. **病例标注 Agent**：帮助用户检查当前 ECG 病例、标注完整性、AI 推理结果和信号质量风险。
2. **训练决策 Agent**：帮助用户理解当前训练健康状态、历史训练轮次、checkpoint 选择和下一轮训练方向。

两个方向第一版都保持只读：只输出解释、风险提示、建议动作和依据来源；不修改标注、不自动运行推理、不启动或停止训练、不删除历史记录、不改动 checkpoint 文件。

## 当前上下文

项目已经具备这些基础：

- `src/pages/components/SmartAssistancePanel.tsx`
  - 已支持轻量病例问答、知识库检索、病例记忆记录和知识库重建。
  - 调用 `src/services/ecgAssistantApi.ts`。
- `src/pages/components/TrainingAgentPanel.tsx`
  - 调用 `getTrainingDiagnosis()`，展示当前训练健康诊断。
- `src/pages/components/HistoryTrainingAgentPanel.tsx`
  - 调用 `getTrainingHistoryDiagnosis()`，展示历史训练轮次分析。
- `proxy-server/main.py`
  - 已暴露 assistant、memory、knowledge、当前训练诊断和历史训练诊断接口。
- `proxy-server/assistant/`
  - `service.py` 处理病例、记忆、知识库问答。
  - `training_diagnostics.py` 处理当前训练和历史训练规则。

当前缺口不是“没有 Agent”，而是 Agent 的深度不足：已有面板能问答或生成高层诊断，但还没有结构化风险类别、排序后的下一步动作，也没有足够清晰的证据来解释建议来源。

## 方案

采用 **后端确定性规则分析 + 前端结构化展示**。

规则逻辑放在 `proxy-server/assistant/`，因为这里能直接访问病例上下文、病例记忆、RAG 知识库、训练状态、参数统计和历史解析器。React 组件只负责发起请求、展示结构化结果和保留显式工作流按钮。

第一版不接入外部 LLM，保持结果可预测、可测试，并符合医疗 demo 场景的安全边界。

## 方向 2：病例标注 Agent

### 用户价值

用户应该能问“这个病例现在是否值得信任？”并获得一份简洁的只读判断：

- 当前是否加载了有效数据？
- 信号质量是否可接受？
- 标注数量是否足够？
- P/R/T 标注是否均衡，还是集中在单一类型？
- AI 推理结果是否置信，还是存在歧义？
- 下一步应该重点检查什么？

### 后端行为

新增病例质量分析 helper：

`proxy-server/assistant/case_analysis.py`

输入沿用现有 `AssistantCaseSnapshot` 结构：

- `patientId`
- `recordId`
- `leadCount`
- `primaryLead`
- `annotationCount`
- `signalQuality`
- `annotations`
- `aiResults`
- 可选 `note`

输出结构：

```json
{
  "status": "ready|attention|insufficient",
  "severity": "info|warning|critical",
  "summary": "string",
  "metrics": [
    { "label": "Signal quality", "value": "86" }
  ],
  "warnings": [
    { "code": "low_signal_quality", "message": "string" }
  ],
  "recommendations": [
    { "priority": "high", "text": "string" }
  ],
  "sources": [
    {
      "type": "case",
      "title": "Current case snapshot",
      "path": "request.context",
      "score": 1,
      "snippet": "string"
    }
  ]
}
```

第一版确定性规则：

- `leadCount <= 0`：critical，没有可分析导联。
- `signalQuality < 50`：critical，建议重新导入或检查噪声/基线漂移。
- `signalQuality >= 50 && signalQuality < 75`：warning，建议人工复核后再参考 AI。
- `annotationCount === 0`：warning，建议先添加或导入标注。
- P/R/T 标注不均衡：
  - 有标注但只有一种类型：提示当前标签可能不完整。
  - 有 P/T 但没有 R：提示缺少 beat anchor，建议先核对 R 峰。
- AI 结果歧义：
  - 前两名概率差距很小：提示模型输出不够明确。
  - 最高概率偏低：建议人工确认。

### 前端行为

在不替换现有控件的前提下增强 `SmartAssistancePanel`。

新增“病例风险概览”动作：

- sidecar 可用时启用。
- 使用当前 `caseSnapshot`。
- 展示：
  - 状态 Tag
  - 摘要
  - 指标列表
  - 风险提示列表
  - 建议动作列表
  - 来源/证据列表

更新快捷问题：

- `检查当前病例风险`
- `解释当前标注完整性`
- `AI 结果是否可靠？`
- `信号质量需要复查吗？`

离线行为：

- sidecar 不可用时，仍展示浏览器端可计算的轻量病例摘要：
  - 导联数
  - 主导联
  - 信号质量
  - 标注数量
- 远端风险提示和建议动作禁用，并给出明确说明。

## 方向 3：训练决策 Agent

### 用户价值

用户应该能问“下一轮训练应该怎么做？”并得到排序后的、有依据的建议：

- 当前训练是否健康？
- 是否存在过拟合、欠拟合、训练停滞、梯度/参数异常？
- 哪个历史 round/checkpoint 最值得保留？
- 是否存在 accuracy 高但 F1 低的可疑轮次？
- 下一轮训练配置应优先调整什么？

### 后端行为

扩展：

`proxy-server/assistant/training_diagnostics.py`

当前训练诊断保持已有字段兼容，并新增可选字段：

```json
{
  "status": "idle|training|running|done|error",
  "severity": "info|warning|critical",
  "summary": "string",
  "recommendations": [],
  "evidence": [],
  "recommendedRound": null,
  "decision": {
    "nextAction": "inspect|continue|stop_and_review|rerun_best|adjust_config",
    "confidence": "low|medium|high",
    "reason": "string"
  },
  "warnings": []
}
```

新增当前训练规则：

- error 状态：critical，`nextAction = stop_and_review`。
- idle 且没有历史记录：warning，`nextAction = inspect`。
- running/training 但 `updated_at` 长时间未变化：warning，可能训练进程停滞。
- 验证 F1 下降但训练准确率上升：warning，可能过拟合。
- `global_norm` 过高或参数标准差异常：根据阈值返回 warning/critical。
- training/running 状态下缺失 param stats：warning，建议检查参数观察进程。

历史训练诊断新增决策摘要：

- 最佳轮次按 `best_f1` 优先，其次按 `test_accuracy` 排序。
- 优先选择有有效 `source_type` 且指标非零的轮次。
- 标记异常轮次：
  - `best_f1 <= 0`
  - accuracy 高但 F1 低
  - failed/unknown 状态
  - 缺少 epoch count
  - 最近趋势下降
- 返回 `recommendedCheckpointDirection`：
  - 保留最佳轮次
  - 从最佳轮次配置重新训练
  - 降低学习率
  - 检查类别不平衡
  - 重新生成评估文件

### 前端行为

增强 `TrainingAgentPanel`：

- 新增“决策摘要”区域。
- 展示 next action、confidence 和 reason。
- 如果后端返回 priority，则按优先级展示建议。
- 保留现有诊断依据列表。

增强 `HistoryTrainingAgentPanel`：

- 新增“推荐 checkpoint / 下一轮方向”区域。
- 展示推荐的最佳轮次及推荐理由。
- 对异常轮次展示风险 Tag。
- 保留现有 ranked rounds 表格。

不增加任何会修改训练状态的按钮。所有建议都只是文本。

## API 变化

新增病例风险分析接口：

`POST /api/assistant/case/analyze`

请求：

```json
{
  "context": {
    "patientId": "P001",
    "recordId": "R001",
    "leadCount": 12,
    "primaryLead": "II",
    "annotationCount": 23,
    "signalQuality": 86,
    "annotations": [],
    "aiResults": [],
    "note": "optional free text"
  }
}
```

响应：

```json
{
  "status": "attention",
  "severity": "warning",
  "summary": "string",
  "metrics": [],
  "warnings": [],
  "recommendations": [],
  "sources": []
}
```

扩展现有接口，但不破坏当前客户端：

- `GET /api/assistant/training/diagnose`
- `GET /api/assistant/training/history/diagnose`
- `POST /api/assistant/ask`

已有字段保持有效；新增字段在 TypeScript 中为 optional，确保旧测试 fixture 和 fallback 行为仍可运行。

## 安全规则

- 所有 Agent 输出都是工作流辅助，不是医学诊断结论。
- 不使用“确诊”“最终诊断”等结论性表达。
- Agent 接口不修改项目状态。
- sources 不暴露绝对文件系统路径。
- 回答中不包含完整原始 ECG 信号数组。
- 来源必须明确区分当前病例上下文、病例记忆、知识库、训练状态和历史数据。

## 测试

后端测试：

- 没有导联时，病例分析返回 critical。
- 信号质量低时，病例分析返回 warning/critical。
- 标注类型不均衡时，病例分析返回风险提示。
- AI 概率接近时，病例分析提示歧义。
- 当前训练诊断新增 decision 字段，同时保留旧字段。
- 训练状态长时间未更新时，诊断提示停滞风险。
- 历史诊断推荐最佳有效轮次，并标记异常轮次。

前端测试：

- `analyzeAssistantCase()` 调用 `/api/assistant/case/analyze` 并携带当前上下文。
- 扩展后的训练诊断类型可以兼容缺失 optional 字段的旧响应。
- 智能辅助面板能渲染病例风险摘要、风险提示、建议动作和来源。
- 训练 Agent 面板能渲染决策摘要，且不出现会修改训练状态的控件。

验证命令：

- `npm run test:backend`
- `npm run test:unit`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

## 实施边界

范围内：

- 后端确定性病例分析 helper。
- 病例风险分析接口。
- 当前训练和历史训练诊断的决策字段扩展。
- 前端 API 类型和调用函数。
- `SmartAssistancePanel` 的病例风险概览。
- `TrainingAgentPanel` 和 `HistoryTrainingAgentPanel` 的决策展示。
- 聚焦的后端和前端测试。

范围外：

- 新增统一顶层 Agent 路由。
- LLM provider 集成。
- 自动修改标注。
- 自动提交或停止训练任务。
- checkpoint 删除或下载自动化。
- 超出现有病例记忆之外的长期 Agent 运行历史。

## 验收标准

- 病例标注 Agent 可以为当前病例生成结构化风险概览。
- 训练决策 Agent 可以为当前训练状态展示下一步动作决策。
- 历史训练 Agent 可以基于异常证据推荐 checkpoint 方向。
- 现有助手问答、病例记忆、知识库重建和训练诊断动作仍可使用。
- sidecar 离线不会影响标注基础控件。
- 后端和前端测试覆盖新增结构化输出。
- 全量验证命令通过；如有无关既有失败，必须明确记录。
