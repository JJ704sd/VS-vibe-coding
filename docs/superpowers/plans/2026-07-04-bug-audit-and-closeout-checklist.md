# 2026-07-04 BUG 审核与收尾检查文档

## 1. 本轮目标

本轮不是继续堆功能，而是用第一性原理审一遍“端侧推理 + 标注 + 导出 + 自动部署”闭环，找出会让演示、答辩或后续交付失真的 BUG、缺口和验收盲点。

截图中的目标链路可以拆成四个必须被证据证明的能力：

1. TensorFlow.js + Web Workers 加载上海 ECGFounder 模型，并能在浏览器端推理。
2. 模型通过 IndexedDB 缓存，支持断网后继续端侧推理。
3. Canvas 分层渲染与 PQRST 交互标注形成稳定的标注链路。
4. 端到端推理 + 标注链路有功能/回归验证，并能接入 GitHub Pages 自动部署。

## 2. 第一性原理

从用户价值倒推，平台只有在以下链路全部成立时才算“可交付演示”：

`病例/信号输入 -> 波形可信显示 -> 人工/自动标注 -> 模型推理 -> 结果解释/导出 -> 部署后可复现`

因此本轮审核遵守这些原则：

- 不允许静默降级冒充成功。mock inference、demo data、轻量 parser 必须被清楚标识。
- 离线能力必须用真实缓存模型证明，不能用 mock fallback 证明。
- 医疗/科研演示优先防止误导：真实模型、真实数据、非临床边界、来源说明必须可见。
- 每个结论必须有证据：命令输出、浏览器复现、文件路径、截图或测试。
- 回归验证优先覆盖用户链路，不只覆盖服务薄层或 mock 自指。

## 3. 当前仓库证据

已确认的基础：

- `package.json` 有 `npm run check`，展开为 lint、typecheck、frontend unit tests、production build。
- 后端测试入口为 `npm run test:backend`，代理到 `proxy-server/tests/`。
- `.github/workflows/deploy-pages.yml` 监听 `main`，先跑质量门，再 build，push main 时 deploy GitHub Pages。
- `src/config/env.ts` 已统一前端 API base URL 默认值，符合“配置源集中”的项目约束。
- `src/services/modelService.ts` 有 TF.js `indexeddb://ecg-model-cache-*` 缓存回退，并在无真实模型时进入 mock inference。
- `src/pages/AnnotationStudio.tsx` 调用 `modelService.loadModel('/models/ecg-classifier/model.json')` 和 `predictWithHeatmap` 串起模型加载与分析。
- `src/components/Canvas/ECGCanvas.tsx` 用 Fabric.js 渲染网格、波形和标注对象，支持双击添加 P/Q/R/S/T/ST/U 标注、缩放、平移、删除选中标注。
- `src/pages/Smoke.test.tsx` 已覆盖 App mount、DemoBanner、Dashboard smoke。

必须审慎对待的缺口：

- `public/models/ecg-classifier/` 当前只有模型放置说明，没有 `model.json` 或权重 shard。真实“上海 ECGFounder 模型”尚未由仓库文件证明。
- `src/workers/inference.worker.ts` 直接按 URL 加载模型，没有 Worker 内部 IndexedDB 缓存回退。
- `src/hooks/useModelInference.ts` 默认 `useWorker=true`，Worker 失败后才尝试主线程缓存；需要确认业务是否使用该 hook，以及离线场景下是否符合预期。
- 当前 smoke 测试不等于端到端推理 + 标注回归验证。
- `modelService` 的 mock fallback 对演示友好，但也可能掩盖真实模型路径、模型 shape 或缓存 BUG。

## 4. P0 BUG 审核清单

### P0-1 真实模型接入不能被 mock 掩盖

审核问题：

- `public/models/ecg-classifier/model.json` 与权重 shard 是否存在，是否会进入 Pages artifact。
- 如果模型来自上海 ECGFounder 转换产物，转换脚本、输入 shape、class mapping、版本号是否可追溯。
- 模型加载成功时 UI 是否显示“真实模型加载成功”，加载失败时是否明确显示 mock 模式。
- `modelService.isUsingMockInference()` 是否在关键 UI 和导出 metadata 中可追踪。

通过标准：

- 在线加载真实模型成功，DevTools Network 中 `model.json` 和 shard 返回 200。
- 断开模型文件或改错路径后，UI 明确提示 mock，不把结果称为真实模型诊断。
- 导出的 JSON/CSV 能区分真实推理、mock 推理或未分析状态。

