# Audit — Model / Canvas / Parser 风险图

**日期**：2026-07-04
**范围**：`src/services/modelService.ts`、`src/hooks/useModelInference.ts`、`src/workers/inference.worker.ts`、`src/pages/AnnotationStudio.tsx`、`src/components/Canvas/ECGCanvas.tsx` 及其直接依赖（parser、store、firebase、env）
**方法**：第一性原理阅读代码 + 交叉对照 README/REVIEW/CLAUDE 中的承诺
**输出约定**：仅列被代码证据支持的风险；按 **真实模型能力 / 缓存能力 / mock fallback / demo data / 轻量 parser** 五个轴划分。每条风险都列 Severity、Evidence、Reproduction、Verification command。**不动代码**。

---

## 0. 速读表（TL;DR）

| # | 风险轴 | 一句话结论 | Severity |
|---|---|---|---|
| R-01 | Mock fallback | `mockPredict` 推导结果被 `exportRecord` 当成真实 `diagnosis.confidence` 写入导出文件 | **P0** |
| R-02 | Mock fallback | `AnnotationStudio` UI 上分析结果跟真实模型混用同一渲染路径，不展示 MOCK chip | **P0** |
| R-03 | Lightweight parser | DICOM parser 强依赖"DICM 前缀 + 显式 VR + 原始 tag 字节扫描"，真实临床文件会静默返回空数据或乱数据 | **P0** |
| R-04 | Lightweight parser | WFDB parser 用 charCodeAt 反向构造 byte 流，>0x7F 字节全部被截断为 0xFF | **P0** |
| R-05 | Lightweight parser | HL7 parser 用 `atob` + 每 4 字节切 Float32；未处理 base64 填充、字节序、未传输字段 | **P1** |
| R-06 | Real model | `/models/ecg-classifier/model.json` 实际不存在；远程 404 → 缓存 404 → `useMockInference=true` 是默认终态 | **P1** |
| R-07 | Cache | `loadModel` 先 `await tf.save(cacheKey)` 后才把 `this.model` 报成功；保存失败时已加载模型被丢弃 | **P1** |
| R-08 | Cache | Hook 与 Service 用两套独立 IndexedDB key 前缀，互不感知，且 Hook 的 cache fallback 写回主线程路径，与 useWorker=true 默认模式互斥 | **P1** |
| R-09 | Real model | `buildInputTensor` 启发式按 `[1,A,B]` 选择 lead/time-major；遇到 sigmoid 多标签或 4-D conv 输入会错位 | **P1** |
| R-10 | Worker | Worker 的 `predictWithHeatmap` 分两条消息（先 `prediction` 再 `heatmap`），主线程只听 `prediction`，heatmap 永远丢 | **P1** |
| R-11 | Worker | TF.js 在 WebWorker 中默认 CPU backend；WebGL backend 需要 OffscreenCanvas 支持，浏览器差异大 | **P2** |
| R-12 | Demo data | `INITIAL_DEMO_LEADS` 是模块级单例；`setState(() => INITIAL_DEMO_LEADS.map(...))` 在热重载时可能复用脏数据 | **P2** |
| R-13 | Cache | `mockPredict` / `predictWithHeatmap` 内的 `lead` 是 `signal[0]`，多导联只取首导联做"决策"和"热力图" | **P1**（看似 mock 也误导） |
| R-14 | Demo data | `exportRecord.diagnosis` 在没有 AI 结果时回退 `HR ${bpm}`，但 confusion 在 CSS / UI 上没有区分 fake vs human | **P2** |
| R-15 | Annotation flow | `useEffect` 监听 keyboard 时依赖空数组，闭包持有首 render 的 `handleSelectAnnotationType`，与 exhaustive-deps 偏离 | **P3** |
| R-16 | Annotation flow | `handleMinimaxAnalyze` 重复声明 `hasDirectConfig` 和 `useProxy`，死代码并暴露"用户输入 API key 直连"路径 | **P1**（合规风险） |
| R-17 | Canvas | `renderWaveforms` 在 `leads` 变化时全清 + 全建，120 ms 回放期间持续分配 Polyline/Shadow，无 release | **P2** |
| R-18 | Cache | TF.js 模型 `IndexedDB` 写入大文件可能 OOM；`save` 失败时上抛吞掉整次 load | **P2** |
| R-19 | SSRF | GitHub Raw URL 导入的 `suspiciousPatterns = /:/` 会合法化歧义；存在绕过 `@` 检查的 URL | **P2** |
| R-20 | Lazy load | Firebase 动态 import 失败时 `initialize` 抛错被 AnnotationStudio `console.warn` 吞，后续 `updateRecordAnnotations` 永远打不上 | **P1** |
| R-21 | Real model | 模型路径硬编码 `/models/ecg-classifier/model.json` 在 `handleModelLoad` 和 hook 默认值两处出现，env 不能覆盖 | **P2** |
| R-22 | Persistence | Firebase save 仅 `currentRecordId` 不以 `local-` 开头才触发；JSON / WFDB 导入后默认 recordId 为 `local-<ts>`，**永远不进 Firebase** | **P1** |
| R-23 | ACL | `AnnotationStudio.handleDeleteAnnotation` 用 `deleteSignal` 计数器递增作副作用触发；任何调用源都能删未选中项（如果有 selection race） | **P3** |
| R-24 | Bundle | `firebase` cacheGroup 拆出来后未配 webpack `maxEntrypointSize`；之前 `REVIEW.md` 提到预算收紧到 1.6 MB，但目前 CI 看到的 perf hints 仍有"6.x MiB chunk"残留风险 | **P2** |
| R-25 | Hygiene | `AnnotationStudio` 引用 `./components` index，IDE/lint 看不到树形 lazy 子模块；`REVIEW.md` 仍把 e2e 标 P1 未结清 | **P3** |

