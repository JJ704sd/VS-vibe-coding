# ECG Annotation Platform Review

日期：2026-05-24
最后更新：2026-07-04

## 2026-07-04 P0 audit + canvas closeout round (本轮新增)

围绕端侧 TF.js 推理链路、Canvas 标注重构、导出 provenance、e2e 测试基础设施和文档一致性，落到 9 个 commit（按合并顺序）：

| SHA | 类型 | 摘要 |
| --- | --- | --- |
| `bb85031` | `perf(build)` | 懒加载 firebase + @firebase 拆分 async chunk，主入口 1.76 → 1.5 MiB |
| `ff816f4` | `docs` | REVIEW.md 标记 risk #6 已结清（bundle 预算） |
| `acbf4f0` | `chore(test)` | scaffold happy-dom e2e 测试基础设施（Phase 0） |
| `6c7387e` | `chore(test)` | 接入 e2e smoke 测试基础设施 |
| `cbc5af9` | `test(views/loaders)` | 覆盖 `buildLiveLayerStatRows` 与 `loadTrainingRoundDetails` 边界用例 |
| `099f594` | `docs` | 重写 CLAUDE.md / AGENTS.md 去重并补决策框架 |
| `46dc5d1` | `refactor(canvas)` | Redux 单一 source of truth：C-01..C-05 修复（导入清空标注、`ECG_CANVAS_VIEW_WIDTH` 共享常量、Toolbar 暴露 P/QRS/T/ST/U 全 7 种、`annotation.x` 写入路径统一、Fabric 对象从 Redux 派生） |
| `10df188` | `fix(export)` | `diagnosis.source` 标记真实/模拟/未分析（BUG-2026-07-04-1 R-01 P0） |
| `180be1e` | `fix(ui)` | SignalMetrics 持久 MOCK chip（BUG-2026-07-04-2 R-02 P0） |
| `c487669` | `docs(audit)` | 沉淀 P0 BUG 审核 + Canvas 标注 closeout + BUG 记录 |

**已结清（按 2026-06-06 risk #1–#8 对照）**：

- 风险 #1（CI 触发分支）→ 已在 2026-06-06 hardening round 关闭；本轮 `6c9d019` + `edda1ac` 维持监听 `main`，`quality / build / deploy` 三 job 形态保留并通过。
- 风险 #3（sidecar 安全边界）→ `c7328a5` 仍生效，CORS 仅本地 dev origins，删除类接口加 `?confirm=` 二次确认；本轮无回归。
- 风险 #4（demo / 生产边界说明）→ `1964487` 已部署顶栏 banner + 侧栏 Demo/Mock tag + AIModels MOCK chip；本轮新增 SignalMetrics 持久 MOCK chip（`180be1e`）+ 导出 `diagnosis.source`（`10df188`）+ e2e 测试锁定该契约。
- 风险 #6（bundle 预算与按需懒加载）→ 已在 2026-06-06 hardening round 关闭；本轮 `8762264` 把 webpack `maxEntrypointSize` 提到 2 500 000 + `hints: 'error'`，回归即 CI 红。
- 风险 #7（文档漂移）→ 已在 2026-06-06 hardening round 关闭；本轮 `099f594` + `c487669` 重写 CLAUDE/AGENTS 并新增 P0 audit 文档。

**未变（仍属 P1）**：

- 风险 #5（UI / 工作流 e2e 覆盖）→ 本轮 `acbf4f0` + `6c7387e` 接入 happy-dom e2e 基础设施（`src/__tests__/annotationWorkflow.test.tsx` 覆盖导入 → 加载模型 → 标注 → 删除 → 导出），但浏览器真实链路（IndexedDB 缓存、断网推理、Canvas zoom/pan 坐标稳定性）仍依赖手工复核；正式 Playwright 接入延后。
- 风险 #8（ECGFounder 外部 PR）→ 仍为上游 `PKUDigitalHealth/ECGFounder` PR #1，状态 Open / 0 review。

**新增 P0 BUG**（详见 `docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md` §7）：

