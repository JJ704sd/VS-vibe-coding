# ECG Annotation Platform Review

日期：2026-05-24
最后更新：2026-07-07

## 2026-07-07 batch 1+2 P1 closeout round (本轮新增)

围绕 2026-07-07 全面 bug 审计报告（`docs/audits/2026-07-07-FINAL-REPORT.md`）
的 P0 + P1 修复路线，本轮落 4 个 track（Track P / S / B / P2）+ Track D2
cherry-pick（9 个 feat + 4 个 merge + 1 个 cherry-pick，按时间顺序）：

| SHA | 类型 | 摘要 |
| --- | --- | --- |
| `b61340c` | `fix(parser)` | Track P：A-01 DICOM parser 显式 VR 大小端 + A-03 WFDB `Uint8Array` + `212` 格式（2 P0） |
| `80e55c5` | `fix(sidecar)` | Track S：D-1 path traversal + D-2 admin token + C-12 MiniMax proxy route + C-11 drop `useProxy=false`（3 P0 + 1 P1） |
| `c779107` | `fix(studio)` | Track B：B-03 URL switch state reset + B-04 Firebase debounce guard + B-05 import clear inference（3 P1） |
| `575f360` | `fix(studio)` | B-03 ref guard（verifier attempt 1 → 2） |
| `d8294d8` | `docs(audit)` | 2026-07-07 全面 bug 审计报告（Track A/B/C/D + FINAL） |
| `c7faa32` | `fix(parser)` | Track P2：A-02 DICOM waveform tags + A-04 HL7 sampling/duration + A-05 `.hl7` UI route + C-14 HL7 padding/endian + C-15 WFDB `parseECG` entry（5 P1） |
| `3852458` | `merge` | merge fix/track-p-parser-rework into main |
| `25f621b` | `merge` | merge fix/track-s-sidecar-security into main |
| `5468fc2` | `merge` | merge fix/track-b-studio-state-reset into main |
| `acffecf` | `merge` | merge fix/track-p2-parser-extension into main |
| `b995732` | `fix(build)` | Track D2 cherry-pick：D-3 bundle 预算文档同步脚本 + D-4 `performance.assetFilter`（2 P1） |

**累计 close（本轮 + 2026-07-04 round）：** 全部 **5 P0** + **11 P1**（audit 23 P1
中的 11 个）。**12 P1 + 20 P2 + 6 P3** 仍 open，进下一轮。

**本轮残留 / 风险（必须坦白）：**

- **Track M / Track F worker 丢失。** 上一轮 closeout 报告把 Track M
  （5e8e9b0，model contract 7 个 P1）和 Track F（d2f3a51，firebase UX
  2 个 P1）列为"已合并入 main"，但 `git cat-file -t 5e8e9b0` /
  `d2f3a51` 均报 "Not a valid object name"，`git fsck --no-reflogs` 也
  没找到 dangling commit。Work 要么从未产出，要么被静默丢弃。下一轮
  必须按 "team plan killed ≠ 没完成" SOP，在 merge 之前 `git log
  fix/track-<id>` 实证。
- **D-3 / D-4 cherry-pick。** Track D2 的 commit `d33a348` 实际只是
  dangling，没 merge 进 main；本轮通过 `git cherry-pick d33a348` 救回
  到 `fix/d2-bundle-hygiene` 分支（只取 webpack 配置 + 新脚本，CHANGELOG
  / REVIEW 由本轮重写）。没有这次 dangling commit 救回的话，D-3 + D-4
  会和 Track M / Track F 一起丢失。
- **`npm run test:unit` 出现 1 个 pre-existing skip**（与本轮无关，
  验证矩阵从 109/109 → 207/208 + 1 skip）。

**已结清（按 2026-07-04 round risk #1–#8 对照）：**

- 风险 #1（CI 触发分支）→ `6c9d019` + `edda1ac` 维持监听 `main` + 三
  job 形态，本轮无回归。
- 风险 #2（运行端点硬编码）→ `a17fbec` + 本轮 webpack `DefinePlugin`
  维持；新 MiniMax 代理走 Sidecar 默认端口 6090。