建议验证：

```bash
npm run build
```

浏览器手工验证：

1. 打开 Annotation Studio。
2. 点击加载模型。
3. 检查 Network、Console、UI 提示、Redux/导出结果。

### P0-2 断网端侧推理必须证明 IndexedDB 缓存生效

审核问题：

- 首次在线加载后，TF.js 模型是否保存到 IndexedDB。
- 页面刷新、切换 DevTools offline 后，是否仍能加载缓存模型并推理。
- 离线推理结果是否来自真实缓存模型，而不是 mock fallback。
- Worker 路径和主线程路径的离线行为是否一致。

通过标准：

- Application -> IndexedDB 能看到对应 TF.js 模型缓存。
- 离线刷新后点击加载模型，仍能得到真实模型加载成功或明确的“已加载缓存模型”状态。
- `modelService.isUsingMockInference()` 为 false。
- 若 Worker 暂不支持离线缓存，文档和代码要显式选择主线程缓存路径，或补齐 Worker 缓存。

建议回归测试方向：

- 给 `modelService.loadModel()` 补单元测试：远程失败、缓存成功时不进入 mock。
- 给远程失败、缓存失败时进入 mock 的路径保留测试。
- 给 Worker load failure 的 UI 状态补测试或手工检查项。

### P0-3 推理 + 标注 + 导出链路必须一口气走通

审核问题：

- 导入 JSON/WFDB 样例后，导联数、采样率、波形长度是否合理。
- 加载模型、运行分析后，`inferenceResults` 是否进入 Redux，并显示在 UI。
- 双击添加 P/Q/R/S/T 标注后，标注列表、Canvas 标记和导出文件是否一致。
- 删除选中标注后，Redux、Canvas label/circle、统计值是否同步。
- 导出的 JSON/CSV 是否包含 metadata、annotations、diagnosis，并带 patientId/recordId。

通过标准：

- 以同一个样例记录完成：导入 -> 推理 -> PQRST 标注 -> 删除一个标注 -> 导出 JSON -> 导出 CSV。
- 导出文件内标注数量、类型、position 与 UI 一致。
- 模型缺失时，链路仍可演示，但所有结果明确标注为 mock 或未分析。

建议验证：

```bash
npm run test:unit
npm run build
```

如新增 browser e2e，再补一条真实浏览器脚本覆盖该链路。

### P0-4 Canvas 交互坐标不能漂移

审核问题：

- 缩放、平移后新增标注，position 是否仍落在用户双击位置对应的波形横坐标。
- 重新渲染 leads 后，已有标注是否仍然可见、可选中、可删除。
- 自动 R 峰标注与手工标注混合时，ID、删除、统计是否冲突。
- 切换导联、播放窗口或导入新记录后，旧标注是否应该清空或迁移，当前行为是否明确。

通过标准：

- zoom/pan 后添加、选择、删除标注不漂移。
- 导入新记录后没有残留旧病例标注误挂到新信号上。
- `annotation.position` 的坐标定义在文档或类型中明确：画布像素、样本 index，或可换算字段。

### P0-5 GitHub Pages 部署后不能出现本地-only 假成功

审核问题：

- Pages artifact 是否包含 `models/ecg-classifier/model.json` 和 shard。
- 静态路径使用相对 publicPath 后，HashRouter、lazy chunks、model URL 都能在 Pages 子路径加载。
- 部署页面缺少 mock API/Sidecar 时，UI 是否优雅降级并展示 demo 边界。
- CI quality job 是否在 PR 和 push 都跑 lint/typecheck/unit/backend，deploy 是否只在 main push。

通过标准：

- `npm run build` 后本地打开 `dist/index.html` 或静态服务时，lazy chunks 和模型路径不 404。
- GitHub Pages 页面能加载 Dashboard、Case List、Annotation Studio。
- Pages 上的真实模型加载状态、mock 提示、非临床 banner 表达一致。

## 5. P1 收尾检查清单

- UI/e2e 覆盖：新增或完善真实浏览器 smoke，至少覆盖 Dashboard、Case List -> Case Detail/Annotation Studio、加载模型、添加标注、导出。
- 测试不冗余：删除 thin wrapper、自指 mock、与已有测试 100% 重叠的测试。
- Sidecar 边界：非本机部署前确认 CORS、路径校验、鉴权、删除/下载类 API 保护。
- Bundle 预算：保留 `performance.hints: 'error'`，用 `ANALYZE=true npm run build` 观察 TF.js、Antd、ECharts、Firebase chunk。
- 文档一致性：README、AGENTS、CLAUDE、REVIEW、demo-startup 对命令、mock 边界、Node test runner 的描述一致。
- 中文文案与测试断言：检查是否有 mojibake；终端显示乱码不一定是文件损坏，但源文件中的乱码断言应修复。
- 数据安全：确认没有真实病例数据、模型权重、训练缓存、`outputs/` 大文件进入 git。