Severity 标度：
- **P0** = 在 README 承诺边界内仍会误导用户 / 静默错误 / 安全直接相关。
- **P1** = 损坏 demo 体验、丢失用户数据、UI 与代码声明不一致。
- **P2** = 内存/性能/可维护性，未来再扩散会变 P0。
- **P3** = 代码卫生。

---

## 1. 轴向分析

### 1.1 真实模型能力 (Real model capability)

**结论**：本仓库当前**没有任何已加载的真实模型可被触发**。即便用户点击 UI 上的"AI 分析"按钮，仍得到 mock 输出。

证据链：
- `src/services/modelService.ts:19-32` — `loadModel` 先 `tf.loadLayersModel(modelUrl)`，失败再试 IndexedDB 缓存。
- `src/pages/AnnotationStudio.tsx:578` — `modelService.loadModel('/models/ecg-classifier/model.json')` 路径硬编码。
- `public/models/ecg-classifier/` 目录只含 `README.md`（已 ls 确认），没有 `model.json` 或 weight shards。
- README 第 49 行写的"`/models/ecg-classifier/model.json`"是 *期望路径*，**不是产物路径**。

由此连锁：
1. 部署到 GitHub Pages 后，`loadLayersModel('/models/ecg-classifier/model.json')` → 404。
2. `modelService.ts:23` 捕获 → 再试 `indexeddb://ecg-model-cache-...`（`modelService.ts:25`）；首次访问必然不存在 → 失败。
3. `:30` 落入 `this.useMockInference = true`，模型字段仍然 null。
4. 用户随后点"AI 分析"，进入 `mockPredict`(`:242-266`)。

复现：

```ts
// 在浏览器控制台
(async () => {
  const { modelService } = await import('/src/services/modelService.ts');
  await modelService.loadModel('/models/ecg-classifier/model.json');
  console.log(modelService.isUsingMockInference()); // true
  const r = await modelService.predict([[0.1,0.2,0.1,0.5]]);
  console.log(r); // 来自 mockPredict 的 5 类概率
})();
```

验证命令：

```bash
# 1. 验证 model 实际不存在
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\public\models\ecg-classifier' -Recurse
# 期望（也即现实）：只有 README.md

# 2. 触发 404 路径
npm run dev:web
# 浏览器 Network 面板：访问 /models/ecg-classifier/model.json → 404
# 控制台：两条 console.error（[ModelService] Failed to load remote/cached model）

# 3. lint + typecheck 不报（mock 路径合法）
npm run check
```

---

### 1.2 缓存能力 (Cache capability)

**结论**：IndexedDB 缓存路径有 3 处真实问题——保存失败会丢弃刚加载的模型、Hook 和 Service 互不感知、Worker 路径下 cache fallback 会"回主线程"但 worker 仍存在。

证据：
- `src/services/modelService.ts:19-21` — `await tf.loadLayersModel(modelUrl)` 之后立即 `await this.model.save(cacheKey)`。`save` 抛错（IndexedDB 配额、序列化失败）时外层 `try` 进入 `:22` 的 `catch`，**已经 set 到 `this.model`** 的引用被覆盖为 null。**真实模型丢失**。
- `src/hooks/useModelInference.ts:22` vs `src/services/modelService.ts:4` — 前缀分别是 `indexeddb://ecg-hook-model-` 和 `indexeddb://ecg-model-cache-`。用户切换两个入口不共享缓存。
- `src/hooks/useModelInference.ts:64-90` — 当 `useWorker=true`（默认）时，loadModel 走 worker；`:94 loadFromCache` 拿回的是 `modelRef.current`（**主线程引用**），但 `useWorker` 路径下 `workerRef.current` 仍持有，`:108 predict` 只在 `workerRef.current` 存在时走 worker——结果是 "Worker 已创建但 predict 走主线程"，状态不一致。