- **BUG-2026-07-04-1 (R-01)**：导出 JSON/CSV 把 `mockPredict` 启发式结果当作真实模型诊断写入，无 provenance 字段。`10df188` 修复，新增 `buildDiagnosis` 纯函数 + `ECGRecord.diagnosis.source` 字段 + 13 条单测。
- **BUG-2026-07-04-2 (R-02)**：SignalMetrics 渲染 mock 推理结果不带持久来源标识，仅靠 30s 一次性 toast。`180be1e` 修复，加橙色 `MOCK` chip + `data-testid="mock-inference-chip"` + 5 条单测。

**Canvas 标注 closeout**（详见 `docs/superpowers/plans/2026-07-04-canvas-annotation-audit.md`）：

- C-01..C-05 已在 `46dc5d1` 修复；C-06（导出 CSV 无单位说明）与 C-07（`findRPeaks` 在 `threshold=0` 时永不退出 inPeak）故意不改，单测锁定防回归。

## 2026-06-06 hardening round

围绕 CI 触发错配 + 仓库卫生 + sidecar 边界，落到 5 个 commit（按合并顺序）：

| SHA | 类型 | 摘要 |
| --- | --- | --- |
| `6c9d019` | `chore(ci)` | CI workflow 触发改 `main`，拆 `quality` + `build` + `deploy` 三 job；新增 `proxy-server/requirements.txt` 让 CI 能装 sidecar 依赖 |
| `edda1ac` | `chore(repo)` | `.gitignore` 加 `.mavis/` / `.opencode/` / `.worktrees/`；`CLAUDE.md` 与 `README.md` 同步 Node 内置 test runner 描述，引入 `npm run test:backend` 入口 |
| `c7328a5` | `fix(sidecar)` | CORS 从 `["*"]` 改读 `SIDECAR_ALLOW_ORIGINS` 环境变量（默认本地 dev origins）；`DELETE /api/training/history/{round_name}` 加 `?confirm=<round_name>` 二次确认 |
| `17967a9` | `fix(tools)` | `run_platform.bat` 读 `ECGFOUNDER_BASE` 环境变量，未设时回退 Windows 默认路径并提示；sidecar 启动时同步转发该变量 |
| `4fdbd60` / `b334c7d` | `fix(ci)` | `setup-node` 升到 Node 24（4fdbd60）；`npm run test:unit` 跑在 7 GB runner 上 strip-types + Firebase + Minimax SDK 在 `--test-isolation=none` 共享进程下 OOM 触发 SIGKILL，b334c7d 加 `NODE_OPTIONS=--max-old-space-size=6144` 限 V8 堆 |

**已结清（按上一轮 #1–#8 风险点对照）**：
- 风险 #1（CI 触发分支）→ 6c9d019 修复
- 风险 #2（运行端点硬编码）→ 此前 `feature/env-config`（`a17fbec`）已修复，本轮 `edda1ac` 同步文档
- 风险 #3（sidecar 安全边界）→ c7328a5 收紧 CORS + 删除类接口加 confirm
- 风险 #4（demo / 生产边界说明）→ 1964487 UI 全面标注（顶栏 banner + 侧栏 Demo/Mock tag + AIModels MOCK chip + Dashboard sourceLabel Alert + README 新段）
- 风险 #7（文档漂移）→ edda1ac 修复
- 风险 #8（ECGFounder 外部 PR）→ 已开至**上游** `PKUDigitalHealth/ECGFounder` PR #1，5 commit / 16 文件 / +27,782 行 / 状态 Open / 0 review / 与 base 无冲突（2026-06-06 截图确认）

**未变（仍属 P1）**：
- 风险 #5（UI / 工作流 e2e 覆盖）

