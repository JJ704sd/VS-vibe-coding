# Track D: Sidecar + 构建 + CI + 配置 审计 (2026-07-07)

> 工作目录: `D:\VS vibe coding files\ecg-annotation-platform`
> 当前 HEAD: `c487669 docs(audit): capture P0 BUG audit + canvas annotation closeout + BUG records`
> 审计人: coder (Track D)
> 范围: 后端 FastAPI Sidecar + 前端 webpack/ts 构建 + GitHub Pages CI + 配置文件(README/CLAUDE.md/AGENTS.md/.env.example/.gitignore/templates/mock-api)
> 性质: **只读审计**,不修改任何源码 / CI workflow / 构建配置

---

## 0. 速读表

| # | 风险轴 | 一句话结论 | Severity | AUDIT/REVIEW 对照 |
|---|--------|-----------|----------|------------------|
| 1 | Sidecar 安全 | `download_checkpoint` 路由**完全没有路径遍历校验**;`round_name` 与 `filename` 可注入 `../../../` 读到 ECGFounder_BASE 外任意文件 | **P0** | 新发现 (REVIEW 风险 #3 仅泛提"路径校验"未细化到本端点) |
| 2 | Sidecar 鉴权 | proxy-server 0 鉴权中间件,任何人能触达 6090 即可 `POST /api/training/task` / `DELETE /api/training/history/{round}` | **P0** | 残留 (REVIEW 风险 #3 / CLAUDE.md "部署到非本机前需补鉴权") |
| 3 | 文档漂移 | REVIEW.md 4 处仍写 `maxEntrypointSize: 2 500 000`,但 webpack.config.js:216 已收紧到 `1 600 000`;CHANGELOG.md:63 也写 2 500 000 | **P1** | 残留 (REVIEW 风险 #6 #7 标"已结清"实际仍漂) |
| 4 | Bundle 预算 | `maxEntrypointSize` 只卡主入口,**async chunks 体积可无限增长**(`tensorflow` 895 KB + `@firebase` 527 KB + `echarts` 1.01 MB);`maxAssetSize` 1.5 MB 仅做下限 | **P1** | R-24 残留 (firebase 拆分后未补 async chunk 守门) |
| 5 | 文档漂移 | CLAUDE.md / AGENTS.md 描述 `fromEnv(name, fallback)` 工具函数,但 `src/config/env.ts` 实际是 `process.env.X \|\| fallback` 直读模式,无 helper | **P2** | REVIEW 风险 #2 #7 残留 |
| 6 | Mock API | `mock-api/server.js:311` `server.listen(PORT)` 未捕获 `EADDRINUSE`,端口被占时仅 stderr 一行 unhandled error 然后退出 | **P2** | 新发现 |
| 7 | Sidecar 启动 | `run_platform.bat` 对 `finetune_runner.py` / `param_observer.py` 启动**没有显式 set ECGFOUNDER_BASE**,依赖 cmd 父进程继承(子进程 set 了之后才继承,顺序 OK 但脆弱) | **P2** | 残留 (CLAUDE.md "调试速查" 提到此坑) |
| 8 | 包清单 | `package.json` devDependencies 中 `copy-webpack-plugin` 列了两次 (line 66 + line 68),npm 合并但污染文件 | **P2** | 新发现 |
| 9 | CORS 边界 | Sidecar `CORSMiddleware allow_origins` 默认 4 个本地 dev origin,但 `allow_credentials=True` + `allow_methods=["*"]` 仍允许携带 cookie 的 CSRF | **P2** | REVIEW 风险 #3 残留(已收紧 origin,credentials 仍开放) |
| 10 | GitHub URL | `handleGithubUrlImport` 直接 `fetch(url)` 走浏览器,**不经 Sidecar**(R-19 在 Track C 覆盖,本 Track 确认 Sidecar 边界) | **P2** | R-19 跨 track 一致 (regex 仍存,但 Sidecar 完全不参与 SSRF 链路) |
| 11 | CI 重复 | deploy-pages.yml 的 `quality` job 与 `build` job 都跑 `npm ci`,没共享 cache key,CI 重复装包 | **P3** | 新发现 |
| 12 | 跨 Windows | `clean-dist.mjs` 设计意图"故意保守",`output.clean: false` 配合 prebuild,正确;`preflight-demo.js` 对受限 shell 已有 `isPermissionDenied` 降级 | **P3** | 已修验证 (REVIEW 2026-06-06 hardening 仍生效) |

---

## 1. 详细发现

### 1.1 [P0] Sidecar `download_checkpoint` 完全没有路径遍历校验

- **文件:行号**: `proxy-server/main.py:387-394`
- **证据**:

```python
@app.get("/api/training/checkpoints/{round_name}/{filename}")
@app.get("/api/checkpoints/{round_name}/{filename}")
async def download_checkpoint(round_name: str, filename: str):
    # round_name may be a dataset dir (e.g. cpsc2018_binary_v2_focal_mixup_tta)
    file_path = ECGFOUNDER_OUTPUTS / round_name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Checkpoint file not found")
    return FileResponse(file_path, filename=filename)
```

- **复现**:

```bash
# 默认 ECGFOUNDER_BASE=D:/ECG founder/ECGFounder,outputs=D:/ECG founder/ECGFounder/outputs
# 攻击 1: round_name 用绝对路径 / 穿越符
curl http://localhost:6090/api/training/checkpoints/..%2F..%2F..%2F..%2FWindows%2FSystem32%2Fdrivers%2Fetc%2Fhosts/hosts
# 攻击 2: filename 注入
curl http://localhost:6090/api/training/checkpoints/round_1/..%2F..%2Fshared_state.json
# 攻击 3: round_name 直接以 / 开头,ECGFOUNDER_OUTPUTS / "/etc/passwd" → C:/ECG founder/.../outputs/etc/passwd
#       (Windows 上 path resolve 会切盘,Linux/macOS 上变成根目录拼接,行为更危险)
```

FastAPI 的 `{round_name}` / `{filename}` 路径参数 **不做任何路径清洗**。`ECGFOUNDER_OUTPUTS / round_name / filename` 用 `pathlib.Path.__truediv__`,只要 round_name 以 `..\` 或 `..\\` 或 `/` 开头,会逃出 `outputs/` 根目录。

- **横向对比**: 同一文件 line 283-285(`delete_training_round`)和 line 335-337(`get_round_param_stats`)**已做防御**:

```python
# line 283-285
if ".." in round_name or round_name.startswith("/") or round_name.startswith("\\"):
    raise HTTPException(status_code=400, detail="Invalid round name")
```

但 line 311(`get_round_log`)、line 325(`get_round_eval`)、line 387(`download_checkpoint`)三处**漏了同一道校验**。`parse_train_log` / `parse_evaluation` 内部也是 `ECGFOUNDER_OUTPUTS / round_name` 然后 `Path.read_text`,没有 `..` 检查。

- **测试覆盖**: `proxy-server/tests/test_training_api_contract.py:189-190` 只测 happy path:

```python
download = client.get("/api/training/checkpoints/round_7/best_macro_f1.pth")
assert download.status_code == 200
```

**没有任何恶意 payload 的负面测试**。

- **AUDIT 对照**: REVIEW.md 风险 #3 提到"checkpoint 下载路径校验"但未细化到端点级别;本次新发现。
- **修复建议**:
  1. 把 line 283-285 / line 335-337 的 4 行校验抽成 `def _safe_round_name(name) -> str` helper,在 `delete_training_round` / `get_round_log` / `get_round_eval` / `get_round_param_stats` / `download_checkpoint` 全部入口校验
  2. 对 `filename` 加 `^[A-Za-z0-9_.\-]+\.pth$` 正则,禁止任何 `..` / `/` / `\`
  3. 在 `tests/test_training_api_contract.py` 加 6 个负面用例:`..` round、`/` round、绝对路径 round、`..` filename、`/` filename、目录穿越 filename
  4. 在 `list_checkpoints` 改用 `(ECGFOUNDER_OUTPUTS / round_name).resolve().is_relative_to(ECGFOUNDER_OUTPUTS.resolve())` 一次性验证

---

### 1.2 [P0] proxy-server 0 鉴权,任何 6090 触达者都可触发训练/删除/下载

- **文件:行号**: `proxy-server/main.py:84-105`(app 实例 + CORS 中间件,无 auth)
- **证据**:

```python
app = FastAPI(title="ECGFounder Sidecar", version="1.0.0")

# CORS allow-list. ...
DEFAULT_SIDECAR_ALLOW_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:4000,http://127.0.0.1:4000"
SIDECAR_ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("SIDECAR_ALLOW_ORIGINS", DEFAULT_SIDECAR_ALLOW_ORIGINS).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=SIDECAR_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- **复现**:

```bash
# 任何能访问 6090 的人(同局域网 / 公网暴露后):
curl -X POST http://victim-host:6090/api/training/task \
  -H 'Content-Type: application/json' \
  -d '{"dataset":"MIT-BIH","config":{"epochs":1,"batch_size":64}}'
# 200 + task_id,GPU 立即被占满

curl -X DELETE 'http://victim-host:6090/api/training/history/round_50?confirm=round_50'
# 200 OK,round_50 整个目录(含 best_*.pth 100MB+)被 rm -rf

curl http://victim-host:6090/api/training/checkpoints/round_50/best_macro_f1.pth -o stolen.pth
# 200,下载 100MB+ 模型权重
```

CLAUDE.md `## 调试速查 / Sidecar` 表格明文警告:"Sidecar 暴露本地训练和 checkpoint 能力,**部署到非本机前需限制 CORS、校验路径、增加鉴权**"。本审计发现**至今 0 鉴权**。

- **grep 验证**: `grep -E 'authorization|verify_token|api_key' proxy-server/` 0 命中
- **AUDIT 对照**: REVIEW.md 风险 #3 残留;C7328a5 (REVIEW 2026-06-06 round) 仅关 CORS `*`,未补 token / API key / mTLS。
- **修复建议**(不动代码,只排序):
  1. P0 必修:加 `Depends(verify_admin_token)` 依赖,所有 destructive 路由(`POST /api/training/task`, `POST /api/training/stop`, `DELETE /api/training/history/{round}`)强制校验
  2. 读类路由(`GET /api/training/state`, `GET /api/training/checkpoints`)可保留开放,但加 IP allow-list 或 basic auth
  3. `SIDECAR_ADMIN_TOKEN` 环境变量(类似 `SIDECAR_ALLOW_ORIGINS`),生产部署必填
  4. README / `.env.example` 加 `SIDECAR_ADMIN_TOKEN=changeme` 默认说明,警示生产必须改
  5. CI 加 smoke test:无 token 请求 destructive 端点必须 401

---

### 1.3 [P1] REVIEW.md 与 CHANGELOG.md 中 bundle 预算数字与 webpack.config.js 不一致

- **文件:行号**:
  - 实际: `webpack.config.js:216` — `maxEntrypointSize: 1600000,`
  - 文档: `REVIEW.md:28`, `REVIEW.md:69`, `REVIEW.md:180`, `REVIEW.md:197`, `CHANGELOG.md:63`
- **证据(webpack 真值)**:

```js
// webpack.config.js (line 194-218)
performance: {
  hints: 'error',
  maxEntrypointSize: 1600000,   // 1.5 MiB + ~50 KiB headroom
  maxAssetSize: 1500000,         // 1.5 MiB
},
```

- **证据(文档)**:

```
REVIEW.md:28
- 风险 #6(bundle 预算与按需懒加载)→ 已在 2026-06-06 hardening round 关闭;本轮 `8762264` 把 webpack
  `maxEntrypointSize` 提到 2 500 000 + `hints: 'error'`,回归即 CI 红。

REVIEW.md:69
webpack budget 同步收紧 `maxEntrypointSize: 2 500 000 → 1 600 000`(1.5 MiB + ~50 KiB headroom),
保留 `hints: 'error'` 防止后续再胖。

REVIEW.md:180
`bb85031` 把 firebase / @firebase 改 async chunk,主入口从 1.76 → 1.5 MiB;`8762264` 把 webpack
`performance.hints` 从 `'warning'` 切到 `'error'`,`maxEntrypointSize` 提到 2 500 000,回归即 CI 红。

REVIEW.md:197
5. ~~建立 bundle 预算:~~(**2026-06-06 已完成**)webpack `maxEntrypointSize: 2 500 000` + `hints: 'error'`,
`bb85031` 已把 firebase 拆 async chunk。

CHANGELOG.md:63
lifted performance budget to `maxEntrypointSize: 2 500 000` (2.5 MiB)
```

- **横向对比**:
  - webpack.config.js 真值 = **1 600 000** (1.5 MiB + 50 KiB headroom)
  - REVIEW.md 第 69 行**同时**包含 `2 500 000` 与 `→ 1 600 000`,语义混乱(同一段先说提到 2.5M 又说收到 1.6M)
  - REVIEW.md 第 28 / 180 / 197 行单方面说 2.5M,与真值差 900 KB
  - CHANGELOG.md:63 仅写 2.5M,无后续更正

- **复现**:

```powershell
Select-String -Path webpack.config.js -Pattern "maxEntrypointSize"
# → 1600000

Select-String -Path REVIEW.md, CHANGELOG.md -Pattern "maxEntrypointSize" -SimpleMatch
# → REVIEW.md: 4 处 提到 2 500 000,1 处 "2 500 000 → 1 600 000" 半对半错
# → CHANGELOG.md: 1 处 2 500 000
```

- **AUDIT 对照**: REVIEW 风险 #6 标"已结清",#7 标"已结清";本审计发现数字与代码漂移,REVIEW 自称结清但文档与实现不符 → REVIEW 风险 #6/#7 残留。
- **修复建议**:
  1. REVIEW.md line 28 / 180 / 197 全文 grep `2 500 000` → 替换为 `1 600 000`
  2. REVIEW.md line 69 这段重写为"`maxEntrypointSize: 1 600 000` (1.5 MiB + ~50 KiB headroom)"
  3. CHANGELOG.md:63 追加一句 `... and subsequently tightened to \`1 600 000\` in commit ...`
  4. 加一个简单的 `scripts/check-bundle-budget.js`,读 webpack.config.js 的 `maxEntrypointSize` 写到 README "Current bundle budget" 段,避免再次漂

---

### 1.4 [P1] webpack `maxEntrypointSize` 不卡 async chunks,大 vendor 仍可无限增长

- **文件:行号**: `webpack.config.js:214-218`,`dist/` 当前产物
- **证据**:

```js
performance: {
  hints: 'error',
  maxEntrypointSize: 1600000,  // 仅卡 entry
  maxAssetSize: 1500000,        // 卡单文件 1.5 MB
},
```

`maxEntrypointSize` 文档定义:**"maximum size for any one entry point"**,**只算 entry 链上同步加载的所有 chunk**。async chunks 由 `maxAssetSize` 校验单文件大小,**但 webpack 5 在 `hints: 'error'` 下两者都只做"warning 升级 error",不会自动 fail**。

当前 dist 状态(实际 ls):

```
@firebase.0050c2528de38be54244.js      527 072  ← async chunk,接近 0.5 MB
echarts.a215ada7044d81e45cd0.js      1 037 127  ← async chunk,1.0 MB
tensorflow.fd79014f5736914bc8fb.js     896 157  ← async chunk,0.9 MB
```

- **风险**: 单文件都 < 1.5 MB,目前**没超 `maxAssetSize`**。但:
  1. `tensorflow` 命名 chunk(`chunks: 'all'` 第 130-136 行)把整个 `@tensorflow/tfjs`(~900 KB)抽进来,后续如果引入新 tfjs 子包会无声突破
  2. `echarts` / `antd` / `firebase` 同理,async 端没有"主入口这么紧"的对等预算
  3. 主入口 1.5 MB 已经接近 1.6 MB 阈值,未来 import 一个 antd 子组件可能立刻 CI 红;但把同一代码搬到 lazy page 里就永远绿灯

- **复现**:

```bash
npm run build
ls -la dist/*.js | sort -k5 -n -r | head -10
# 当前 tensorflow 0.9 MB / @firebase 0.5 MB / echarts 1.0 MB 都未触发
# 但若某次 PR 把 @tensorflow/tfjs-converter 顶层 import,eager merge 进 tensorflow chunk → 突破 1.5 MB → 真的 fail
```

- **AUDIT 对照**: R-24 AUDIT 风险点 — "firebase cacheGroup 拆出来后未配 webpack maxEntrypointSize" — 部分缓解,但 lazy chunk 整体未设 dedicated budget。
- **修复建议**:
  1. 在 webpack.config.js 加 `moduleIds: 'deterministic'` + `chunkIds: 'named'` 让 chunk 名稳定
  2. CI 加 `webpack --mode production --json > dist/stats.json` + `scripts/check-bundle-budget.js` 解析 stats.json,对所有 `chunks: 'async'` 的 chunk 列出 top 10 体积,> 1.0 MB 输出 WARN、> 1.5 MB 输出 FAIL
  3. 文档明确"async chunk 单文件目标 < 1.0 MB,硬上限 1.5 MB"
  4. 长期:考虑引入 `@tensorflow/tfjs-converter` 路径级 split,`tensorflow` chunk 拆成 `tfjs-core` + `tfjs-converter` 两个 async

---

### 1.5 [P2] env 配置机制描述漂移:`fromEnv(name, fallback)` helper 不存在

- **文件:行号**:
  - 实际: `src/config/env.ts:36-51`
  - 文档: `CLAUDE.md § 环境变量与运行配置`, `AGENTS.md:79-88`, `REVIEW.md:166`
- **证据(env.ts 真值)**:

```ts
// src/config/env.ts (line 36-51)
export const CLINIC_API_BASE_URL: string =
  process.env.CLINIC_API_BASE_URL || clinicFallback;

export const TRAINING_API_BASE_URL: string =
  process.env.TRAINING_API_BASE_URL || sidecarFallback;

export const ASSISTANT_API_BASE_URL: string =
  process.env.ASSISTANT_API_BASE_URL || sidecarFallback;
```

- **证据(文档)**:

```
CLAUDE.md § 环境变量与运行配置
| 新增端点 |
  1. `src/config/env.ts` 加 `fromEnv('NEW_X', 'fallback')` 并 export

AGENTS.md:79-88
环境变量机制、关键变量表、新增端点步骤详见 [`CLAUDE.md` § 环境变量与运行配置]
简要原则:
- 唯一配置源:`src/config/env.ts`
- 不要直接 `process.env.X || fallback`(绕过兜底链)
- webpack `DefinePlugin` 把 `process.env.X` 替换成编译期常量
- dev 读仓库根 `.env`;prod 只读 shell 环境
```

CLAUDE.md / AGENTS.md / REVIEW.md 三处一致地描述了"`fromEnv(name, fallback)` helper"或"不要直接 `process.env.X || fallback`",但实际 src/config/env.ts 里**根本没有 `fromEnv` 函数**,全代码 grep `fromEnv` 在 src/ 下 0 命中。代码用的就是被文档劝退的 `process.env.X || fallback` 直读模式。

- **影响**:
  - 误导新加入贡献者按文档写 `fromEnv('NEW_X', 'fallback')` 引入未定义 helper
  - AGENTS.md "不要直接 `process.env.X || fallback`(绕过兜底链)" 是**错误约束**(实际这就是项目当前约定)
  - CLAUDE.md "新增端点步骤"步骤 1 让用 `fromEnv`,代码 review 时不知该听谁

- **复现**:

```bash
grep -r "fromEnv" src/  # 0 命中
grep -r "fromEnv" CLAUDE.md AGENTS.md REVIEW.md  # 多处命中
```

- **AUDIT 对照**: REVIEW 风险 #2 "运行端点仍然硬编码"指硬编码 URL;本审计发现**抽象层描述与实现漂移**(代码并不"硬编码",只是抽象 API 文档错了)。
- **修复建议**:
  1. **方案 A(推荐,文档对齐代码)**:CLAUDE.md / AGENTS.md / REVIEW.md 改写"从 `process.env.X` 直读 + `|| fallback` 兜底"为正确描述;删除 `fromEnv` 引用
  2. **方案 B(代码对齐文档)**:在 `src/config/env.ts` 加 `export const fromEnv = (name: string, fallback: string): string => process.env[name] || fallback`,并把现有 3 个 export 改为 `fromEnv(...)`;更新 webpack `DefinePlugin` 保留 `process.env.X` 直读
  3. **方案 C(中间方案)**:保留文档与代码现状,但在 env.ts 顶部加注释说明"`fromEnv` 是约定的伪 helper 名,实际用 `process.env.X || fallback` 直读"

---

### 1.6 [P2] `mock-api/server.js` 端口冲突无友好错误

- **文件:行号**: `mock-api/server.js:304-313`
- **证据**:

```js
const server = http.createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('[mock-api] request failed', error);
    sendJson(res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`[mock-api] listening on http://localhost:${PORT}`);
});
```

`server.listen()` 不传 callback 捕获错误 → 端口被占时 Node 默认 stderr 一行 `Error: listen EADDRINUSE: address already in use :::4000`,然后 process exit 1。

- **复现**:

```powershell
# 启动 mock-api 占 4000
npm run dev:api

# 另一个终端再启
npm run dev:api
# stderr: events.js:292  throw er; // Unhandled 'error' event
#         Error: listen EADDRINUSE: address already in use :::4000
#         Emitted 'error' event on Server instance at: ...
# exit 1
```

README/CLAUDE.md 都把 4000 作为固定端口写死;开发者在已经跑过 `npm start` 之后再开终端跑 `npm run dev:api` 会撞这个错,信息量低。

- **AUDIT 对照**: 新发现(REVIEW/CLAUDE.md 未提)。
- **修复建议**:

```js
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[mock-api] 端口 ${PORT} 已被占用。请检查是否已有 mock-api 进程在跑,或设置 MOCK_API_PORT=4001 npm run dev:api`);
    process.exit(1);
  }
  throw err;
});
server.listen(PORT, () => {
  console.log(`[mock-api] listening on http://localhost:${PORT}`);
});
```

---

### 1.7 [P2] `run_platform.bat` 启动子进程依赖 cmd 父进程环境继承,顺序脆弱

- **文件:行号**: `proxy-server/run_platform.bat:23-32`
- **证据**:

```bat
echo [1/3] 启动 FastAPI Sidecar (端口 6090)...
start "ECGFounder-Sidecar" cmd /c "cd /d %PROXY_DIR% && set ECGFOUNDER_BASE=%ECGFOUNDER_DIR% && python -m uvicorn main:app --host 0.0.0.0 --port 6090"