## 6. 执行顺序

1. 基线确认：`git status --short`，记录当前分支和未提交变更。
2. 静态审计：对照本文件 P0/P1 清单逐项读代码和资源目录。
3. 最小质量门：先跑 `npm run lint`、`npm run typecheck`、`npm run test:unit`。
4. 后端质量门：涉及 sidecar 或训练合同则跑 `npm run test:backend`。
5. 生产构建：跑 `npm run build`，检查 chunk 和模型资源。
6. 浏览器链路：手工或 e2e 覆盖导入、推理、标注、导出、离线缓存。
7. 部署链路：检查 `.github/workflows/deploy-pages.yml`、Pages artifact、线上页面。
8. BUG 处理：P0 必修，P1 按演示风险排序修，P2 只记录不扩大范围。
9. 收尾复核：重跑受影响测试与完整门禁，更新 REVIEW/CHANGELOG 或本文件。

## 7. BUG 修复记录

> 本节按时间倒序记录本轮已修复的 P0/P1 BUG。每条都给出证据路径、最小修复、回归测试与验证命令。

### BUG-2026-07-04-1

### BUG-2026-07-04-1

- Severity: P0
- Area: export / model
- Symptom: 从 Annotation Studio 导出 JSON / CSV 时，`record.diagnosis.label` + `confidence` 字段会把 `ModelService.mockPredict`（std/mean/amplitude 启发式）的输出当作真实模型诊断写入文件；下游消费者无法分辨"真实 TF.js 输出"与"mock fallback"。
- Evidence:
  - `AUDIT-2026-07-04-model-canvas.md` §1.3 R-01（P0）。
  - `src/services/modelService.ts:242-266`（mockPredict）+ `src/pages/AnnotationStudio.tsx:702-704`（修复前直接读 `inferenceResults[0]` 不带 source 标记）。
- Reproduction:
  1. 进入 Annotation Studio（默认 demo 数据，`public/models/ecg-classifier/` 下无 `model.json`）。
  2. 点"加载模型" → 触发 `modelService.isUsingMockInference() === true`。
  3. 点"AI 分析" → `setInferenceResults(mock results)`。
  4. 点"导出 JSON" → 打开文件，`diagnosis` 只有 `{ label, confidence }`，**无 provenance 字段**。
- Expected: 导出文件能区分"真实推理"、"mock fallback"、"未分析（仅 HR 兜底）"。
- Actual: 修复前三种情况在导出文件中不可区分。
- Suspected root cause: `AnnotationStudio.handleExportCurrentRecord` 内联合成 `diagnosis` 时未读 `modelService.isUsingMockInference()`，且 `ECGRecord.diagnosis` 类型无 `source` 字段。
- Smallest safe fix:
  1. 新建纯函数 `src/utils/buildDiagnosis.ts`：`buildDiagnosis({ inferenceResults, isUsingMockInference, heartRate })` → `{ label, confidence, source: 'real' | 'mock' | 'unavailable' }`。
  2. `ECGRecord.diagnosis` 加 optional `source` 字段（向后兼容旧导出）。
  3. `AnnotationStudio` 把内联合成改为调用 `buildDiagnosis(...)`，传入 `modelService.isUsingMockInference()`。
  4. `exportToCSV` 在 `Confidence` 行后追加 `Source,<value>` 行；`source` 缺省时不写。
- Regression test:
  - `src/utils/buildDiagnosis.test.ts` — 6 个分支（real / mock / top-prediction / HR / 未分析 / "空 + mock flag 不能撒谎"）。
  - `src/utils/exportUtils.test.ts` 新增 7 条断言：JSON 透传 `source`（mock / real / unavailable 三种），CSV 写 `Source` 行（mock / real / unavailable 三种），缺省时无 `Source` 行。
- Verification command:
  - `npm run lint` — 0 errors
  - `npm run typecheck` — 0 errors
  - `npm run test:unit` — 104/104 pass（91 → 104，+13）
  - `npm run build` — webpack compiled successfully，main entry 1.5 MiB，无 size 警告
- Owner/status: Mavis / ✅ 已修复（commit `10df188`）

