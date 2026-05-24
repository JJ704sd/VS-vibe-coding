# ECG Annotation Platform Review

日期：2026-05-24
最后更新：2026-05-24

## 结论

当前项目处于“可本地运行、可构建、可验证”的 demo / 工作流验证阶段。前端 lint、TypeScript 类型检查、前端单测、后端 pytest 和生产构建均已通过；核心功能面覆盖了病例浏览、心电标注、模型推理演示、训练状态看板和本地助手。

最新整理已按中文 spec 完成第一阶段 Agent 功能增强：病例风险分析接口、训练决策字段、历史 checkpoint 推荐方向、前端 API 类型和三个 Agent 面板展示。主要风险不在编译正确性，而在交付可重复性、运行环境耦合、mock / 轻量解析边界、CI 配置、UI 工作流测试和生产化安全边界。

## 仓库状态

- 仓库路径：`D:\VS vibe coding files\ecg-annotation-platform`
- 当前分支：`codex/continue-ecg-hardening`
- 本地 HEAD：`7411862 feat: show agent decision summaries`
- 远端同步点：`306aa7c docs: add planning records and lockfile`
- 当前状态：本地分支领先远端 7 个提交，包含中文 Agent 设计、实施计划和第一阶段实现，尚待推送。
- 本次检查前未发现已有 `review` / `REVIEW` 文档；因此新增本文件。
- 首轮检查时没有已修改的 tracked 文件。
- 本轮整理将项目演进文档和 npm lockfile 纳入版本控制：
  - `package-lock.json`
  - `docs/superpowers/plans/2026-04-28-ecgfounder-training-visualization-plan.md`
  - `docs/superpowers/plans/2026-05-11-history-training-agent.md`
  - `docs/superpowers/plans/2026-05-11-lightweight-ecg-assistant.md`
  - `docs/superpowers/plans/2026-05-11-training-agent-panel.md`
  - `docs/superpowers/plans/2026-05-11-training-dashboard-dataset-grouping.md`
  - `docs/superpowers/plans/2026-05-11-training-output-sync.md`
  - `docs/superpowers/specs/2026-04-28-ecgfounder-training-visualization-design.md`

## 最新整理

- 已新增中文设计规格：`docs/superpowers/specs/2026-05-24-case-and-training-agent-enhancements-design.md`。
- 已新增实施计划：`docs/superpowers/plans/2026-05-24-case-training-agent-enhancements.md`。
- 设计方向分为两条独立增强线：
  - 病例标注 Agent：病例风险概览、标注完整性、AI 结果可信度、信号质量提示。
  - 训练决策 Agent：当前训练状态决策、历史 round/checkpoint 推荐、异常训练记录识别、下一轮训练建议。
- 设计约束明确为只读辅助：不自动修改标注、不启动/停止训练、不删除历史、不操作 checkpoint。
- 已完成第一阶段实现：
  - 后端新增 `assistant.case_analysis` 确定性病例风险分析规则。
  - 后端新增 `POST /api/assistant/case/analyze` 只读分析接口。
  - 后端训练诊断新增 `decision`、`warnings` 和 `recommendedCheckpointDirection`。
  - 前端新增 `analyzeAssistantCase()`、病例分析类型和训练诊断扩展类型。
  - `SmartAssistancePanel` 可生成病例风险概览；`TrainingAgentPanel` 显示决策摘要与风险提示；`HistoryTrainingAgentPanel` 显示推荐 checkpoint 方向。
- 设计和 review 文档均保持中文，便于项目交接和后续实现。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run check` | 通过，包含 lint、typecheck、14/14 前端单测和 production build |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run test:backend` | 通过，26/26 pytest |

构建输出提示主入口约 `2.95 MiB`，webpack performance hints 当前关闭。

## 架构快照

- 前端：React 18 + TypeScript + Redux Toolkit + Ant Design + Fabric.js + TensorFlow.js。
- 路由：`HashRouter`，页面通过 `React.lazy()` 懒加载。
- 本地 mock API：`mock-api/server.js`，默认端口 `4000`，读写 `mock-api/database.json`。
- 训练/助手 sidecar：`proxy-server/main.py`，FastAPI，默认端口 `6090`。
- 训练状态：通过 `ECGFOUNDER_BASE` 指向外部 ECGFounder 目录，默认 `D:/ECG founder/ECGFounder`。
- 测试：前端使用 Node 内置 test runner；后端使用 pytest。