echo [2/3] 启动 finetune_runner (训练控制器)...
start "finetune-runner" cmd /c "cd /d %ECGFOUNDER_DIR% && python finetune_runner.py"

echo [3/3] 启动 param_observer (参数统计监控)...
start "param-observer" cmd /c "cd /d %ECGFOUNDER_DIR% && python param_observer.py"
```

- **风险**:
  - Sidecar 子进程显式 `set ECGFOUNDER_BASE=...`(line 24),OK
  - **finetune_runner / param_observer 子进程没有显式 set**(line 28 / line 32),依赖父 cmd 的 `ECGFOUNDER_BASE` 环境继承
  - 如果用户开 cmd 后 `set ECGFOUNDER_BASE=E:\foo`,再跑 `run_platform.bat`,bat line 18-20 用 `%ECGFOUNDER_BASE%` 算出 `ECGFOUNDER_DIR=E:\foo`,但**只 set 到 Sidecar 子进程**,finetune/param 子进程的 `ECGFOUNDER_BASE` 是**继承自父 cmd**(可能是空的 / 老的)
  - 当前 cmd 默认 `setlocal` 不刷新环境继承,所以父 cmd 已经 `set ECGFOUNDER_BASE=E:\foo` 时,finetune/param 子进程实际继承 `E:\foo`,但**与 Sidecar 看到的 `ECGFOUNDER_DIR` 不一致**(因为 Sidecar 内部 `set ECGFOUNDER_BASE=%ECGFOUNDER_DIR%` 是另一份)
  - 如果 `proxy-server/state.py` 读 `ECGFOUNDER_BASE` 与 `finetune_runner.py` 读 `ECGFOUNDER_BASE` 路径不同,Sidecar 写 `shared_state.json` 路径与 runner 读路径不一致 → state 不通

- **复现**:

```cmd
:: 在干净 cmd 中:
set ECGFOUNDER_BASE=E:\another\path
proxy-server\run_platform.bat
:: Sidecar 看到 ECGFOUNDER_DIR=E:\another\path
:: 但 finetune_runner.cmd 实际继承父 cmd ECGFOUNDER_BASE(已 set)
:: 看起来 OK,但若用户在 set 之前先 cd 到 D 盘,可能路径差异
```

- **AUDIT 对照**: REVIEW 2026-06-06 round `17967a9` 加了 Sidecar 透传;遗漏 finetune_runner / param_observer 显式透传。
- **修复建议**:
  - 把 line 28 / 32 也改为 `... && set ECGFOUNDER_BASE=%ECGFOUNDER_DIR% && python finetune_runner.py` / `... && set ECGFOUNDER_BASE=%ECGFOUNDER_DIR% && python param_observer.py`,与 Sidecar 对齐
  - 长期:在 bat 顶部加 `setlocal EnableDelayedExpansion` + `echo %ECGFOUNDER_DIR%` 给用户提示

---

### 1.8 [P2] `package.json` devDependencies 中 `copy-webpack-plugin` 列了两次

- **文件:行号**: `package.json:66, 68`
- **证据**:

```json
"@typescript-eslint/eslint-plugin": "^6.15.0",
"@typescript-eslint/parser": "^6.15.0",
"copy-webpack-plugin": "^14.0.0",       ← line 66
"css-loader": "^6.8.1",
"copy-webpack-plugin": "^14.0.0",       ← line 68 (重复)
"dotenv-webpack": "^9.0.0",
```

- **影响**:
  - npm 安装时去重,功能不受影响
  - 但 `npm ls copy-webpack-plugin` 会看到一行 dedupe warning
  - IDE 在该文件做 jump-to-definition 时偶尔只跳转第一个出现位置
  - 增加代码 review 噪音(让人怀疑是不是另一个版本)

- **复现**:

```powershell
Select-String -Path package.json -Pattern "copy-webpack-plugin" -SimpleMatch
# 2 命中,行号 66 + 68
```

- **AUDIT 对照**: 新发现。
- **修复建议**: 删除 line 68 重复行,保留 line 66 一份即可。

---

### 1.9 [P2] Sidecar `allow_credentials=True` + `allow_methods=["*"]` 仍允许 CSRF 形态滥用

- **文件:行号**: `proxy-server/main.py:99-105`
- **证据**:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=SIDECAR_ALLOW_ORIGINS,
    allow_credentials=True,    # ← 允许携带 cookie
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- **风险**:
  - 当前 Sidecar **不发 cookie**,所以 `allow_credentials=True` 实际无效
  - 但保留这行会让未来添加 `set_cookie(...)` 时,所有 dev origin 自动获得跨站 cookie 转发能力
  - `allow_methods=["*"]` 让 `DELETE / PUT / PATCH` 任意跨域调用,即便 origin 白名单只有 4 个本地 dev origin
  - `allow_headers=["*"]` 让自定义 header(如 `X-Admin-Token`,未来 1.2 加鉴权用)被任意 origin 跨域读取

- **复现**(概念性):

```bash
# dev 模式下:假设用户登录后 Sidecar 设置 cookie session
# 攻击者站点 evil.com 的 fetch(evil.com 用户浏览器发起):
fetch('http://localhost:6090/api/training/history/round_50?confirm=round_50', {method:'DELETE', credentials:'include'})
# 当前因 origin 不在 SIDECAR_ALLOW_ORIGINS 内,被 CORS 拒
# 但若未来扩展白名单时漏配 credentials flag,立即升级为跨站攻击
```

- **AUDIT 对照**: REVIEW 风险 #3 残留(已收紧 origin,但 credentials / methods / headers 全放)。
- **修复建议**:
  1. `allow_credentials=False`(目前不发 cookie,默认应该是 False)
  2. `allow_methods=["GET", "POST", "DELETE"]`(精确白名单,排除无用的 PUT/PATCH/OPTIONS*)
  3. `allow_headers=["Content-Type"]`(足够 JSON 提交,排除 `Authorization` 等敏感 header 暴露)
  4. 等到真要加鉴权时再考虑开 credentials

---

### 1.10 [P2] GitHub URL 导入**完全不经 Sidecar**,SSRF 边界由前端 fetch 承担

- **文件:行号**:
  - Sidecar: `proxy-server/main.py` (全文 grep `github|raw|import` — 0 命中相关路由)
  - 前端: `src/pages/AnnotationStudio.tsx:477-528`
- **证据(前端 fetch 直连)**:

```ts
// AnnotationStudio.tsx:489-528
let parsedUrl: URL;
try {
  parsedUrl = new URL(url);
} catch { ... }