- 风险 #3（sidecar 安全边界）→ 本轮 `80e55c5` 把 D-1 path traversal
  + D-2 admin token 都收口；CORS 仍按 `SIDECAR_ALLOW_ORIGINS` 受控。
  部署到非本机前需把 `SIDECAR_ADMIN_TOKEN` 写进环境。
- 风险 #4（demo / 生产边界说明）→ `1964487` + `180be1e` + `10df188`
  维持；本轮无新增 UI 标记变更。
- 风险 #5（UI / 工作流 e2e 覆盖）→ `acbf4f0` + `6c7387e` 维持；本轮
  `c779107` + `575f360` 覆盖 B-03 URL 切换分支，需要补 happy-dom 单测
  （下一轮 +1 case）。
- 风险 #6（bundle 预算与按需懒加载）→ `bb85031` + `8762264` 维持；
  本轮 `b995732` 把 D-4 async chunk assetFilter 补上，vendor split
  现在和 entrypoint 一起受 `maxAssetSize` 守门；D-3 把预算数字与
  webpack 真值的同步锁进 `scripts/check-bundle-budget-sync.ps1`。
- 风险 #7（文档漂移）→ `099f594` + `c487669` 维持；本轮 CHANGELOG
  + REVIEW 重写覆盖 batch 1+2 全部 close 项。
- 风险 #8（ECGFounder 外部 PR）→ 上游 `PKUDigitalHealth/ECGFounder`
  PR #1 状态不变；本轮无新动作。

## 2026-07-07 batch 3 P1 closeout round (Track M + Track F)

围绕 2026-07-07 全面 bug 审计报告里剩余的 14 项 P1（batch 1+2 之后），
本轮落 2 个 track + 1 个 salvage 模式，落 4 个 commit（按合并顺序）：

| SHA | 类型 | 摘要 |
| --- | --- | --- |
| `7deacab` | `fix(model)` | Track M：A-06 显式三态 + A-07 缓存失败保留 + A-08 namespace 统一 + A-09 sigmoid 归一 + A-10 删 dead code + A-12 多导联 mock + A-14 hook 复用 buildInputTensor（7 P1，911 insertions） |
| `e1863e4` | `merge` | merge fix/track-m-model-contract into main |
| `8a911bb` | `fix(studio)` | Track F：B-06 Firebase init 失败 Alert + toast + B-07 云端保存失败 toast + 5s 防抖（2 P1，314 insertions，orchestrator 代 commit） |
| `bba5196` | `merge` | merge fix/track-f-firebase-ux into main |

**累计 close（本 round + 之前 round）：** 全部 **5 P0** + **20 P1**（audit 23 P1 中的 20 个）。
**3 P1 + 20 P2 + 6 P3** 仍 open，进 backlog。

**本 round 残留 / 风险：**

- **Worker session 15min 超时 → salvage 模式生效。** 两个 track worker 同时被
  team engine kill（commit 完成前 / commit 后被回收）。Track M 在被 kill 前
  跑完了 `git commit`（`7deacab`），Track F 只跑了 staged 但没 commit，按
  memory SOP "team plan killed ≠ 没完成" 由 orchestrator 代 commit 为
  `8a911bb`。教训：Windows 上 `npm run check` 全量 (lint + typecheck +
  test:unit + build + check:assets) 需要 ~ 2 min，worker 还要读源码 + 写
  测试 + commit，7-9 项 P1 的活塞不进 15 min。下轮要么 `--extend-timeout`
  到 25-30 min，要么拆更小的 track（每 track ≤ 3 P1）。详见 MEMORY.md。
- **AnnotationStudio.tsx 双向修改** — Track M 加 Modal（A-06 opt-in 模态）
  和 Track F 加 Alert + 防抖 toast（B-06/B-07）都改了这个文件，但都在不同
  code path（line 136+ / 410+ / 643+），git `ort` 自动 merge 成功，零冲突
  标记。
- **C-residuals 3 项 P1** 仍 open（C-06 RAG fallback 写 `docs/assistant/
  knowledge-base.md` / C-07 assistant error 暴露绝对路径 / C-19 syncNow
  空 executor），需要单独的 round。

## 2026-07-07 batch 4 C-residuals P1 closeout round (本轮新增)