## 做得好的地方

- `strict: true` 已启用，lint/typecheck/build 当前都能过。
- 前端页面边界比较清晰，主要页面、服务、store、utils 分层明确。
- 关键服务已有单测：HTTP client、offline queue、assistant API、training API，其中包含病例风险分析 API 和历史 checkpoint 推荐 fallback。
- 后端 parser、assistant memory/RAG、case analysis、training diagnostics 有 pytest 覆盖。
- 已有中文 Agent 增强设计，明确了病例标注 Agent 和训练决策 Agent 的后端规则、前端展示、安全边界和测试范围。
- 本地 mock 和 fallback 数据让主要 UI 在缺少后端时仍可演示。
- Webpack 已做 route lazy loading、vendor/TensorFlow 分包和 Windows 保守清理。

## 主要风险

1. CI / 部署触发分支需要先修。
   `.github/workflows/deploy-pages.yml` 只监听 `codex/optimize-bundle-and-lint`，当前工作分支是 `codex/continue-ecg-hardening`。本轮已补充 `package-lock.json`，但 workflow 触发分支仍需按实际发布分支调整。

2. 运行端点仍然硬编码。
   `src/services/clinicApi.ts` 写死 `http://localhost:4000/api`，`src/services/trainingApi.ts` 和 `src/services/ecgAssistantApi.ts` 写死 `http://localhost:6090`。这适合本地 demo，但不适合 GitHub Pages、局域网部署或多环境配置。

3. 产品边界仍是 demo / workflow validation。
   README 已说明部分页面仍用 mock 数据，DICOM / HL7 / WFDB parser 是轻量实现。`modelService` 在模型不可用时会进入 mock inference。进入临床或严肃分析场景前，需要明确标注非诊断用途、真实数据接入路径和解析准确性边界。

4. sidecar 安全边界偏本地开发。
   FastAPI CORS 为 `allow_origins=["*"]`，并暴露训练任务、历史删除、checkpoint 下载等本地文件相关操作。若服务绑定到非本机或被浏览器页面跨域访问，需要增加 origin 限制、鉴权、路径校验和操作确认。

5. 测试覆盖偏服务层，缺少关键 UI / 工作流验证。
   当前新增 Agent 后端规则和前端 API 已有测试，但前端单测仍集中在服务函数，尚未覆盖 Annotation Studio canvas 交互、病例列表/详情 CRUD、训练 SSE 连接、助手面板渲染和导入/导出端到端流程。

6. bundle 大小需要建立预算。
   生产构建通过，但主入口约 `2.95 MiB`，且 performance hints 关闭。TensorFlow.js、Ant Design 和图表库容易继续推高首屏成本，建议引入 bundle analyzer 和明确体积预算。

7. 文档有轻微漂移。
   `CLAUDE.md` 仍写“Jest”，但 `package.json` 实际使用 Node 内置 test runner。建议同步 README / AGENTS / CLAUDE 中的测试说明。

## 建议下一步

1. 处理仓库交付面：更新 GitHub Pages workflow 的触发分支，并让 CI 至少运行 `lint`、`typecheck`、`test:unit`、`test:backend`、`build`。
2. 抽出运行配置：统一 API base URL、mock API 端口、sidecar 端口和 `ECGFOUNDER_BASE`，通过 `.env` 或运行时 config 注入。
3. 给核心 UI 增加 smoke / e2e 测试：至少覆盖 dashboard 加载、病例进入标注页、导入样例、添加标注、导出、训练看板和 Agent 面板只读加载。
4. 加固 sidecar：限制 CORS、补充 checkpoint 下载路径校验、对删除类接口加保护，并确认服务只绑定本地或有明确鉴权。
5. 建立 bundle 预算：分析 webpack 输出，确认 TensorFlow、Ant Design、ECharts 是否只在需要页面加载。
6. 明确 demo 与生产边界：在 UI 和文档里区分 mock inference、轻量 parser、真实模型/真实数据路径。