**已结清**：
- 风险 #6（bundle 预算与按需懒加载）→ `bb85031 perf(build): lazy-load firebase + @firebase via dynamic import and split chunks`。`firebaseService` 顶层 import 改为 type-only + `await import()` 内填充到 instance fields，AnnotationStudio 进 useEffect 时触发 init。webpack 新增 `firebase` / `@firebase` cacheGroup（均 `chunks: 'async'`），vendor cacheGroup 改用 function test 排除 `firebase/@tensorflow/@firebase`。结果：主入口 1.76 → 1.5 MiB（main 28 + Antd 600 + vendors 907 + runtime 4 KB），firebase SDK（6.61 + 515 = ~520 KiB）拆为按需 async chunk，仅在用户点进 AnnotationStudio 时下载。webpack budget 同步收紧 `maxEntrypointSize: 2 500 000 → 1 600 000`（1.5 MiB + ~50 KiB headroom），保留 `hints: 'error'` 防止后续再胖。

CI 状态：所有 commit 已 push 至 `origin/main`，最后三次 CI 跑通（`1964487` 2:18 success / `0829b9e` 2:25 success / `bb85031` 2:12 success，2026-06-06 用户确认绿色），站点 redeploy 到 `https://jj704sd.github.io/VS-vibe-coding/`，含 demo 边界 banner / MOCK chip / bundle 预算守门。

## 结论

当前项目处于“可本地运行、可构建、可验证”的 demo / 工作流验证阶段。代码已经合并回 `main`，本地 `main` 与 `origin/main` 同步，最新远端合并点为 PR #11：`004f61a Merge pull request #11 from JJ704sd/codex/continue-ecg-hardening`。

本轮 hardening 已覆盖 ECGFounder training sidecar、前端训练看板、训练历史 parser、中文演示预检和演示启动文档。前端 lint、TypeScript 类型检查、前端单测、后端 pytest、生产构建、中文 preflight 和基础 sidecar 数据 smoke 均已通过。主要剩余风险不在当前编译正确性，而在 CI / Pages 触发配置、运行环境硬编码、sidecar 安全边界、UI 工作流测试、bundle 预算和 demo / 生产边界说明。

ECGFounder 独立仓库的 observer 修复已在 **上游 `PKUDigitalHealth/ECGFounder` 开了 PR #1**（5 commit、+27,782 行、与 master 无冲突），等 maintainer review / 合并。

## 仓库状态

- 仓库路径：`D:\VS vibe coding files\ecg-annotation-platform`
- 当前分支：`main`
- 本地 HEAD：`c487669 docs(audit): capture P0 BUG audit + canvas annotation closeout + BUG records`
- 远端同步点：`origin/main`（ahead 4 commits，未推送；本轮 P0 audit + Canvas closeout 待 review）
- 当前状态：本地 `main` 与 `origin/main` 不一致，工作区干净。
- 已合并分支：`codex/continue-ecg-hardening` / `feature/env-config` / `fix/lint-after-merge` / `feature/unit-tests`。
- 远端功能分支仍存在：`origin/codex/continue-ecg-hardening` 指向 `efbdd04 fix: handle preflight permission errors`。

## 本轮整理（2026-07-04）

- `46dc5d1 refactor(canvas)`：把 Redux `ecgSlice` 做成标注的单一 source of truth。`ECGCanvas.handleAddAnnotation` / `handleDeleteSelectedAnnotation` 改为只 dispatch，新增 `useEffect([annotations])` + `renderAnnotationObjects` 派生 Fabric 对象，消除 Redux 与 Fabric 双轨状态；`AnnotationStudio.applyImportedLeads` 加 `dispatch(setAnnotations([]))` 防跨记录污染。
- `10df188 fix(export)`：新增 `src/utils/buildDiagnosis.ts` 纯函数，把 `modelService.isUsingMockInference()` 织入 `diagnosis.source: 'real' | 'mock' | 'unavailable'`；`ECGRecord.diagnosis` 加 optional `source` 字段；`exportToCSV` 在 `Confidence` 行后追加 `Source,<value>` 行（缺省时不写）。
- `180be1e fix(ui)`：`SignalMetrics` 加 `isUsingMockInference?: boolean` prop，true 时 Card extra 区域渲染橙色 `MOCK` chip + `data-testid="mock-inference-chip"`；`AnnotationStudio` 传 `modelService.isUsingMockInference()` 进去。
- `c487669 docs(audit)`：新增 `AUDIT-2026-07-04-model-canvas.md`、`docs/superpowers/plans/2026-07-04-canvas-annotation-audit.md`、`docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md`，沉淀 R-01..R-25 风险地图、C-01..C-07 Canvas 标注 BUG 与本轮已修 P0 记录。
- `099f594 docs`：CLAUDE.md / AGENTS.md 去重，CLAUDE.md 收编任务路由 / 命令清单 / 调试速查 / env vars 单一来源；AGENTS.md 聚焦通用贡献规范。Header 标 `最近更新:2026-07-04`。