围绕 batch 3 后剩余的 3 项 P1（C-06 / C-07 / C-19，全部 C track residuals），
本轮 2 个 fix 提交 + 1 个 closeout 文档，按合并顺序：

| SHA | 类型 | 摘要 |
| --- | --- | --- |
| `37498b6` | `fix(assistant)` | C-06 RAG fallback 写 `proxy-server/.data/assistant/` 不再写仓库 + C-07 error 响应脱敏为 `{filename, code}`（2 P1） |
| `01f51b9` | `fix(hook)` | C-19 `useOfflineMode` 接受 `options.executors` 入参；无 executor 时单条可见 warn，不再 silently mark failed（1 P1） |
| `9735bc7` | `docs(closeout)` | batch 4 closeout：CHANGELOG + REVIEW 重写跟进 |

**累计 close（本 round + 之前 round）：** 全部 **5 P0 + 23 P1**（audit 23 P1
中的 23 个，已 100% close）。**20 P2 + 6 P3** 仍 open，进 backlog。

**本 round 残留 / 风险：**

- **C-19 `useOfflineMode` 仍无 production caller**。hook 现在正确接受
  `executors` map，但 `src/` 下没人传 `executors`，跟 batch 1 时的状态
  一致。这是有意 scope cut：C-19 风险点是"hook shape 设计错误"，
  "无 caller"是产品决策（不归 P1 closeout 管），下一轮按需接 case list
  / annotation create 的真实 executor。
- **`proxy-server/.data/assistant/` 不在 `.gitignore`**。首次 rebuild 写
  fallback 时会在 sidecar 目录落一个 `knowledge-base.md`。生产部署前
  需在 `.gitignore` 加 `proxy-server/.data/`（或随包 ship 预制 KB
  并禁用 fallback write），下一轮 round 5 决策。
- **Test 数 +4**。batch 3 baseline 246 pass，batch 4 后 250 pass（+1
  pre-existing skip）。`useOfflineMode.test.ts` 新增 4 个 case 覆盖
  C-19 的 4 个分支（no-executors warn / executors drain / executor
  throw → keep with lastError / clear pending actions）。
- **Backend test 数 +5**。RAG test file 从 2 个 case 扩到 6 个
  （C-06 fallback dir 不写仓库 × 2 + C-07 sanitized error × 2 + C-06
  fallback write 失败兜底 × 1）。`test_assistant_service.py` 1 个旧
  test 改写（验证新 contract：C-06 之后 fallback 不写 tmp_path/docs/
  assistant/）。

**已结清（按 2026-07-04 round risk #1–#8 对照）：**

- 风险 #1–#7 → 维持（之前 round 已 close）
- 风险 #8（ECGFounder 外部 PR）→ 维持，无新动作
- **新增风险 #10（sidecar data dir 卫生）**：见上文 `.data/` ignore 决策。
- **Test 数 +39**：batch 1+2 baseline 是 207 pass，batch 3 后 246 pass（+1
  pre-existing skip）。Track M 加 27 (modelService 单元 + 5 worker 协议 +
  3 hook cache)，Track F 加 4 (B-06 listener + error path 单元)。

**已结清（按 2026-07-04 round risk #1–#8 对照）：**

- 风险 #1–#6 → 维持（之前 round 已 close）
- 风险 #7（文档漂移）→ 本轮 batch 3 closeout CHANGELOG + REVIEW 重写跟进
- 风险 #8（ECGFounder 外部 PR）→ 维持，无新动作
- **新增风险 #9：worker timeout with full `npm run check`** — 需要在 plan
  prompt 里强制要求 worker 先做最小 commit 再继续扩展测试，避免被 kill 时
  全部丢失