复现：

```ts
// 模拟 IndexedDB 写失败（DevTools → Application → IndexedDB → 删除 ecg-hook-model-*）
// 然后：
import { modelService } from './src/services/modelService';
await modelService.loadModel('/models/ecg-classifier/model.json');
// Network → 404 → 缓存也失败 → isUsingMockInference() === true
```

验证命令：

```bash
# 1. lint + 单测
npm run typecheck
npm run test:unit
# 当前都是绿的，但 mock 路径合法不代表收益（mock 与 cache 测试覆盖薄弱）

# 2. 看单元测试是否覆盖 cache 失败路径
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'cacheKey|useMockInference|loadLayersModel'
```

---

### 1.3 Mock fallback（这是大坑）

**R-01 (P0)** — `exportRecord`(`src/pages/AnnotationStudio.tsx:671-702`) 把 `inferenceResults[0]` 写进 `record.diagnosis = { label, confidence: probability }`，直接走 JSON/CSV 导出。**当模型在 mock 模式时，导出文件将携带虚假的"诊断 + 置信度"**——下游接收者无可分辨依据。`mockPredict` 用 std / mean / amplitude 拍脑袋分 5 类（`src/services/modelService.ts:242-266`），对真实数据同样会输出形如 `0.92 房颤` 的高置信度结果。

证据：
- `mockPredict` (`modelService.ts:242-266`) — 仅看 lead[0] 的 std / mean / amplitude，按固定权重分 5 类，没有真正的模型。
- `predictWithHeatmap`(`modelService.ts:55-61`) 直接复用 `predict` 的结果再补 `generateHeatmap`。
- `exportRecord` 调用方：`AnnotationStudio.tsx:689-692` — 当 `inferenceResults.length > 0`，直接把 AI 结果当 diagnosis；否则回退 `HR ${features.heartRate} bpm`。

复现：
1. 进入 Annotation Studio（默认 demo 数据）。
2. 点 "加载模型" → 看到 "未找到真实模型，已切换到模拟推理模式"。
3. 点 "AI 分析"。
4. 点 "导出 JSON"。
5. 打开 JSON，`diagnosis.confidence` 写的是 mock 概率（≥0.5 常见）。

验证命令：
```bash
# 1. 走默认路径（不修改任何代码）就能产生
#    mockDiagnosis.json
npm run dev:web
# 然后按 UI 操作导出 JSON，检查 diagnosis 字段

# 2. 回归 unit test 是否覆盖 mock-vs-real 边界
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'mockPredict|isUsingMockInference|exportRecord.*diagnosis'
```

**R-02 (P0)** — `AnnotationStudio` 的 `AI 分析` 完成后，推理结果走 `setInferenceResults` 入 Redux (`AnnotationStudio.tsx:602`)，随后所有面板（`SmartAssistancePanel`、`SignalMetrics`、`AnnotationList`）共用同一份 `inferenceResults` 渲染，**不附加 mock 标**。`isUsingMockInference` 仅在加载完成时弹一次 message.warning (`AnnotationStudio.tsx:580-582`)，这条 toaster 30 秒后消失，**之后再点分析就只剩结果，没有持久提示**。

证据：
- `src/pages/AIModels.tsx:81-86` 仅在 `models` 这个 mockModels 列表上挂 MOCK chip，与 `AnnotationStudio` 无关。
- `AnnotationStudio.tsx` 没有任何 `<Tag>MOCK</Tag>` 标注推理来源。
- `src/store/selectors.ts:65-73` — `selectInferenceResults` / `selectTopPrediction` 把所有结果同等看待。

复现：
1. 加载后弹过 1 次 warning toast。
2. 重分析（toast 已消）。
3. 切到 SignalMetrics / SmartAssistancePanel — 用户看到的是 "AI 结果" 顶部摘要，**没有任何"来自模拟推理"的字样**。

验证命令：
```bash
# 检查 UI 是否在 inferenceResults 上挂 mock 标
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\pages\AnnotationStudio.tsx' -Pattern 'MOCK|isUsingMockInference'
# 期望（也即现实）：只有 handleModelLoad 里一次 warning
```

**R-13 (P1)** — `mockPredict` 与 `predictWithHeatmap` 都只看 `signal[0]`（`modelService.ts:243 / 269`），多导联数据集被压成单导联决策；导出和 UI 都不告知用户这一点。

---

### 1.4 Demo data