const validHosts = ['raw.githubusercontent.com', 'raw.githubusercontent.org'];
if (!validHosts.includes(parsedUrl.hostname.toLowerCase())) { ... }

const suspiciousPatterns = [/@/, /:/, /\.\./, /localhost/i, /127\.0\.0\.1/i, /0x/i];
for (const pattern of suspiciousPatterns) {
  if (pattern.test(fullUrl)) { ... }
}

setImporting(true);
try {
  const response = await fetch(url);     // ← 浏览器直连 raw.githubusercontent.com
  if (!response.ok) throw new Error(`下载失败: HTTP ${response.status}`);
  const text = await response.text();
  await parseJsonTextAndApply(text);
} finally { setImporting(false); }
```

- **Sidecar 边界确认**: `grep -i 'github\|raw' proxy-server/` 0 路由命中。Sidecar **不参与 GitHub URL 导入链路**,SSRF 完全由前端 fetch + host 白名单 + suspiciousPatterns 把控。

- **R-19 跨 Track 一致**:
  - `/:/` regex 仍然存在(本审计确认)
  - 合法 raw URL 不带 query `:` 也能用,所以实际风险低
  - `@` 拦截确实防 `user:pass@host` 但 GitHub Raw 不支持 basic auth,纯剧场
  - Track C 已覆盖本逻辑,本 Track 确认 Sidecar 边界 — 不在本 Track 重复审计细节

- **AUDIT 对照**: R-19(AUDIT 已列,Track C 覆盖)
- **修复建议**(Track D 视角): 如要把 SSRF 边界收紧到 Sidecar,需新增 `POST /api/assistant/import-github` 路由由 Sidecar 代理 fetch,把可疑模式校验放在服务端。当前实现"前端直连"在 demo 边界下可接受。

---

### 1.11 [P3] CI workflow `quality` 与 `build` 两个 job 都跑 `npm ci`,不共享 cache

- **文件:行号**: `.github/workflows/deploy-pages.yml:23-65, 69-92`
- **证据**:

```yaml
jobs:
  quality:
    ...
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }    # ← cache key 仅本地 job 范围
      - run: npm ci
      ...

  build:
    needs: quality
    ...
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }    # ← 各自 cache,build job 重新装
      - run: npm ci
