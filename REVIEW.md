# ECG Annotation Platform Review

日期：2026-05-24
最后更新：2026-06-06

## 2026-06-06 hardening round (本轮新增)

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
- 本地 HEAD：`1964487 feat(ui): mark demo / non-clinical boundary globally`
- 远端同步点：`origin/main`
- 当前状态：本地 `main` 与 `origin/main` 同步，工作区干净。
- 已合并分支：`codex/continue-ecg-hardening` / `feature/env-config` / `fix/lint-after-merge` / `feature/unit-tests`。
- 远端功能分支仍存在：`origin/codex/continue-ecg-hardening` 指向 `efbdd04 fix: handle preflight permission errors`。

## 本轮整理

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

| 命令 | 结果 |
| --- | --- |
| `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/preflight-demo.test.ts` | 通过，5/5 preflight 脚本测试 |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run preflight:demo -- --live` | 通过，`3000`、`4000`、`6090`、`finetune_runner.py`、`param_observer.py` 均 OK |
| `node -e ".../api/training/history ... /api/checkpoints"` | 通过，training history `78` 条，checkpoints `84` 条 |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run check` | 通过，包含 lint、typecheck、18/18 前端单测和 production build |
| `npm --prefix "D:\VS vibe coding files\ecg-annotation-platform" run test:backend` | 通过，30/30 pytest |

构建输出提示主入口约 `2.95 MiB`，webpack performance hints 当前关闭。

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

1. CI / 部署触发分支需要调整。
   `.github/workflows/deploy-pages.yml` 仍只监听 `codex/optimize-bundle-and-lint`，当前主线已经合并到 `main`。建议改为监听 `main`，并补充 CI job 运行 `lint`、`typecheck`、`test:unit`、`test:backend` 和 `build`。

2. 运行端点仍然硬编码。
   `src/services/clinicApi.ts` 写死 `http://localhost:4000/api`，`src/services/trainingApi.ts` 和 `src/services/ecgAssistantApi.ts` 写死 `http://localhost:6090`。这适合本地 demo，但不适合 GitHub Pages、局域网部署或多环境配置。

3. sidecar 安全边界偏本地开发。
   FastAPI CORS 为 `allow_origins=["*"]`，并暴露训练任务、历史删除、checkpoint 下载等本地文件相关操作。若服务绑定到非本机或被浏览器页面跨域访问，需要增加 origin 限制、鉴权、路径校验和操作确认。

4. 产品边界仍是 demo / workflow validation。
   README 已说明部分页面仍用 mock 数据，DICOM / HL7 / WFDB parser 是轻量实现。`modelService` 在模型不可用时会进入 mock inference。进入临床或严肃分析场景前，需要明确标注非诊断用途、真实数据接入路径和解析准确性边界。
   *2026-06-06 13:32 进展*：新增 `src/components/DemoBanner.tsx`（顶栏黄色 "Non-clinical preview"）+ MainLayout 侧栏改 "Demo / Mock" 模式 tag + `AIModels` 每行加 `MOCK` chip + `Dashboard` 加 sourceLabel 提示 + README 新增 "Demo / non-clinical boundary" 段。`SmartAssistancePanel` 原本就只输出"辅助/参考/上下文检索"，不输出"诊断结论"，保留。

5. 测试覆盖偏服务层，缺少关键 UI / 工作流验证。
   当前服务和诊断规则覆盖较好，但前端仍缺少 Annotation Studio canvas 交互、病例列表/详情 CRUD、训练 SSE、助手面板渲染、导入/导出和演示页面 smoke / e2e。

6. bundle 大小需要建立预算。
   生产构建通过，但主入口约 `2.95 MiB`，且 performance hints 关闭。TensorFlow.js、Ant Design 和图表库容易继续推高首屏成本，建议引入 bundle analyzer 和明确体积预算。

7. 文档仍有局部漂移风险。
   `CLAUDE.md` 曾写“Jest”，但 `package.json` 实际使用 Node 内置 test runner。建议同步 README / AGENTS / CLAUDE 中的测试说明，并保持 review 文档随 main 合并更新。

8. ECGFounder 原始工作区仍然很脏。
   `D:\ECG founder\ECGFounder` 的原始 `master` 仍有本地 ahead 提交、多个修改文件和大量训练产物。
   *2026-06-06 13:44 进展*：PR 已经开到 **上游 `PKUDigitalHealth/ECGFounder` 的 #1**（`https://github.com/PKUDigitalHealth/ECGFounder/pull/1`），5 个 commit / 16 文件 / +27,782 行 / 状态 Open / 0 review / 与 base 无冲突。这部分是 JJ704SD 长期持有 `PKUDigitalHealth:codex/fix-param-observer-current-epoch` 分支的成果。原始工作区仍需后续清点、忽略或拆分提交。

## 建议下一步

1. 更新 GitHub Pages / CI workflow：触发 `main`，并让 CI 覆盖 lint、typecheck、前端单测、后端 pytest 和 build。
2. 抽出运行配置：统一 API base URL、mock API 端口、sidecar 端口和 `ECGFOUNDER_BASE`，通过 `.env` 或运行时 config 注入。
3. 给核心 UI 增加 smoke / e2e：至少覆盖 dashboard 加载、病例进入标注页、导入样例、添加标注、导出、训练看板和 Agent 面板只读加载。
4. 加固 sidecar：限制 CORS、补充 checkpoint 下载路径校验、对删除类接口加保护，并确认服务只绑定本地或有明确鉴权。
5. 建立 bundle 预算：分析 webpack 输出，确认 TensorFlow、Ant Design、ECharts 是否只在需要页面加载。
6. 明确 demo 与生产边界：在 UI 和文档里区分 mock inference、轻量 parser、真实模型/真实数据路径。
7. 在 ECGFounder 仓库继续处理 `codex/fix-param-observer-current-epoch` PR，并单独清点原始 `D:\ECG founder\ECGFounder` 的未提交训练代码和产物。