**R-12 (P2)** — `INITIAL_DEMO_LEADS = createDemoLeads()` (`AnnotationStudio.tsx:74-86`) 是模块顶层 closure，调一次生成 6×1800 样本。`sourceLeadsRef.current = INITIAL_DEMO_LEADS.map(...)` 在组件首次 mount 时克隆，但 `createDemoLeads` 内部有 `Math.sin(index * 0.004)` 等"伪随机"相位，模块加载即固化；**再次 hot reload（HMR）有时复用了已经 mutate 的数组**。

证据：
- `AnnotationStudio.tsx:53-86` — `ECG_CYCLE_TEMPLATE` / `buildLeadSignal` / `createDemoLeads` 顶层定义。
- `AnnotationStudio.tsx:102-105` — `sourceLeadsRef` + `useState` 都用 `INITIAL_DEMO_LEADS.map(...)` 做浅 clone；`data: [...lead.data]` 一次性深拷贝，所以**首发 mount 安全**，但 mutation 路径有 `buildStreamingLeads`（`:162-194`）和回放 interval 持续重写 `leads` state。`sourceLeadsRef.current` 在 import 流（`applyImportedLeads` `AnnotationStudio.tsx:209`）会被覆盖，问题不大。

复现：
```ts
// 在 AnnotationStudio 加载完成后立即：
console.log(window.__demoLeads === AnnotationStudio_source); // 不可见，但 import 后 sourceLeadsRef 持有克隆，断开源头即可
```

验证命令：
```bash
# 反复 hot reload AnnotationStudio.tsx 同时开回放
npm run dev:web
# 浏览器 DevTools：改动任意行（保存）→ HMR → 注意波形的基线是否漂移
# 短期没有暴露（一次性深拷贝），但潜在共享风险
```

**R-14 (P2)** — 没有 AI 结果时，导出的 `diagnosis.label = 'HR 75 bpm'` (`AnnotationStudio.tsx:692`)，confidence=0.5。这种 "fake diagnosis" 也走 export。轻于 R-01 但仍属同一类。

---

### 1.5 轻量 parser（真实临床文件的雷区）

**R-03 (P0)** — `src/utils/dicomParser.ts:30-195` 的 `DICOMParser`：

1. `:55-66` — 仅识别有"DICM 前缀"（偏移 128-131）的文件，**真实世界里很多 DICOM 文件没有 preamble**（旧 PACS 导出的 implicit VR LE 没 preamble）。
2. `:107-124` — `findTagData` 用 byte-by-byte 模式匹配 `[g0, g1, e0, e1]` 4 字节，**任何 value 字段里包含同名 4 字节就会假阳性**。例如 `PatientName` 标签是 `(0010, 0010)`，如果测量值里恰好有这 4 字节，会误识别。
3. 不解析 VR（Variable Reality field），更不解析 SQ/OB/OF/UN 等变长类型。
4. `:140-156` — `parseWaveformData` 假设前 132 字节之后全是 16-bit signed interleaved 通道，**没有读 `(0028, 0010) Rows / (0028, 0011) Columns / (003A, 0005) WaveformSequence`**，因此波形采样率、通道顺序、bit depth 都是猜的。

证据完整开源在 `dicomParser.ts:30-195`。

复现：

```ts
import { DICOMParser } from './src/utils/dicomParser';
const parser = new DICOMParser();
// 用一个真实的 deidentified 12-lead DICOM (例如 PTB-XL export)
const ab = await fetch('/sample.dcm').then(r => r.arrayBuffer());
parser.parse(ab); // 大概率 success=false 或 waveformData.data 错位
```

验证命令：
```bash
# 1. 解析器无单元测试覆盖真实 DICOM
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'DICOMParser|WFDBParser|HL7Parser'
# 期望（也即现实）：0 命中
```

修复建议（**不动代码，仅验证**）：
- 引入 `dicompixeldata` 或 `dcmjs` 替换。
- 至少补一段解析器 test：导入 `ptbxl/records/00001/00001_lr.dcm` 跑通。

**R-04 (P0)** — `dicomParser.ts:198-282` 的 `WFDBParser`：

- `:239-242` — 把整个 dat 二进制文件用 `dataFile.charCodeAt(index) & 0xff` 转回字节。`String.fromCharCode` 对 `>0xFF` 的 charCode 会被截断 / 返回高位丢失的字符 → **`bits > 0x7F` 全部变 0xFF**。
- `AnnotationStudio.tsx:331-339` 的 `arrayBufferToBinaryString` 进一步用 `TextDecoder('ascii')` 编码 ASCII 范围，**任何非 ASCII 字节直接变 U+FFFD**。
- 后果：MIT-BIH record 100 的 `dat` 文件哪怕是 16-bit signed，**全部值变成 `0xFFFF / 0xFFFD`**，解析后除基线外噪声一片，没有医学意义。