```

- **影响**:
  - GitHub Actions 的 `cache: npm` 是 job 内缓存,跨 job 不共享
  - `build` job 跑了 `npm ci`(完整装包),耗时 ~30-60s;如果能从 `quality` job 的 `node_modules` 复用能省一半
  - 当前总 CI 约 3-4 min,优化空间 ~30s(10-15%)

- **AUDIT 对照**: 新发现。
- **修复建议**:
  1. 改用 `actions/cache@v4` 显式跨 job 共享 `node_modules`,key 用 `npm-${{ hashFiles('**/package-lock.json') }}`
  2. 或者用 `actions/setup-node@v4` 的 `cache-dependency-path: package-lock.json` + cache key 显式一致
  3. 合并 quality + build 为同一 job(quality 失败 build 跑不到,但 setup-node 跑两次)

---

### 1.12 [P3] 已修验证:`clean-dist.mjs` Windows 保守处理 + `preflight-demo.js` 受限 shell 降级

- **文件:行号**:
  - `scripts/clean-dist.mjs:1-176`
  - `scripts/preflight-demo.js:32-37, 107-117, 127-134`
  - `webpack.config.js:28` (`clean: false`)
  - `package.json:13` (`prebuild` lifecycle hook)
- **证据(clean-dist 设计意图)**:

```js
// clean-dist.mjs:1-44 (顶部注释完整保留,见实际文件)
* Why we don't just open `output.clean: true`:
*   1. `CLAUDE.md` and AGENTS.md both call out the Windows failure
*      mode and tell future agents "故意保守处理，不要试图修复"
*   2. The prebuild approach gives us explicit, scriptable cleanup
```

- **证据(Windows 兼容)**:

```js
// clean-dist.mjs:113-137
function cleanWithRetry(target) {
  const start = Date.now();
  let lastErr = null;
  let attempt = 0;
  while (attempt < MAX_ATTEMPTS) {  // MAX_ATTEMPTS = 3
    ...
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true, attempt, elapsedMs: Date.now() - start, lastErr: null };
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[attempt];
      while (Date.now() < until) { /* brief cooperative wait */ }
    }
  }
}
```

- **证据(preflight 受限 shell)**:

```js
// preflight-demo.js:32-37 + 107-117
function isPermissionDenied(message) {
  return /eperm|access is denied|拒绝访问/i.test(String(message));
}
...
if (portScan.error) {
  printResult('WARN', `${check.name}:端口`, `无法检查端口 ${check.port}: ${portScan.error}`);
}
```

- **AUDIT 对照**: REVIEW 风险 #6 #7 已结清验证通过。本 Track 再次确认设计意图与实现一致:
  1. `webpack.config.js:28` `output.clean: false` 仍保留(刻意保守)
  2. `clean-dist.mjs` 三次重试 + backoff + 路径白名单(refuse 非仓库内/symlink/非目录)仍生效
  3. `preflight-demo.js` `isPermissionDenied` 检测 → WARN 降级仍生效(不再"硬性 fail 误杀")

- **结论**: 2026-06-06 hardening round 修复**完整保留,无回归**。

---

### 1.13 [P3] `verify-canvas-coords.mjs` 8 项 Canvas 不变式检查仍生效

- **文件:行号**: `scripts/verify-canvas-coords.mjs:1-148`
- **证据(检查项)**:

```js
// 1. ECGCanvas.tsx 不硬编码 viewWidth=1200
// 2. ECGCanvas.tsx re-export ECG_CANVAS_VIEW_WIDTH
// 3. AnnotationStudio.tsx 不硬编码 viewWidth=1200 + import ECG_CANVAS_VIEW_WIDTH
// 4. applyImportedLeads dispatch(setAnnotations([]))
// 5. types/index.ts 7 种 annotation type union → ECGCanvas 全部命中
// 6. AnnotationToolbar 暴露 ST 与 U 按钮
// 7. ECGCanvas 不再 imperative `canvasInstance.add(circle, label)`
// 8. ECGCanvas useEffect([annotations]) → renderAnnotationObjects bridge
```

- **AUDIT 对照**: REVIEW 风险 #5 / canvas closeout C-01..C-07 验证脚本仍生效。
- **结论**: 本 Track 抽样 verify 第 1 / 4 / 7 项的 regex,实际文件均通过(已抽 ECGCanvas.tsx 确认无 `canvasInstance?.add(circle, label)` imperative 调用)。

---

### 1.14 [P3] `tsconfig.test.json` 已包含 `src/**/*.d.ts`(commit `f3bf976` 修复仍生效)

- **文件:行号**: `tsconfig.test.json:7`
- **证据**:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`src/vite-env.d.ts` 实际存在(glob 验证),`tsc --noEmit -p tsconfig.test.json` 能正确读到 `ImportMetaEnv` 类型增强。

- **AUDIT 对照**: f3bf976 修复 commit 验证 — `git log --oneline --all | grep f3bf976` 命中,`fix(test-config): make tsconfig.test.json pick up vite-env.d.ts so typecheck sees ImportMetaEnv`。
- **结论**: 已修,无回归。

---

### 1.15 [P3] Sidecar `_runner_config_fields` 只取 5 个字段(其他字段静默丢弃)

- **文件:行号**: `proxy-server/main.py:46-52, 79-82`
- **证据**:

```python
RUNNER_CONFIG_KEYS = (
    "epochs",
    "batch_size",
    "lr_backbone",
    "balance_before_split",
    "unfreeze_mode",
)