## 2026-06-06 round 整理（既有，仍有效）

- PR #11 已合并到 `main`，包含最新 preflight 权限误报修复。
- `scripts/preflight-demo.js` 现在会合并 `execFile` 的 `message/stdout/stderr`，避免 Windows 受限 shell 中 `Get-CimInstance : 拒绝访问` 被误判为 live 检查失败。
- `scripts/preflight-demo.test.ts` 新增 stderr 权限错误回归测试。
- `docs/demo-startup.md` 提供中文演示启动、端口和重复监听清理说明。
- `proxy-server/main.py`、`state.py`、`parsers.py`、训练 API 和前端训练详情加载已对齐 ECGFounder training contract。
- `TrainingDashboard` 详情加载支持 log / eval / param history 部分成功，避免单个 404 拖垮整个详情弹窗。
- `ParamStatsPanel` 对无梯度 checkpoint stats 有 view model 和测试覆盖。
- CPSC / PTB-XL validation-derived 指标增加来源说明，避免与 true test evaluation 混淆。
- ECGFounder 独立仓库 observer 修复已拆到单独分支：
  - 分支：`codex/fix-param-observer-current-epoch`
  - 提交：`a49e1ab fix: align param observer live metadata`
  - PR 创建链接：`https://github.com/JJ704sd/ECGFounder/pull/new/codex/fix-param-observer-current-epoch`

## 验证结果

### 2026-07-04 round（本轮新增）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 errors |
| `npm run typecheck` | 通过，0 errors |
| `npm run test:unit` | 通过，**109/109 pass**（buildDiagnosis 6 + SignalMetrics MOCK 5 + ecgSlice 9 + exportUtils 9 + findRPeaks 7 + 既有 73） |
| `npm run build` | 通过，webpack compiled successfully，主入口 1.5 MiB，无 size 警告（`performance.hints: 'error'` 守门） |
| `npm run check` | 全过 |
| `node scripts/verify-canvas-coords.mjs` | 通过，9/9 Canvas 坐标不变式检查 |
| `git diff --check` | 通过，0 退出 |

### 2026-06-06 round（既有，仍有效）