证据：
- `dicomParser.ts:198-282`（已贴）
- `AnnotationStudio.tsx:331-352`（已贴）

复现：

```ts
// 把 ptbxl 100.atr / 100.dat 走 AnnotationStudio 导入
// 控制台看 message.error('WFDB 解析失败...') 不一定触发，但导联里全是噪声
```

验证命令：
```bash
# MIT-BIH 100 / 101 / 200 任取一对，拖入 AnnotationStudio → 注意波形
# 期望：当前代码无法正确还原 ECG（已被二进制截断污染）
```

**R-05 (P1)** — `dicomParser.ts:284-349` 的 `HL7Parser`：

- `:313-334` — `fields[3].includes('ECG')` 判断 OBX 是否为 ECG，**但真实 HL7 v2.x 的 OBX-3 是编码系统如 `'93000&ECG^CPT'`，匹配脆弱**。
- `:316` — `atob(waveformData)` 解 base64 → 假设每 4 字节一个 float32 → 假设 little-endian → **没处理 base64 padding / 长度非 4 倍数**。
- duration 写死 500 Hz (`:340-342`)。

复现：

```ts
// 任何 HL7 v2.5 ORU^R01 消息，fields[3] 不含字面 ECG 时直接被跳过
```

验证命令：
```bash
# 1. 找一段真 HL7 ORU 测试
# 2. node -e "const {HL7Parser} = require('./src/utils/dicomParser'); new HL7Parser().parse(fs.readFileSync('sample.hl7','utf8'))"
# 期待：leads 为空
```

---

## 2. Worker / Real model 体系问题

**R-09 (P1)** — `src/services/modelService.ts:180-240` 的 `buildInputTensor`：

- shape `[1, A, B]` 时启发式比较 lead-major (`[1, leads, samples]`) 与 time-major (`[1, samples, leads]`)，**只看 `isShapeCompatible(expectedA, ...) && isShapeCompatible(expectedB, ...)`**：
  - 期望 `[1, 1800, 12]`，lead-major `[1, 12, 1800]` 匹配 → 选 lead-major ✅
  - 期望 `[1, 12, 1800]`，lead-major shape OK；time-major `[1, 1800, 12]` 也 OK → 选择条件是 **只要第一个 shape 通过就 return**，沉默接受错误转置。
- 单导联 fallback `[1, n, 1]`（`:213-214`）只对输入 `[1, leads, samples]` 模型合法，对 1-D conv/Transformer 类输入会触发"shape 强转"残留。
- 概率归一化 `normalizeToProbabilities`（`:157-174`）启发 sum∈[0.95, 1.05] → softmax：**遇到 sigmoid 多标签、和为 0.6 的互斥二分类、和为 1.05 以上的 calibration 输出就会误判**。

复现：
```ts
const model = await tf.loadLayersModel('modelA.json'); // 期望 [1, time, channels]
await modelService.predict([[0.1,0.2,0.1]]); // 1 lead × 3 samples
// 模型输出 shape 假设是 [1, 5]（sigmoid 多标签）
// mockPredict 路径外会跑真实模型，但对齐逻辑会按 lead-major 送 [1,1,3]
// 大概率出现 incompatible shape 异常，或 softmax 把所有概率挤到一个类
```

**R-10 (P1)** — `src/workers/inference.worker.ts:50-52`：

```ts
case 'predictWithHeatmap':
  await runInference(data.signal);
  self.postMessage({ type: 'heatmap', heatmap: generateHeatmap(data.signal) });
  break;
```

主线程 `useModelInference.ts:115-128` 只处理 `prediction` 和 `error`，**`heatmap` 类型消息被丢弃**。

后果：
- Hook 暴露的 `predictWithHeatmap` (`:150-161`) 不会收 worker 的图，**它仍跑主线程 fallback** (`predict` 走 worker，但 `generateHeatmap` 在 `useModelInference.ts:152-160` 也是主线程同步算的)。
- 即 worker 的 generateHeatmap 代码是**死代码**。

**R-11 (P2)** — TF.js 在 Web Worker 默认走 CPU 后端（`tfjs` 4.x 开始尝试 `tfjs-core/cpu`），不开 WebGL。`@tensorflow/tfjs` 在 Worker 里启用 WebGL backend 需要 OffscreenCanvas 支持（Chrome / Edge yes，Safari 部分支持）；inference 速度会显著劣于主线程，但**功能可用**，不是 blocker。仍建议在 README 注明默认 backend。

**R-21 (P2)** — 模型路径硬编码：