## 2026-07-04 P0 audit + canvas closeout round

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
- 风险 #6（bundle 预算与按需懒加载）→ 已在 2026-06-06 hardening round 关闭；本轮 `8762264` 把 webpack `performance.hints` 切到 `'error'` + `maxEntrypointSize` 收紧到 1 600 000，回归即 CI 红；本轮 `b995732` 进一步补 `assetFilter`（D-4）+ `check-bundle-budget-sync.ps1`（D-3）把 bundle 与文档同步锁住。
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
- 风险 #6（bundle 预算与按需懒加载）→ `bb85031 perf(build): lazy-load firebase + @firebase via dynamic import and split chunks`。`firebaseService` 顶层 import 改为 type-only + `await import()` 内填充到 instance fields，AnnotationStudio 进 useEffect 时触发 init。webpack 新增 `firebase` / `@firebase` cacheGroup（均 `chunks: 'async'`），vendor cacheGroup 改用 function test 排除 `firebase/@tensorflow/@firebase`。结果：主入口 1.76 → 1.5 MiB（main 28 + Antd 600 + vendors 907 + runtime 4 KB），firebase SDK（6.61 + 515 = ~520 KiB）拆为按需 async chunk，仅在用户点进 AnnotationStudio 时下载。webpack budget 同步收紧到 `maxEntrypointSize: 1 600 000`（1.5 MiB + ~50 KiB headroom），保留 `hints: 'error'` 防止后续再胖；本轮 `b995732` 再补 `assetFilter`（D-4）+ `check-bundle-budget-sync.ps1`（D-3）把 bundle 与文档同步锁住。

CI 状态：所有 commit 已 push 至 `origin/main`，最后三次 CI 跑通（`1964487` 2:18 success / `0829b9e` 2:25 success / `bb85031` 2:12 success，2026-06-06 用户确认绿色），站点 redeploy 到 `https://jj704sd.github.io/VS-vibe-coding/`，含 demo 边界 banner / MOCK chip / bundle 预算守门。

## 结论

当前项目处于“可本地运行、可构建、可验证”的 demo / 工作流验证阶段。代码已经合并回 `main`，本地 `main` 与 `origin/main` 同步，最新远端合并点为 PR #11：`004f61a Merge pull request #11 from JJ704sd/codex/continue-ecg-hardening`。

本轮 hardening 已覆盖 ECGFounder training sidecar、前端训练看板、训练历史 parser、中文演示预检和演示启动文档。前端 lint、TypeScript 类型检查、前端单测、后端 pytest、生产构建、中文 preflight 和基础 sidecar 数据 smoke 均已通过。主要剩余风险不在当前编译正确性，而在 CI / Pages 触发配置、运行环境硬编码、sidecar 安全边界、UI 工作流测试、bundle 预算和 demo / 生产边界说明。

ECGFounder 独立仓库的 observer 修复已在 **上游 `PKUDigitalHealth/ECGFounder` 开了 PR #1**（5 commit、+27,782 行、与 master 无冲突），等 maintainer review / 合并。

## 仓库状态

- 仓库路径：`D:\VS vibe coding files\ecg-annotation-platform`
- 当前分支：`main`（合并 Track M + Track F + closeout docs 后待推送）
- 本地 HEAD：`bba5196 merge: Track F (Firebase init error Alert + save error toast debounce: B-06/B-07, 2 P1)`（+ 待 commit 的 CHANGELOG / REVIEW closeout）
- 远端同步点：`origin/main` = `7e2d18e merge: Track D2`（batch 1+2 closeout base），batch 3 ahead 5 commits 待推送（4 feat/merge + 1 closeout doc）
- 当前状态：本地工作区有 CHANGELOG.md / REVIEW.md 未提交（batch 3 closeout），ahead `origin/main`。
- 已合并分支：`codex/continue-ecg-hardening` / `feature/env-config` / `fix/lint-after-merge` / `feature/unit-tests` / `fix/d2-bundle-hygiene`（batch 1+2）/ `fix/track-m-model-contract` + `fix/track-f-firebase-ux`（batch 3）。
- 待清理的本地 worktree：`../ecg-annotation-platform-track-m` / `../ecg-annotation-platform-track-f`（batch 3 worker 创建，merge 后清理）。
- 远端功能分支仍存在：`origin/codex/continue-ecg-hardening` 指向 `efbdd04 fix: handle preflight permission errors`。

## 本轮整理（2026-07-07 batch 4 C-residuals）