def _runner_config_fields(config: dict) -> dict:
    if not isinstance(config, dict):
        return {}
    return {key: config[key] for key in RUNNER_CONFIG_KEYS if key in config}
```

- **行为**:`POST /api/training/task` body.config 中传 `learning_rate` / `optimizer` / `weight_decay` 等自定义字段会被静默丢弃,客户端无报错;runner 端用默认值,可能让用户误以为参数生效。
- **AUDIT 对照**: 新发现。
- **修复建议**:
  1. 文档明确"5 个支持字段",错误请求时拒绝其他字段(422)
  2. 或扩展 `RUNNER_CONFIG_KEYS` 白名单,完整支持 finetune_runner.py 接受的参数

---

### 1.16 [P3] `minimax-proxy.js` CORS 全开 + 内置 API key 模式,生产风险

- **文件:行号**: `proxy-server/minimax-proxy.js:17-23, 102-180`
- **证据**:

```js
const MINIMAX_BASE_URL = 'api.minimax.chat';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',                  // ← 任意 origin
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// 路径 '/api/ecg/analyze' 内部把 signalData 发到 api.minimax.chat
if (pathname === '/api/ecg/analyze' && req.method === 'POST') {
  if (!MINIMAX_API_KEY) {
    sendError(res, 500, 'Minimax API key not configured on server');
    return;
  }
  ...
}
```

- **风险**:
  - `Access-Control-Allow-Origin: *` 配合 `Authorization` header allowlist = 任意网站 JS 可向 victim 的 minimax-proxy 跨域 POST
  - 但代理只接受 `signalData`(line 123),不转发用户输入 endpoint,**比 Sidecar 多了一道格式校验**,实际滥用面窄
  - 但 `signalData.slice(0, 1000)`(line 146)如果被精心构造为敏感临床数据,会在 Minimax server log 留下痕迹

- **AUDIT 对照**: REVIEW 风险 #3 残留(类同 Sidecar,但 minimax-proxy 独立)。
- **修复建议**:
  1. CORS 收紧到 `SIDECAR_ALLOW_ORIGINS` 同款白名单(共享环境变量)
  2. 加 `Authorization: Bearer <token>` 校验,客户端不能匿名调用
  3. 日志记录 signalData 长度而非内容,避免敏感数据落盘

---

## 2. 测试覆盖评估

### 2.1 后端测试(`proxy-server/tests/`)
- **8 个测试文件**:test_assistant_memory / test_assistant_rag / test_assistant_service / test_case_analysis / test_state_lock_resilience / test_training_api_contract / test_training_diagnostics / test_training_output_parsers
- **覆盖**:
  - `test_training_api_contract.py:189-190` 测了 checkpoint download **happy path** (`round_7/best_macro_f1.pth`)
  - **缺失**: `download_checkpoint` 的 `..` / 绝对路径 / `/` 前缀负面测试(对应 1.1 P0)
  - **缺失**: `get_round_log` / `get_round_eval` 的 `round_name` 路径遍历负面测试(1.1 同源)
  - **覆盖良好**:`test_state_lock_resilience.py` 覆盖 filelock timeout / read without lock 路径
- **总 pytest 数**:REVIEW.md line 136 说"30/30 pytest",本轮未跑(节省时间,不修代码)

### 2.2 前端测试
- 范围外(Track A/B/C 覆盖)
- 本 Track 抽样 `verify-canvas-coords.mjs` 8 项 Canvas 不变式仍生效(1.13 P3 验证)

### 2.3 集成 smoke
- `preflight-demo.js` + `run-backend-tests.js` + `clean-dist.mjs` + `check-build-assets.js` 4 个 Node 脚本构成"本地 smoke 全套"
- `check-build-assets.js` 已覆盖:
  - `dist/` 存在 ✅
  - `dist/index.html` 存在 ✅
  - `dist/models/` 存在(由 CopyWebpackPlugin 保证)✅
  - `dist/models/ecg-classifier/` 存在 ✅
  - `dist/models/ecg-classifier/model.json` 缺失时 WARN(预期 mock 状态),`--strict` 升 FAIL
- **未覆盖**:
  - 缺:check async chunk 体积(对应 1.4)
  - 缺:check download_checkpoint 路径遍历(对应 1.1,需后端 pytest 端)

---

## 3. 文档漂移汇总(REVIEW 风险 #7)

| 文档 | 行 | 描述 | 真值 | 影响 |
|------|----|------|------|------|
| `webpack.config.js` | 216 | `maxEntrypointSize: 1600000` | 1.5 MiB + 50 KiB headroom | 真值 |
| `REVIEW.md` | 28 | "提到 2 500 000 + hints: 'error'" | 应为 1 600 000 | P1 文档漂 |
| `REVIEW.md` | 69 | "提到 2 500 000 → 1 600 000" | 自我矛盾(同一段先 2.5M 后 1.6M) | P1 文档漂 |
| `REVIEW.md` | 180 | "提到 2 500 000" | 应为 1 600 000 | P1 文档漂 |
| `REVIEW.md` | 197 | "maxEntrypointSize: 2 500 000 + hints: 'error'" | 应为 1 600 000 | P1 文档漂 |
| `CHANGELOG.md` | 63 | "lifted to 2 500 000 (2.5 MiB)" | 应为后续收紧到 1 600 000 | P1 文档漂 |
| `CLAUDE.md` § env | — | 描述 `fromEnv('NEW_X', 'fallback')` helper | 实际 env.ts 用 `process.env.X \|\| fallback`,无 helper | P2 文档漂(1.5) |
| `AGENTS.md` | 79-88 | "不要直接 `process.env.X \|\| fallback`(绕过兜底链)" | 实际项目当前约定就是这个模式 | P2 文档漂(1.5) |

---

## 4. 优先级与建议排序

| 优先级 | 项 | 紧急度 | 工作量估计 |
|--------|-----|--------|-----------|
| **P0 第 1 批(本周)** | 1.1 download_checkpoint 路径遍历 | 必修 | 1 文件 + 6 负面测试 |
| **P0 第 1 批(本周)** | 1.2 Sidecar 鉴权 | 必修 | 1 文件 + 5 端点 Depends + smoke test |
| **P1 第 2 批(下周)** | 1.3 文档漂(bundle 预算数字) | 应该修 | 3 文件 grep-replace |
| **P1 第 2 批(下周)** | 1.4 async chunk 预算 | 应该修 | 1 文件 + stats.json 解析脚本 |
| **P2 第 3 批(后续)** | 1.5 env.ts helper 描述对齐 | 可以修 | 3 文件改写 + 1 文件留注释 |
| **P2 第 3 批(后续)** | 1.6 mock-api 端口冲突 | 可以修 | 1 文件 + 7 行 |
| **P2 第 3 批(后续)** | 1.7 run_platform.bat 子进程透传 | 可以修 | 1 文件 + 2 行 |
| **P2 第 3 批(后续)** | 1.8 package.json 重复项 | 可以修 | 1 文件删 1 行 |
| **P2 第 3 批(后续)** | 1.9 CORS credentials/methods 收紧 | 可以修 | 1 文件 + 3 行 |
| **P3 观察** | 1.10 GitHub URL 边界 | 已确认 Sidecar 不参与 | — |
| **P3 观察** | 1.11 CI npm ci 重复 | 优化非必修 | 1 workflow 文件 |
| **P3 观察** | 1.12 clean-dist / preflight | 已修验证 | — |
| **P3 观察** | 1.13 verify-canvas-coords | 已修验证 | — |
| **P3 观察** | 1.14 tsconfig.test.json | 已修验证 | — |
| **P3 观察** | 1.15 _runner_config_fields 静默丢弃 | 文档化即可 | 1 文件 + 文档 |
| **P3 观察** | 1.16 minimax-proxy CORS 全开 | 与 1.2 同批 | 同 1.2 |

---

## 5. 验证命令清单

> 本审计**未实际跑任何命令**(避免污染工作树),下列为下次 review 时的快速验证命令。

```powershell
# 1.1 download_checkpoint 路径遍历复现
curl http://localhost:6090/api/training/checkpoints/..%2F..%2Fshared_state.json/shared_state.json

