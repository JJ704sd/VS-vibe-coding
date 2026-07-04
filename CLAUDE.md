# CLAUDE.md

> Claude Code 项目级指令 · 适用:本仓库 · 最近更新:2026-07-04

## 你是谁 + 干什么

你是 Claude Code,在这套 ECG 标注/训练平台上工作。你负责:

- 阅读/修改前端(React + TypeScript)和后端(Python FastAPI sidecar)
- 跨子系统协作:标注工作台 + 训练平台 + Assistant(Memory/RAG)
- 保持代码与文档一致,遵循既有约定
- 简单任务直接动手,复杂任务走计划-执行闭环

## 任务路由 — 什么情况下怎么干

| 任务类型 | 做法 |
|---------|------|
| 单文件 bug 修复 / 单文件小改 | 自己干 |
| 改前端样式 / 加组件 / 改单测 | 自己干 |
| 改后端 API + 测试 | 自己干 + 跑 `npm run check` + `npm run test:backend` |
| 跨多文件的 feature 实现 | 自己干,但用 TodoWrite 跟踪 |
| 验证 / 审查已有交付 | spawn `verifier` 单次 worker |
| 并行多个独立调查 | dispatch 并行 `explore` agents |
| 大段遗留 / 重构 | 加载 `superpowers:executing-plans` 走计划-执行闭环 |
| 模糊多解的任务 | 加载 `plan-mode` 先讨论,不要直接动手 |
| 涉及 ECGFounder 外部仓改动 | 必须单独分支、单独 PR(见 AGENTS.md §提交与 PR 规范) |

## 必跑命令清单(改完跑这些)

```bash
# 前端改动
npm run lint                      # ESLint
npm run typecheck                 # 主项目 + 测试 TS
npm run test:unit                 # 前端单测(Node test runner)
npm run build                     # 生产构建,验证 bundle 可行

# 后端改动
cd proxy-server && python -m pytest tests/ -v

# 一键全检(本地)
npm run check                     # lint + typecheck + 单测 + build

# 一键全检(含后端)
npm run check && npm run test:backend

# Demo 端口 / Sidecar / runner 健康检查
npm run preflight:demo -- --live
```

## 项目速览

ECG 心电图标注与分析平台,支持 JSON / DICOM / HL7 / WFDB 导入,人工标注 + AI 辅助分析 + 导出。

- **前端**: React 18 + TypeScript + Redux Toolkit + Ant Design + Fabric.js + TensorFlow.js
- **后端**: Python FastAPI sidecar(`proxy-server/`,端口 6090)
- **构建**: Webpack(dev: `webpack.config.dev.js` / prod: `webpack.config.js`)
- **模板**: `templates/app.html`(不是 `public/`)

## 架构约束(决策硬规则)

- **数据模型**: `Patient -> ECGRecord[] -> ECGLead[] + Annotation[] + ModelPrediction[]`
- **状态切片**: `ecgSlice`(标注/画布/模型)+ `caseSlice`(患者/记录)
- **Services**: 单例模式,失败回退 mock
- **路由**: 所有页面 `React.lazy()` + `Suspense`
- **不可序列化**: `inferenceResults` 含 TF tensor,排除 Redux 序列化
- **Canvas**: Fabric.js,ref 初始化,不与 React 状态绑定
- **路径别名**: `@`, `@components` 等(见 `tsconfig.json`)

## 关键子系统

### 标注工作台(AnnotationStudio)

URL 参数 `?patientId=&recordId=` 驱动上下文。

- **状态**: `currentPatientId`, `currentRecordId`, `leads`, `annotations`, `inferenceResults`, `wfdbBatches`
- **导出**: `exportRecord()` 支持 JSON/CSV,带 metadata + annotations + diagnosis

### 训练平台(TrainingDashboard)

前端 SSE + REST → proxy-server → Python 训练调度(`ECGFounder/`,绝对路径由 `ECGFOUNDER_BASE` 指向)

**`outputs/` 目录结构**:

| 子目录 | 数据集 | 文件 |
|--------|--------|------|
| `round_N/` | MIT-BIH | `train_*.log`, `result.json`, `test_evaluation_*.json`, `param_history.json` |
| `cpsc2018_*/` | CPSC2018 | `history_*.csv`, `best_*.pth`(无日志/评估) |

**关键路径**:

| 文件 | 用途 |
|------|------|
| `outputs/round_N/train_*.log` | MIT-BIH 训练日志 |
| `outputs/round_N/result.json` | MIT-BIH 最佳指标 |
| `outputs/cpsc2018_*/history_*.csv` | CPSC2018 训练历史(备用数据源) |
| `outputs/*/best_*.pth` | 最佳模型权重(通配匹配 MIT-BIH 和 CPSC2018) |
| `outputs/round_N/param_history.json` | 逐 epoch 参数统计 |
| `shared_state.json` | 实时训练状态 |
| `param_stats.json` | 当前参数统计 |
| `train_task.json` | 任务队列 |

**训练状态流**: `POST /api/training/task` → 写 `train_task.json` → `finetune_runner.py` 轮询 → 启动训练 → 每 2s 解析日志更新 `shared_state.json` → `param_observer.py` 检测新 epoch → 写 `param_stats.json` → SSE 推送前端。

**性能优化**: SSE 在 idle/done 状态下降为 30s 轮询(训练中 2s);`param_observer` 同一 epoch 只加载一次 checkpoint(避免重复加载 100MB+ 模型)。

**前端默认值**: epochs=5, batch_size=16(已调低以减轻计算压力)。
**GPU OOM 调整**: `BATCH_SIZE=16`(默认 64), `MAX_PER_CLASS=400`

### Assistant(Memory + RAG)