- `fix(assistant)` (`37498b6`): C-06 RAG fallback 目录配置化 + C-07 error 响应脱敏。`RAGStore.__init__` 接受 `fallback_dir` 参数（默认 `proxy-server/.data/assistant/`），rebuild 时 fallback 写到 sidecar 数据目录而非仓库；errors[] 改为 `{filename, code}` 形式，绝对路径只进 sidecar `assistant.rag_store` WARNING log。2 个 P1 关闭。`proxy-server/assistant/rag_store.py` 增 30 行 / `proxy-server/tests/test_assistant_rag.py` 加 4 个 C-06/C-07 case / `proxy-server/tests/test_assistant_service.py` 1 个旧 case 改写。详见本文件 §batch 4 round。
- `fix(hook)` (`01f51b9`): C-19 `useOfflineMode` 接受 `options.executors` map。无 executors 时 `syncNow` 单条可见 `console.warn` 解释如何启用,不再 silently mark failed + re-save;有 executors 时 `syncPendingActions` 真正 drain。1 个 P1 关闭。`src/hooks/useOfflineMode.ts` 增 30 行 / 新建 `src/hooks/useOfflineMode.test.ts` 4 个 case。
- 本轮 CHANGELOG + REVIEW 重写:把 5 P0 + 23 P1 全 close + 20 P2 + 6 P3 残留的状态写进 `CHANGELOG.md` 的 2026-07-07 batch 4 C-residuals 段、`REVIEW.md` 的同标题段 + 验证结果表;同时记录 `.data/` 卫生决策 + `useOfflineMode` 无 caller 留待下一轮进 Risks 段 + 风险 #10。
- 跟 batch 3 不同:本轮**不**走 team plan worker 模式,直接由 orchestrator 单 session 完成(改动 < 200 行,只动 2 个产品文件 + 1 个新建 test 文件 + 1 个旧 test 改写,远低于 15min worker timeout 风险)。Lesson: ≤ 3 P1 局部改动不必 spawn worker,跟 batch 3 worker 15min timeout + salvage 模式记忆一致。

## 本轮整理（2026-07-07 batch 3）

- Track M（`7deacab fix(model)`）：A-06 显式三态 outcome（默认 failed 不再 silent mock）+ A-07 cache save 失败保留内存模型 + A-08 共享 MODEL_CACHE_NAMESPACE + A-09 sigmoid 不再强行 softmax + A-10 删 Worker predictWithHeatmap dead code + A-12 mockPredict 改用 pickDominantLead 不再 hardcode signal[0] + A-14 hook 复用 ModelService.buildInputTensor。worker session 在被 kill 前跑完了 `git commit`，911 insertions / 7 files。详见本文件 §batch 3 round。
- Track F（`8a911bb fix(studio)`）：B-06 firebaseService.initialize 失败用户反馈（onInitFailure listener + Alert + message.error + listener 卸载）+ B-07 updateDoc 失败 toast + 5s 防抖。worker session 被 kill 时只有 staged changes，orchestrator 按 memory SOP 代 commit，314 insertions / 3 files。详见本文件 §batch 3 round。
- AnnotationStudio.tsx 双向修改：Track M（line 643+ A-06 opt-in modal）和 Track F（lines 136+ / 410+ B-06/B-07 alert + save error toast）自动 merge 成功，零冲突标记。
- 本轮 CHANGELOG + REVIEW 重写：把 5 P0 + 20 P1 全 close + 3 P1 残留 + 20 P2 + 6 P3 的状态写进 `CHANGELOG.md` 的 2026-07-07 batch 3 P1 closeout 段、`REVIEW.md` 的同标题段；同时记录 worker timeout + salvage 模式进 Risks 段 + 风险 #9。

## 本轮整理（2026-07-07 batch 1+2）

- Track P / S / B / P2（`b61340c` / `80e55c5` / `c779107` + `575f360` / `c7faa32`）：把 2026-07-07 全面 bug 审计报告里 5 P0 + 9 P1 全 close。详细 commit-by-commit 摘要见本文件 §2026-07-07 batch 1+2 P1 closeout round。
- Track D2 cherry-pick（`b995732`）：从 dangling commit `d33a348` 救回 D-3（`scripts/check-bundle-budget-sync.ps1`）+ D-4（webpack `performance.assetFilter`）两条 P1，cherry-pick 落到 `fix/d2-bundle-hygiene`，仅取 webpack 配置 + 新脚本，CHANGELOG / REVIEW 由本轮 closeout 重写覆盖。
- 本轮 CHANGELOG + REVIEW 重写：把 5 P0 全 close + 11 P1 close + 12 P1 残留 + 20 P2 + 6 P3 的状态全部写进 `CHANGELOG.md` 的 2026-07-07 batch 1+2 P1 closeout 段、`REVIEW.md` 的同标题段 + 验证结果表；同时把 Track M / Track F worker 丢失的事记进 Risks 段。

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