| 命令 | 结果 |
| --- | --- |
| `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/preflight-demo.test.ts` | 通过，5/5 preflight 脚本测试 |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run preflight:demo -- --live` | 通过，`3000`、`4000`、`6090`、`finetune_runner.py`、`param_observer.py` 均 OK |
| `node -e ".../api/training/history ... /api/checkpoints"` | 通过，training history `78` 条，checkpoints `84` 条 |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run check` | 通过，包含 lint、typecheck、18/18 前端单测和 production build |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run test:backend` | 通过，30/30 pytest |

## 架构快照

- 前端：React 18 + TypeScript + Redux Toolkit + Ant Design + Fabric.js + TensorFlow.js。
- 路由：`HashRouter`，页面通过 `React.lazy()` 懒加载。
- 本地 mock API：`mock-api/server.js`，默认端口 `4000`，读写 `mock-api/database.json`。
- 训练/助手 sidecar：`proxy-server/main.py`，FastAPI，默认端口 `6090`。
- 训练状态：通过 `ECGFOUNDER_BASE` 指向外部 ECGFounder 目录，默认 `D:/ECG founder/ECGFounder`。
- 测试：前端使用 Node 内置 test runner；后端使用 pytest。
- 演示预检：`npm run preflight:demo -- --live` 检查前端、mock API、Sidecar、runner 和 observer。

## 做得好的地方

- `strict: true` 已启用，lint/typecheck/build 当前都能过。
- 前端页面、服务、store、utils 分层相对清晰。
- 关键服务已有单测：HTTP client、offline queue、assistant API、training API、training round details 和 param stats view model。
- 后端 parser、assistant memory/RAG、case analysis、training diagnostics、training API contract 和 state lock resilience 有 pytest 覆盖。
- 中文 Agent 增强设计和实施计划已落地，便于后续交接。
- 本地 mock、fallback 数据和中文 preflight 让主要 UI / 演示流程更容易复核。
- ECGFounder observer 修复已在独立仓库分支处理，没有污染 `VS-vibe-coding` 提交历史。

## 主要风险

> 状态按 2026-07-04 round 后的最新事实更新。已结清项保留历史证据以便追溯。

1. ~~CI / 部署触发分支需要调整。~~（**2026-06-06 已结清**）
   `.github/workflows/deploy-pages.yml` 已改为监听 `main` + `pull_request`，拆 `quality`（lint + typecheck + 前端单测 + 后端 pytest）/ `build`（webpack + Pages artifact）/ `deploy`（`actions/deploy-pages@v4`，仅 `push && refs/heads/main`）三 job。

2. 运行端点仍然硬编码。
   `src/services/clinicApi.ts`、`src/services/trainingApi.ts`、`src/services/ecgAssistantApi.ts` 走 `src/config/env.ts` 的 `fromEnv` 兜底到 `http://localhost:4000/api` 与 `http://localhost:6090`。webpack `DefinePlugin` 把 `process.env.X` 替换为编译期字面量，dev 通过 `dotenv-webpack` 读仓库根 `.env`，prod 只读 shell 环境。适合本地 demo 与 GitHub Pages（侧栏 `Demo / Mock` tag 提示），但生产部署到非本机时仍需明确写入 `.env` 或 shell。

3. sidecar 安全边界偏本地开发。
   FastAPI CORS 受 `SIDECAR_ALLOW_ORIGINS` 控制（默认本地 dev origins，`c7328a5`），`DELETE /api/training/history/{round_name}` 加 `?confirm=<round_name>` 二次确认。Sidecar 部署到非本机前仍需补鉴权、路径校验和下载类 API 保护。

4. 产品边界仍是 demo / workflow validation。
   README 已说明部分页面仍用 mock 数据，DICOM / HL7 / WFDB parser 是轻量实现。`modelService` 在模型不可用时会进入 `mockPredict` 启发式推理，导出 `diagnosis.source` 强制标记 `real / mock / unavailable` 三态（`10df188`）。
   *2026-06-06 进展*：新增 `src/components/DemoBanner.tsx`（顶栏黄色 "Non-clinical preview"）+ MainLayout 侧栏改 "Demo / Mock" 模式 tag + `AIModels` 每行加 `MOCK` chip + `Dashboard` 加 sourceLabel 提示 + README 新增 "Demo / non-clinical boundary" 段。
   *2026-07-04 进展*：SignalMetrics 加持久 `MOCK` chip（`180be1e`），覆盖 Annotation Studio AI 结果卡片；导出 JSON/CSV 携带 `diagnosis.source` 字段，CSV 写 `Source,<real|mock|unavailable>` 行（`10df188`）。`SmartAssistancePanel` 保持只输出"辅助/参考/上下文检索"，不输出"诊断结论"。

5. 测试覆盖偏服务层，缺少关键 UI / 工作流验证。
   *2026-07-04 部分缓解*：`acbf4f0` + `6c7387e` 接入 happy-dom e2e 测试基础设施，`src/__tests__/annotationWorkflow.test.tsx` 覆盖 导入 → 加载模型 → 标注 → 删除 → 导出 主链路（109/109 单测 pass）。前端仍缺少：浏览器 IndexedDB 缓存验证、断网推理证据、Canvas zoom/pan 坐标漂移自动化、训练 SSE 端到端、Playwright 真实浏览器 smoke。这些是 P1 风险，进入正式交付前需补齐。