### BUG-2026-07-04-2

- Severity: P0
- Area: model / canvas
- Symptom: Annotation Studio 的 SignalMetrics 卡片（"AI 诊断结果"）渲染推理结果时**不带 MOCK 来源标识**——`modelService.isUsingMockInference() === true` 时的结果与真实模型结果视觉完全一致；唯一的提示是加载时的一次 message.warning toast，几秒后消失，用户后续切回 SignalMetrics 看不到任何"这是 mock"的标记。
- Evidence:
  - `AUDIT-2026-07-04-model-canvas.md` §1.3 R-02（P0）。
  - `src/pages/components/SignalMetrics.tsx:65-85` 修复前：Card `extra` 只有 `<Tag color="magenta">Results</Tag>`，无 mock 状态判断。
  - `src/pages/AnnotationStudio.tsx:583-598` 修复前：mock 提示只在 `handleModelLoad` 里 `message.warning` 一次性弹，30s 后即逝。
- Reproduction:
  1. 进入 Annotation Studio（默认 demo 数据，`public/models/ecg-classifier/` 下无 `model.json`）。
  2. 点"加载模型" → 弹"未找到真实模型，已切换到模拟推理模式"。
  3. 点"AI 分析" → `setInferenceResults(mock results)`。
  4. 等几秒 toast 消失，再切到 SignalMetrics / SmartAssistancePanel → 用户看到的是 "AI 诊断结果" 卡片下的 `<Tag color="red">房颤</Tag>` + `Progress 92%`，**没有任何"模拟推理"的字样**。
- Expected: mock 推理结果在 UI 上有**持久**的、不可被忽略的来源标识（MOCK chip 之类）。
- Actual: 修复前仅依赖一次性 toast，无持久标记。
- Suspected root cause: SignalMetrics 渲染路径不感知 `modelService.isUsingMockInference()`；mock 状态只在 `handleModelLoad` 一次性 toast 时被消费。
- Smallest safe fix:
  1. `SignalMetrics` 加 optional prop `isUsingMockInference?: boolean`，默认 `false`（向后兼容）。
  2. 当 `isUsingMockInference === true` 时，Card `extra` 区域在原 "Results" tag 旁加一个橙色 `MOCK` Tag，并用 `data-testid="mock-inference-chip"` 暴露给测试。
  3. `AnnotationStudio` 渲染时传入 `modelService.isUsingMockInference()`。
- Regression test: `src/pages/components/SignalMetrics.test.tsx` — 5 个断言：
  - prop=true → MOCK chip 存在且文本为 "MOCK"；
  - prop=false → MOCK chip 缺席；
  - prop 缺省 → MOCK chip 缺席（默认 false，向后兼容）；
  - prop=true 时推理结果列表（className + Progress）照常渲染；
  - prop=true 时原有 "Results" tag 不被吞。
- Verification command:
  - `npm run lint` — 0 errors
  - `npm run typecheck` — 0 errors
  - `npm run test:unit -- --test-name-pattern="SignalMetrics"` — 5/5 pass
  - `npm run test:unit` — 109/109 pass（104 → 109，+5）
  - `npm run build` — webpack compiled successfully，无 size 警告
- Owner/status: Mavis / ✅ 已修复（commit `180be1e`）

## 7.1 BUG 记录模板（参考）

```md
### BUG-YYYYMMDD-N

- Severity: P0/P1/P2
- Area: model / offline / canvas / export / sidecar / deploy / docs
- Symptom:
- Evidence:
- Reproduction:
- Expected:
- Actual:
- Suspected root cause:
- Smallest safe fix:
- Regression test:
- Verification command:
- Owner/status:
```

## 8. 可直接使用的操作提示词

### Prompt A: 项目现状与风险地图

```text
你是 ECG 标注平台的审核代理。请在 D:\VS vibe coding files\ecg-annotation-platform 中工作，先阅读 AGENTS.md、README.md、REVIEW.md、package.json、.github/workflows/deploy-pages.yml，以及 src/services/modelService.ts、src/hooks/useModelInference.ts、src/workers/inference.worker.ts、src/pages/AnnotationStudio.tsx、src/components/Canvas/ECGCanvas.tsx。

目标：基于第一性原理输出一份风险地图，只列真实证据支持的结论。请特别区分真实模型能力、缓存能力、mock fallback、demo data、轻量 parser。每个风险写明 severity、证据路径、复现方式、建议验证命令。不要改代码。
```

### Prompt B: 端侧 TF.js 模型与离线缓存审核