### 2026-07-07 batch 4 round（本轮新增）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 errors |
| `npm run typecheck` | 通过，0 errors |
| `npm run test:unit` | 通过，**250/251 pass**（1 pre-existing skip；batch 3 baseline 246 → batch 4 后 250，+4 useOfflineMode tests 覆盖 C-19） |
| `npm run test:backend` | 通过，**74 passed**（was 30 batch 1+2 baseline → batch 3 后 69 → batch 4 后 74，+5 RAG tests 覆盖 C-06 + C-07） |
| `npm run build` | 通过，webpack compiled successfully，主入口 1.5 MiB，无 size 警告（`hints: 'error'` + `assetFilter` 双守门） |
| `npm run check` | 全过 |
| `npm run check:assets` | 通过，`dist/models/` 仍按预期构建 |
| `pwsh scripts/check-bundle-budget-sync.ps1` | 通过，本轮重写后的 CHANGELOG / REVIEW 与 webpack 真值一致 |
| `git diff --check` | 通过，0 exit |

### 2026-07-07 batch 3 round（既有，仍有效）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 errors |
| `npm run typecheck` | 通过，0 errors |
| `npm run test:unit` | 通过，**246/247 pass**（1 pre-existing skip；batch 1+2 baseline 207 → batch 3 后 246，+39 tests 跨 Track M + Track F） |
| `npm run test:backend` | 通过 |
| `npm run build` | 通过，webpack compiled successfully，主入口 1.5 MiB，无 size 警告（`hints: 'error'` + `assetFilter` 双守门） |
| `npm run check` | 全过 |
| `npm run check:assets` | 通过，`dist/models/` 仍按预期构建 |
| `pwsh scripts/check-bundle-budget-sync.ps1` | 通过，本轮重写后的 CHANGELOG / REVIEW 与 webpack 真值一致 |
| `git diff --check` | 通过，0 exit |

### 2026-07-07 batch 1+2 round（既有，仍有效）

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，0 errors |
| `npm run typecheck` | 通过，0 errors |
| `npm run test:unit` | 通过，**207/208 pass**（1 pre-existing skip，与本轮无关） |
| `npm run test:backend` | 通过（pytest，sidecar D-1 path traversal 6 条回归测试在 `tests/test_training_api_contract.py`） |
| `npm run build` | 通过，webpack compiled successfully，主入口 1.5 MiB，无 size 警告（`hints: 'error'` + `assetFilter` 双守门） |
| `npm run check` | 全过 |
| `npm run check:assets` | 通过，`dist/models/` 仍按预期构建 |
| `pwsh scripts/check-bundle-budget-sync.ps1` | 通过，本轮重写后的 CHANGELOG / REVIEW 与 webpack 真值一致 |

### 2026-07-04 round（既有，仍有效）

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

3. ~~sidecar 安全边界偏本地开发。~~（**2026-06-06 已部分完成 + 2026-07-07 已基本完成**）
   FastAPI CORS 受 `SIDECAR_ALLOW_ORIGINS` 控制（默认本地 dev origins，`c7328a5`），`DELETE /api/training/history/{round_name}` 加 `?confirm=<round_name>` 二次确认。本轮 `80e55c5` 把 D-1 path traversal（`_safe_round_name` + filename 正则 + `is_relative_to` 校验）+ D-2 admin token（`X-Admin-Token` 中间件 + `SIDECAR_ADMIN_TOKEN` 环境变量）都收口；`b995732` 通过 `scripts/check-bundle-budget-sync.ps1` 把文档与构建真值同步防回归。生产部署到非本机时仍需把 `SIDECAR_ADMIN_TOKEN` 写进环境并改默认 CORS。