6. ~~bundle 大小需要建立预算。~~（**2026-06-06 已结清**）
   `bb85031` 把 firebase / @firebase 改 async chunk，主入口从 1.76 → 1.5 MiB；`8762264` 把 webpack `performance.hints` 从 `'warning'` 切到 `'error'`，`maxEntrypointSize` 提到 2 500 000，回归即 CI 红。

7. ~~文档仍有局部漂移风险。~~（**2026-06-06 已结清**）
   `099f594` 重写 CLAUDE.md / AGENTS.md 去重（CLAUDE.md 收编任务路由 + 命令清单 + 调试速查 + env vars 单一来源；AGENTS.md 聚焦通用贡献规范），README / CLAUDE.md / AGENTS.md 已同步 Node 内置 test runner + `npm run test:backend` 入口。`c487669` 新增 `docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md` 沉淀 P0 BUG 审核 + Canvas closeout。

8. ECGFounder 原始工作区仍然很脏。
   `D:\ECG founder\ECGFounder` 的原始 `master` 仍有本地 ahead 提交、多个修改文件和大量训练产物。
   *2026-06-06 进展*：PR 已开至 **上游 `PKUDigitalHealth/ECGFounder` PR #1**（5 commit / 16 文件 / +27,782 行 / 状态 Open / 0 review / 与 base 无冲突）。`2026-07-04` 复查维持该状态，未有新合并动作。

## 建议下一步

> 状态按 2026-07-04 round 后的最新事实更新。

1. ~~更新 GitHub Pages / CI workflow~~（**2026-06-06 已完成**）。维持监听 `main` + `pull_request`，CI 跑 lint + typecheck + 前端单测 + 后端 pytest + build 三 job。
2. ~~抽出运行配置：~~（**2026-06-06 已完成**）`src/config/env.ts` 通过 `fromEnv(name, fallback)` 统一兜底，webpack `DefinePlugin` 注入；生产部署时需明确写入 `.env` 或 shell。
3. 给核心 UI 增加真实浏览器 e2e（**P1**）：在 `acbf4f0` + `6c7387e` 接入的 happy-dom 基础上，引入 Playwright 覆盖 Dashboard 加载、Case List → Annotation Studio、Canvas 双击/拖拽/选中删除、训练 SSE、Assistant 面板只读加载；当前 `src/__tests__/annotationWorkflow.test.tsx` 仅在 jsdom/happy-dom 中跑 Reducer + 视图派生，不替代真实浏览器证据。
4. ~~加固 sidecar：~~（**2026-06-06 已部分完成**，CORS + 删除类确认已落）补充 checkpoint 下载路径校验、服务绑定 origin 鉴权；当前 `c7328a5` 关闭的 CORS `*` 已收口。
5. ~~建立 bundle 预算：~~（**2026-06-06 已完成**）webpack `maxEntrypointSize: 2 500 000` + `hints: 'error'`，`bb85031` 已把 firebase 拆 async chunk。继续通过 `ANALYZE=true npm run build` 观察 TF.js / Antd / ECharts 体积变化。
6. 明确 demo 与生产边界（**持续**）：本轮 `10df188` + `180be1e` 让 mock 推理在导出 metadata 与 UI 上都有持久标记；`c487669` 沉淀 P0 audit 文档；生产部署前需把 `public/models/ecg-classifier/model.json` 替换为验证过的 `.pth` / TF.js bundle 并去掉 mock fallback 路径。
7. 在 ECGFounder 仓库继续处理 `codex/fix-param-observer-current-epoch` PR（**P1**，持续）：等上游 `PKUDigitalHealth/ECGFounder` PR #1 review/合并，并单独清点原始 `D:\ECG founder\ECGFounder` 的未提交训练代码和产物。