```text
请专门审核端侧推理链路：TensorFlow.js 模型加载、IndexedDB 缓存、Worker 推理、断网推理、mock fallback。

第一性原理通过标准：首次在线加载真实模型后，断网刷新仍能用缓存模型推理；不能用 mock fallback 证明离线能力。请检查 public/models/ecg-classifier 是否有 model.json 和权重 shard，检查 modelService、useModelInference、inference.worker 的行为差异，并提出最小修复方案和测试方案。

输出格式：P0 BUG 列表、需要补的测试、手工浏览器验证步骤、最终推荐修复顺序。只有在发现明确 BUG 且修复范围小的时候才改代码；否则先给审核报告。
```

### Prompt C: Canvas PQRST 标注链路审核

```text
请审核 Annotation Studio 的 Canvas 标注链路，重点是 Fabric.js 渲染、P/Q/R/S/T/ST/U 标注添加、zoom/pan 后坐标稳定、删除选中标注、自动 R 峰标注、导入新记录后的标注生命周期、导出 JSON/CSV 一致性。

请先用代码证据说明当前坐标定义是什么，再给出复现步骤。若发现 BUG，请按“最小可验证修复”修改，并补回归测试或手工验证脚本。验证至少包含 npm run test:unit 和 npm run build；如果只改文档，请改用 git diff --check。
```

### Prompt D: 端到端推理 + 标注回归验证

```text
请为“导入 ECG 样例 -> 加载模型 -> 运行分析 -> 添加 PQRST 标注 -> 删除一个标注 -> 导出 JSON/CSV”的链路设计并实施一轮回归验证。

优先使用仓库现有测试栈，不引入新框架，除非现有栈无法覆盖浏览器行为。若需要引入 Playwright 或其他依赖，请先说明理由和替代方案。测试必须避免自指 mock，断言用户可见结果和导出数据。完成后运行相关最小测试和 npm run build。
```

### Prompt E: GitHub Pages 与 CI 收尾审核

```text
请审核 GitHub Pages 自动部署链路。检查 .github/workflows/deploy-pages.yml 是否监听 main，PR/push 是否跑 lint、typecheck、unit、backend、build，deploy 是否只在 main push。检查 webpack publicPath、HashRouter、lazy chunks、dist artifact、模型资源路径是否适配 Pages 子路径。

请输出：发现的问题、文件证据、是否需要修改 workflow/webpack/README、验证命令。不要改动业务代码，除非部署链路存在明确 P0 阻断。
```

### Prompt F: P0 BUG 修复循环

```text
请从 docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md 中选择尚未解决的 P0 项，按一个 BUG 一个提交粒度处理。

流程：复现 BUG -> 写或定位回归测试 -> 最小修复 -> 跑相关最小测试 -> 跑 npm run build -> 更新 BUG 记录。不要扩大重构，不要把 mock fallback 当成修复。每个 BUG 输出证据路径、测试命令和结果。
```

### Prompt G: 交付前最终复核

```text
请做交付前最终复核。先检查 git status，确认没有真实病例数据、模型权重、训练缓存、outputs 大文件被误加入。然后跑 npm run check 和 npm run test:backend。若演示环境已启动，再跑 npm run preflight:demo -- --live。

最后输出收尾报告：通过的命令、失败的命令、未验证项、已知风险、是否可以进入 PR/merge/deploy。没有新鲜命令证据时，不要声称通过。
```

### Prompt H: 文档一致性与演示话术审核

```text
请审核 README.md、AGENTS.md、CLAUDE.md、REVIEW.md、docs/demo-startup.md 与本轮 BUG 审核文档是否一致。重点检查：命令是否与 package.json 一致，模型真实/模拟边界是否清楚，非临床 preview 是否可见，GitHub Pages 部署描述是否仍准确，中文文案是否存在源文件级 mojibake。

只修文档，不改业务逻辑。完成后运行 git diff --check，并列出修改过的文件。
```

## 9. Definition of Done

本轮收尾可被认为完成，必须同时满足：

- 所有 P0 项有明确结论：已修复、已验证无问题，或记录为阻断风险。
- 至少跑过 `npm run check` 和 `npm run test:backend`，或明确说明为什么本轮只做文档且未跑全量。
- 推理/标注/导出链路有浏览器证据或自动化测试证据。
- 离线推理证明来自真实缓存模型，不来自 mock fallback。
- Pages workflow 和 artifact 路径经 build 或线上页面验证。
- 文档更新包含已知风险，不把 demo 能力包装成生产/临床能力。