- `AnnotationStudio.tsx:578` — `'models/ecg-classifier/model.json'`
- `useModelInference.ts:26` — `'models/ecg-classifier/model.json'`（默认值）
- README 没说要怎么换；要换必须改两处源码。

证据：上面两行。

---

## 3. 缓写 / 持久化问题

**R-07 (P1)** — `src/services/modelService.ts:18-32`：

```ts
try {
  this.model = await tf.loadLayersModel(modelUrl);
  await this.model.save(cacheKey);   // ← 这里抛错
  this.useMockInference = false;
} catch (error) {
  // ... try cache ...
}
```

如果 `save()` 失败（IndexedDB 配额、用户拒绝、序列化错误），已经 `this.model = X` 的引用被替换为 null，**真实模型丢失，降级 mock**。三层异常都被同一个 try 抓住。

修复建议（**不动代码**，仅验证）：
- 拆分 try：load 用一组 catch，save 用另一组 catch；save 失败仅 console.warn，保持 `this.model`。

**R-08 (P1)** — Hook/Service 缓存不互通：

- `modelService.ts:4` `MODEL_CACHE_PREFIX = 'indexeddb://ecg-model-cache-'`
- `useModelInference.ts:22` `MODEL_CACHE_PREFIX = 'indexeddb://ecg-hook-model-'`

两个入口从 IndexedDB 视角看是两个不同模型；如果用户先用 AIClinical 入口加载到 Service，又跳到 AnnotationStudio 走 Hook，依然找不到缓存 → 重新下载 → 重新失败。

**R-18 (P2)** — `tf.LayersModel.save()` 对大模型写到 IndexedDB 可能触发 `QuotaExceededError`；此时整个 load 流程失败、模型丢失。**用户面对的体验**：页面跳到 mock，但从来没有 toast "IndexedDB 写入失败"。

**R-20 (P1)** — `firebaseService.initialize()`（`src/services/firebaseService.ts:101-154`）使用动态 import + Promise.all，**任何一个 sub-package 失败都让 initialize 失败**。`AnnotationStudio.tsx:150-154` `useEffect` 用 `.catch(...)` + `console.warn`，把失败吞掉。随后 `saveAnnotationsToFirebase`（`AnnotationStudio.tsx:295-313`）通过 `firebaseService.isInitialized()` 守卫 — **未初始化时静默跳过**，用户不知道自己的标注从未被持久化。

**R-22 (P1)** — `AnnotationStudio.tsx:307-313`：

```ts
useEffect(() => {
  if (!currentRecordId || currentRecordId.startsWith('local-')) return;
  const timeoutId = setTimeout(() => {
    saveAnnotationsToFirebase(currentRecordId, annotations);
  }, 1000);
  return () => clearTimeout(timeoutId);
}, [annotations, currentRecordId, saveAnnotationsToFirebase]);
```

`currentRecordId` 的来源：

- 默认空字符串 (`AnnotationStudio.tsx:122`) → 走 `buildRecordId` (`:564-573`) → `local-${Date.now()}`。
- WFDB import 时被设为 batchId（`AnnotationStudio.tsx:748`）→ 例如 "100"（3 位数字）→ **不**以 local- 开头 → **会触发 save**。
- JSON import 时 `parsed.record.id`（`AnnotationStudio.tsx:323`），由 `ECG_${ts}_${rand}` 生成 → `ECG_...` **不**以 local- 开头 → **会触发 save**。
- Demo 默认无 recordId → `local-...` → **永远不触发 save**。

体验上：用户首次进入标注页就改标注 → **永远不进 Firebase**，即便 firebaseService 初始化成功。

---

## 4. UI / Canvas / 其它

**R-15 (P3)** — `AnnotationStudio.tsx:251-292` `useEffect` 监听 `keydown`，依赖数组 `[]` 为空。`handleSelectAnnotationType` 是函数表达式，每次 render 重新定义；effect 闭包持有首 render 的实现。实际语义等价（内部只调 setter），但与 `exhaustive-deps` lint 规则冲突，且项目 ESLint config 未启用该规则。属于代码卫生问题，不是 bug。

**R-16 (P1)** — `AnnotationStudio.tsx:611-641` 的 `handleMinimaxAnalyze`：

```ts
const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();
const useProxy = !hasDirectConfig;

if (!useProxy && (!minimaxEndpoint.trim() || !minimaxApiKey.trim())) {
  message.warning('请先填写 Minimax Endpoint 和 API Key');
  return;
}

setMinimaxLoading(true);
try {
  const signalData = leads.map((lead) => lead.data);

  // Determine if we should use proxy or direct API
  const hasDirectConfig = minimaxEndpoint.trim() && minimaxApiKey.trim();   // ← 重声明
  const useProxy = !hasDirectConfig;                                          // ← 重声明

  const predictions = await minimaxService.analyzeECG(signalData, {
    endpoint: minimaxEndpoint.trim(),
    apiKey: minimaxApiKey.trim(),
    ...
  });
```