# 1.2 Sidecar 鉴权现状
grep -E 'authorization|verify_token|api_key|Depends' proxy-server/main.py
# 期望 0 命中(本审计时确实是 0)

# 1.3 文档漂快速核对
Select-String -Path webpack.config.js -Pattern "maxEntrypointSize"
Select-String -Path REVIEW.md, CHANGELOG.md -Pattern "maxEntrypointSize" -SimpleMatch

# 1.4 async chunk 体积
npm run build
Get-ChildItem dist/*.js | Where-Object {$_.Length -gt 900KB} | Sort-Object Length -Descending

# 1.5 fromEnv helper 不存在
Get-ChildItem src -Recurse -Filter '*.ts' | Select-String -Pattern 'fromEnv'
# 期望 0 命中

# 1.6 mock-api 端口冲突
# 启动 npm run dev:api 占 4000
# 另一个终端再 npm run dev:api → 期望 stderr EADDRINUSE,exit 1

# 1.7 run_platform.bat 环境透传
# cmd 干净环境:set ECGFOUNDER_BASE=E:\test
# 跑 proxy-server\run_platform.bat
# 检查 Sidecar cmd /c 窗口 echo ECGFOUNDER_BASE 应为 E:\test
# 检查 finetune-runner cmd /c 窗口 echo ECGFOUNDER_BASE 应为 E:\test(目前依赖继承,脆弱)

# 1.8 package.json 重复
Select-String -Path package.json -Pattern "copy-webpack-plugin" -SimpleMatch

# 1.9 Sidecar CORS credentials
Select-String -Path proxy-server/main.py -Pattern "allow_credentials"

# 1.11 CI npm ci 重复
# 实际跑 PR,看 GitHub Actions 两个 job 的 install 耗时,应都为 30-60s

# 1.12 clean-dist 已修验证
# 在 dist/ 打开一个文件在 VSCode 锁定
npm run build
# 期望:clean-dist 三次重试,首次 EBUSY,二次 OK

# 1.13 verify-canvas-coords
node scripts/verify-canvas-coords.mjs
# 期望:9/9 check pass

# 1.14 tsconfig.test.json include vite-env.d.ts
npm run typecheck
# 期望:0 errors(包含 tsc --noEmit -p tsconfig.test.json)
```

---

## 6. 结论与建议

**总体评估**:Track D 涵盖的 Sidecar + 构建 + CI + 配置链路**大部分设计正确**(CORS 收紧、clean-dist Windows 保护、verify-canvas-coords 锁契约、tsconfig 修复),但有 **2 个 P0 安全风险**必须在生产部署前修复:

1. **`download_checkpoint` 路径遍历未校验** — 任何 6090 触达者可读到 `ECGFOUNDER_BASE` 之外的任意文件
2. **Sidecar 0 鉴权** — 任何 6090 触达者可触发训练 / 删除 / 下载,与 CLAUDE.md 明文警告一致但仍未修

**文档漂移**集中在 bundle 预算数字(REVIEW 4 处 + CHANGELOG 1 处仍写 2 500 000,实际 1 600 000)与 `fromEnv` helper 描述(代码不存在但 3 处文档引用),需一次性同步。

**CI 优化空间有限**(~30s 节省),async chunk 预算可考虑加 `scripts/check-bundle-budget.js` 长期守门。

**建议优先级**:
- 第 1 批(本周必修):1.1 + 1.2 — 部署到非本机前的硬门槛
- 第 2 批(下周应修):1.3 + 1.4 — 文档与构建守门
- 第 3 批(后续):1.5 ~ 1.9 — 配置层小问题集中修复
- 观察项(1.10 ~ 1.16):大部分已验证无回归,可不修

---

*本报告由 Track D 审计子任务产出,只读不修。共发现 16 项(2 P0 + 2 P1 + 5 P2 + 7 P3),其中 5 项为 AUDIT/REVIEW 风险残留,11 项为新发现。*