v1 本地 JSON + 关键词/TF-IDF 搜索,无外部 LLM/Qdrant/Neo4j。

- **后端**: `proxy-server/assistant/`(text_index, memory_store, rag_store, service)
- **前端**: `src/services/ecgAssistantApi.ts` + SmartAssistancePanel
- **API**:
  - `POST /api/assistant/knowledge/rebuild` — 重建知识库索引
  - `POST /api/assistant/memory/case` — 记录病例上下文
  - `POST /api/assistant/ask` — 提问(memory-first 或 knowledge-first)
- **安全约束**: UI 用"辅助/参考/上下文检索",**不**输出"诊断结论",答案必须暴露 sources。

## 调试速查(常见坑)

| 现象 | 排查方向 |
|------|----------|
| 前端改 env 变量不生效 | webpack 编译期替换 → 必须重启 `npm run dev:web` |
| 后端 API 404 | `proxy-server` 改路由后必须**重启 uvicorn** |
| ESLint 报新错 | 跑 `npm run lint -- --fix`;**不允许**引入新错 |
| 训练 SSE 不推送 | 检查 `finetune_runner.py` / `param_observer.py` 进程在不在 |
| 标注画布空白 | Fabric.js ref 是否初始化(不要绑 React state) |
| `outputs/` 文件找不到 | 通配模式 `round_N/` / `cpsc2018_*/`,核对实际目录命名 |
| Windows 上 webpack 输出清理失败 | 故意保守处理,**不要**试图修复 |
| `process.env.X` 单测里 undefined | `src/config/env.ts` 的 `fromEnv` 第二个参数兜底 |
| `.env` 缺失启动报错 | 不应报错,`env.ts` 已兜底;若还报错查 webpack `DefinePlugin` 配置 |
| PowerShell 命令挂起 | 不要 `&&`,用 `;` 或 `if ($?) { ... }` |
| GitHub push SSL 抖动 | bash `git push` timeout 设 ≥300s,失败重试 1 次 |

## 工作流约定

- **多步任务**: 用 TodoWrite 跟踪,不要口头规划
- **复杂决策**: 加载 `plan-mode` skill,先讨论再动手
- **跨多轮状态保持**: 复杂多步任务用 `.planning/<topic>/{task_plan.md, progress.md, findings.md}` 跟踪
- **每轮独立验证 + 清理冗余测试**: 每完成一轮必跑全量 `npm run check` + `npm run test:backend`,审视新增测试,删除冗余(thin wrapper / mock 自指 / 与其他文件 100% 重叠),单独 commit 清理动作

## 开发注意事项

- `proxy-server` 修改路由后必须重启 uvicorn
- webpack 输出清理在 Windows 上保守处理,不要试图修复
- 避免引入新的 lint 错误
- 多步骤工作用 `.planning/` 目录记录
- **不要**提交真实病例数据、模型权重、训练缓存或 `outputs/` 大文件
- Sidecar 暴露本地训练和 checkpoint 能力,部署到非本机前需限制 CORS、校验路径、增加鉴权

## 环境变量与运行配置

**唯一配置源**: `src/config/env.ts` — 用 `fromEnv(name, fallback)` 读取 + 兜底值,保证 `.env` 缺失时仍能跑。

**机制**:

1. `src/config/env.ts` 用 `fromEnv(name, fallback)` 暴露常量
2. webpack `DefinePlugin` 把 `process.env.X` 替换成编译期字面量
3. dev 配 `dotenv-webpack` 读仓库根 `.env`;prod 只读 shell 环境(`path: false`, `systemvars: true`)
4. `ANALYZE=true` 时启用 `webpack-bundle-analyzer` → 产出 `dist/bundle-report.html`

**关键变量**:

| 变量 | 默认值 | 用途 |
|------|--------|------|
| `CLINIC_API_BASE_URL` | `http://localhost:4000/api` | `clinicApi.ts` 病例/仪表盘后端 |
| `TRAINING_API_BASE_URL` | `http://localhost:6090` | `trainingApi.ts` 训练调度后端 |
| `ASSISTANT_API_BASE_URL` | `http://localhost:6090` | `ecgAssistantApi.ts` 助手/RAG 后端 |
| `ANALYZE` | `false` | 启用 bundle-analyzer |
| `REACT_APP_FIREBASE_*` | — | `firebaseService.ts` Firebase 初始化 |
| `REACT_APP_MINIMAX_API_ENDPOINT` | `https://api.minimax.chat` | Minimax 直连(生产请走后端代理) |

**新增端点**:

1. `src/config/env.ts` 加 `fromEnv('NEW_X', 'fallback')` 并 export
2. 两个 webpack 配置 `DefinePlugin` 加 `'process.env.NEW_X': JSON.stringify(process.env.NEW_X)`
3. `.env.example` 同步补一行
4. service `import { NEW_X } from '../config/env'`,**不要**直接 `process.env.NEW_X || ...`

**临时覆盖**(不写文件):

```bash
# Windows PowerShell
$env:CLINIC_API_BASE_URL='http://staging.example/api'; npm run build

# 跨平台
npx cross-env CLINIC_API_BASE_URL=http://staging.example/api npm run build
```

**验证 bundle 内联**:

```bash
cross-env CLINIC_API_BASE_URL=http://example.test npm run build
grep -r "example.test" dist
```

## 必读文档

- `AGENTS.md` — 通用 AI 代理 / 贡献规范(PR / 命名 / 安全 / 编码风格)
- `SPEC.md` — 项目规格
- `docs/superpowers/specs/` — 各子模块详细设计
- `docs/superpowers/plans/` — 历史实施计划
- `.planning/` — 当前活跃的多步任务跟踪
- `CHANGELOG.md` — 变更记录
- `README.md` — 仓库入口