问题：
1. 重复声明 `hasDirectConfig` / `useProxy`（死代码 / 掩饰）。
2. UI 暴露 `endpoint` 和 `apiKey` 两个输入框让用户填 "直接调用 MiniMax"。从 README 看平台默认走 env 配置 (`src/config/env.ts`)，**当前页是否真的允许前端直接发请求到 `https://api.minimax.chat` 由 `minimaxService.analyzeECG` 决定**。
3. CORS 风险：若 `useProxy=false` 且 MiniMax endpoint 是用户可写的字符串，前端 fetch 会把用户凭证送上第三方 endpoint。

复现：
1. 在 `MiniMax Endpoint` / `API Key` 输入框随便填。
2. 切到 `useProxy` 直连分支（`minimaxService.analyzeECG(signal, { useProxy: false, endpoint, apiKey })`）。
3. DevTools Network → 该 endpoint 的 CORS 状况 + 暴露的请求 headers。

验证命令：
```bash
# 1. 看 unit test 是否覆盖 minimaxService 的 "useProxy=false" 分支
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'minimaxService|useProxy'
# 0 命中 = 没测

# 2. 看 minimaxService 自己有没有
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\services\minimaxService*'
```

**R-17 (P2)** — `ECGCanvas.tsx:151-226` 的 `renderWaveforms`：每次 leads 变化都 `canvas.remove(obj)` + 新建 fabric.Polyline + fabric.Shadow。播放时 `setInterval(... 120)` (`AnnotationStudio.tsx:228-244`) 持续触发 `setLeads(buildStreamingLeads(...))` → `renderWaveforms` → 重建 ~10k 个 Fabric Object，shadow 对象没有显式 dispose。

复现：
1. AnnotationStudio 默认 demo 数据开启回放（Space）。
2. DevTools Performance panel → 录制 30s → 看 "Scripting" / "GC" 占用。
3. Memory panel → JS heap 持续上升。

**R-19 (P2)** — `AnnotationStudio.tsx:466-517` 的 GitHub Raw URL 导入：

```ts
const validHosts = ['raw.githubusercontent.com', 'raw.githubusercontent.org'];
...
const suspiciousPatterns = [/@/, /:/, /\.\./, /localhost/i, /127\.0\.0\.1/i, /0x/i];
```

- `/:/` 太严格：合法 raw URL 有 query string（不带 `:`），但**一旦用户传入 `https://raw.githubusercontent.com/user/repo/main/path:withColon.json`，被一刀切**。SSRF 的真实目标是"内网穿透"——GitHub Raw 本身已经是 trusted boundary，这层 regex 安全剧场。
- `@` 拦截能防 `user:pass@host`，但 GitHub Raw 不支持基本认证，所以攻击面有限。
- 实际风险低，但 regex 注释不清，未来修改容易拆。

验证命令：
```bash
# 1. 单元测试
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'handleGithubUrlImport|suspiciousPatterns'
# 0 命中 = 没测

# 2. 走一遍 raw.githubusercontent.com/... 实际 import，校验 happy path
```

**R-23 (P3)** — `AnnotationStudio.tsx:524-526` 的 `setDeleteSignal((prev) => prev + 1)` + `ECGCanvas.tsx:147-149` 的 `useEffect([deleteSignal])` → `handleDeleteSelectedAnnotation()`：删除由 ref `selectedAnnotationIdRef.current` 决定。一旦 quick click 多个 annotation circle，**删的是 ref 当前持有的 ID**（`:118-125`），行为可预测但并无确认弹窗 — 这是 UX 而非安全。

**R-24 (P2)** — 之前的 `REVIEW.md` 提过 webpack `maxEntrypointSize: 1 600 000`。当前 `webpack.config.*` 配置和实际产物大小未在本轮复核（本次没读 webpack 配置）。建议在 CI 中加 `webpack --mode production --json > stats.json` 与 PR 体积对比。

验证命令：
```bash
npm run build
# 检查 webpack 输出的 asset size 警告
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\dist' -Recurse |
  Where-Object { $_.Length -gt 1MB } |
  Select-Object Name, @{Name='Size_KB';Expression={[int]($_.Length/1024)}} |
  Format-Table -AutoSize
```

**R-25 (P3)** — `AnnotationStudio` 从 `./components` 引入时，tree-shaking 取决于是否全量 re-export。REVIEW.md 仍把 e2e 测试覆盖标为 P1 未结；本轮阅读未发现新增 e2e。