4. 产品边界仍是 demo / workflow validation。
   README 已说明部分页面仍用 mock 数据，DICOM / HL7 / WFDB parser 是轻量实现。`modelService` 在模型不可用时会进入 `mockPredict` 启发式推理，导出 `diagnosis.source` 强制标记 `real / mock / unavailable` 三态（`10df188`）。
   *2026-06-06 进展*：新增 `src/components/DemoBanner.tsx`（顶栏黄色 "Non-clinical preview"）+ MainLayout 侧栏改 "Demo / Mock" 模式 tag + `AIModels` 每行加 `MOCK` chip + `Dashboard` 加 sourceLabel 提示 + README 新增 "Demo / non-clinical boundary" 段。
   *2026-07-04 进展*：SignalMetrics 加持久 `MOCK` chip（`180be1e`），覆盖 Annotation Studio AI 结果卡片；导出 JSON/CSV 携带 `diagnosis.source` 字段，CSV 写 `Source,<real|mock|unavailable>` 行（`10df188`）。`SmartAssistancePanel` 保持只输出"辅助/参考/上下文检索"，不输出"诊断结论"。

5. 测试覆盖偏服务层，缺少关键 UI / 工作流验证。
   *2026-07-04 部分缓解*：`acbf4f0` + `6c7387e` 接入 happy-dom e2e 测试基础设施，`src/__tests__/annotationWorkflow.test.tsx` 覆盖 导入 → 加载模型 → 标注 → 删除 → 导出 主链路（109/109 单测 pass）。前端仍缺少：浏览器 IndexedDB 缓存验证、断网推理证据、Canvas zoom/pan 坐标漂移自动化、训练 SSE 端到端、Playwright 真实浏览器 smoke。这些是 P1 风险，进入正式交付前需补齐。

6. ~~bundle 大小需要建立预算。~~（**2026-06-06 已结清**）
   `bb85031` 把 firebase / @firebase 改 async chunk，主入口从 1.76 → 1.5 MiB；`8762264` 把 webpack `performance.hints` 从 `'warning'` 切到 `'error'`，`maxEntrypointSize` 收紧到 1 600 000（1.5 MiB + ~50 KiB headroom），回归即 CI 红。

7. ~~文档仍有局部漂移风险。~~（**2026-06-06 已结清**）
   `099f594` 重写 CLAUDE.md / AGENTS.md 去重（CLAUDE.md 收编任务路由 + 命令清单 + 调试速查 + env vars 单一来源；AGENTS.md 聚焦通用贡献规范），README / CLAUDE.md / AGENTS.md 已同步 Node 内置 test runner + `npm run test:backend` 入口。`c487669` 新增 `docs/superpowers/plans/2026-07-04-bug-audit-and-closeout-checklist.md` 沉淀 P0 BUG 审核 + Canvas closeout。

8. ECGFounder 原始工作区仍然很脏。
   `D:\ECG founder\ECGFounder` 的原始 `master` 仍有本地 ahead 提交、多个修改文件和大量训练产物。
   *2026-06-06 进展*：PR 已开至 **上游 `PKUDigitalHealth/ECGFounder` PR #1**（5 commit / 16 文件 / +27,782 行 / 状态 Open / 0 review / 与 base 无冲突）。`2026-07-04` 复查维持该状态，未有新合并动作。

## 建议下一步

> 状态按 2026-07-07 batch 4 round 后的最新事实更新。