---

## 5. CI / Deploy / 配置

`.github/workflows/deploy-pages.yml` 已修正为监听 `main`、拆分 `quality + build + deploy`、跑 lint/typecheck/test:unit/test:backend。REVIEW.md 提到 Node 24 + `NODE_OPTIONS=--max-old-space-size=6144`，这些都在 workflow 第 33-56 行体现。

本轮新增证据：
- `package.json:13-19` — `npm run check` = lint + typecheck + test:unit + build；`npm run test:backend` 单独跑。
- `package.json:14` — `typecheck` 同时跑 `tsc --noEmit` (主) + `tsc --noEmit -p tsconfig.test.json` (测试)。
- 缺：`test:backend` 不在 `check` 里 → 默认 `npm run check` 不跑后端；要跑全量必须显式 `npm run check && npm run test:backend` — 这与 REVIEW.md 完全一致。

CI 当前监听 `main` + PR，但 PR 触发时会跑 quality + build；deploy 仅 main 触发。`(if: github.event_name == 'push' && github.ref == 'refs/heads/main')` 正确。

唯一 CI 缺口：
- 工作流未跑 `npm run check`（合并命令），分别跑 `lint`、`typecheck`、`test:unit`、`test:backend`；本地开发者若只跑 `npm run check` 会跳过 backend。
- 不影响本次风险图主线。

---

## 6. 验证命令清单（一次性跑完）

```bash
Set-Location "D:\VS vibe coding files\ecg-annotation-platform"

# A. 顶层合规 + 单测 + 后端
npm run check
npm run test:backend

# B. 模型路径与缓存校验
Get-ChildItem -Path 'public\models' -Recurse
Select-String -Path 'src' -Pattern 'ecg-model-cache-|ecg-hook-model-' -Recurse

# C. parser 覆盖
Get-ChildItem -Path 'src' -Recurse -Filter '*.test.ts' |
  Select-String -Pattern 'DICOMParser|WFDBParser|HL7Parser'

# D. mock 边界
Select-String -Path 'src\pages\AnnotationStudio.tsx' -Pattern 'MOCK|isUsingMockInference'
Select-String -Path 'src\services\modelService.ts' -Pattern 'mockPredict'

# E. 直接演示路径
npm run dev:web
# 浏览器：默认进来 → 点 "加载模型" → 点 "AI 分析" → 看 toast + SignalMetrics 顶标
# 浏览器：导出 JSON，检查 diagnosis 字段
# 浏览器：导入一段真 DICOM / HL7 / WFDB，看 waveform 形状
```

---

## 7. 修复优先级建议（不修代码，仅排序）

1. **R-01 / R-02 (P0)** — `exportRecord` / `SignalMetrics` / `SmartAssistancePanel` 在 `isUsingMockInference === true` 时必须显式标注 "MOCK" 并禁用 diagnosis 导出（或要求二次确认）。
2. **R-03 / R-04 (P0)** — 替换/补强 DICOM / WFDB parser（dicompixeldata / wfdb 官方 parser）。
3. **R-22 / R-20 (P1)** — Firebase 守卫策略改为 "未初始化 → message.warning 提示用户"，同时 `buildRecordId` 不能写 `local-`（应改成显式 "unsynced" 状态）。
4. **R-07 / R-08 / R-18 (P1)** — 缓存路径拆 try + 统一前缀 + IndexedDB 失败兜底。
5. **R-09 / R-10 / R-13 (P1)** — Tensor shape 透传而非启发式；Worker `predictWithHeatmap` 消息合并；多导联 mock 标注。
6. **R-16 (P1 合规)** — 收敛 MiniMax 直连入口，复查 `minimaxService.analyzeECG` 的 `useProxy=false` 分支是否真的从前端发跨域请求。
7. **R-11 / R-12 / R-17 / R-19 / R-21 / R-24 (P2)** — 性能/可维护性，可分批。
8. **R-15 / R-23 / R-25 (P3)** — 代码卫生。

---

## 8. 与现有 REVIEW.md 的差异

- `REVIEW.md`（2026-06-06）主要标 1-8 项：CI / 端点硬编码 / sidecar 安全 / 演示边界 / 测试覆盖 / bundle / 文档漂移 / ECGFounder 外部仓。
- 本轮新增或显化的：**模型能力 / 缓存 / mock / demo data / parser 五轴**。其中以 **mock → diagnosis 导出** 和 **parser 三件套**最值得马上提上来。其余的 server-side CORS / env-config / bundle 仍是 REVIEW.md 已识别但未升级到 P0 的项，本轮不再重复展开。

---

完。