1. ~~更新 GitHub Pages / CI workflow~~（**2026-06-06 已完成**）。维持监听 `main` + `pull_request`，CI 跑 lint + typecheck + 前端单测 + 后端 pytest + build 三 job。
2. ~~抽出运行配置：~~（**2026-06-06 已完成**）`src/config/env.ts` 通过 `fromEnv(name, fallback)` 统一兜底，webpack `DefinePlugin` 注入；生产部署时需明确写入 `.env` 或 shell。
3. 给核心 UI 增加真实浏览器 e2e（**P1**）：在 `acbf4f0` + `6c7387e` 接入的 happy-dom 基础上，引入 Playwright 覆盖 Dashboard 加载、Case List → Annotation Studio、Canvas 双击/拖拽/选中删除、训练 SSE、Assistant 面板只读加载；当前 `src/__tests__/annotationWorkflow.test.tsx` 仅在 jsdom/happy-dom 中跑 Reducer + 视图派生，不替代真实浏览器证据。
4. ~~加固 sidecar：~~（**2026-06-06 已部分完成**，CORS + 删除类确认已落；**2026-07-07 batch 1+2 完成**，D-1 路径遍历 + D-2 admin token 收口，`SIDECAR_ADMIN_TOKEN` 生产部署必填）。**2026-07-07 batch 4 完成**，C-06 RAG fallback 写 `proxy-server/.data/assistant/` + C-07 error 响应脱敏为 `{filename, code}`。`scripts/check-bundle-budget-sync.ps1` 加进 preflight 防 D-3 类回归。
5. ~~建立 bundle 预算：~~（**2026-06-06 已完成 + 2026-07-07 batch 1+2 扩展**）webpack `maxEntrypointSize: 1 600 000` + `maxAssetSize: 1 500 000` + `hints: 'error'` + `performance.assetFilter`（D-4，`b995732`），`bb85031` 把 firebase 拆 async chunk。继续通过 `ANALYZE=true npm run build` 观察 TF.js / Antd / ECharts 体积变化。
6. 明确 demo 与生产边界（**持续**）：本轮 `10df188` + `180be1e` 让 mock 推理在导出 metadata 与 UI 上都有持久标记；batch 3 `7deacab` 让 mock 不再 silent 进入（用户必须 Modal.confirm 主动 opt-in）；batch 4 `fix(assistant)` 让 RAG fallback 不再写仓库（操作员能 git status 干净）；`c487669` 沉淀 P0 audit 文档；`d8294d8` 沉淀 2026-07-07 全面 bug 审计报告（54 项风险地图）；生产部署前需把 `public/models/ecg-classifier/model.json` 替换为验证过的 `.pth` / TF.js bundle 并去掉 mock fallback 路径。
7. 在 ECGFounder 仓库继续处理 `codex/fix-param-observer-current-epoch` PR（**P1**，持续）：等上游 `PKUDigitalHealth/ECGFounder` PR #1 review/合并，并单独清点原始 `D:\ECG founder\ECGFounder` 的未提交训练代码和产物。
8. ~~重跑 Track M + Track F worker session（**P1 残留 9 项**）~~（**2026-07-07 batch 3 已完成**）：A-06 / A-07 / A-08 / A-09 / A-10 / A-12 / A-14（7 项 model contract / cache / tensor）+ B-06 / B-07（2 项 Firebase UX）全部 close。worker session 被 team engine 15min timeout kill 后,按 memory SOP salvage 模式救回（Track M worker pre-kill 跑完 commit，Track F 由 orchestrator 代 commit）。详见本文件 §batch 3 round + Risks 段。
9. ~~消化 Track C 残留（**P1 残留 3 项**）~~（**2026-07-07 batch 4 已完成**）：C-06 RAG fallback 写 `proxy-server/.data/assistant/` 不再写仓库 + C-07 assistant error 响应脱敏为 `{filename, code}` + C-19 `useOfflineMode` 接受 `executors` map。详见本文件 §batch 4 round。
10. **（新增）决定 `proxy-server/.data/` 卫生策略**（**持续**，详见风险 #10）：`batch 4` 让 RAG fallback 写到 `proxy-server/.data/assistant/`，但仓库没 `.gitignore` 规则。下一轮 batch 5 必须选 (a) 加 `.gitignore` + 接受 runtime 首次写,或 (b) 在打包脚本里 ship 预制 KB + 禁用 fallback write。建议 (a),成本最低。
11. **可选：批量消化 P2 / P3**（共 26 项），按 track 分批即可，无紧迫性。
12. **修复风险 #9（worker timeout with full `npm run check`）**：下次 plan prompt 必须显式 `--extend-timeout` 到 25-30 min，或拆小 track (≤3 P1) 让每 track 在 15 min 内可完成。或 worker 第一步先做最小 commit（"骨架"），第二步加测试，第三步加 UI 收尾，避免被 kill 时全部丢失。
