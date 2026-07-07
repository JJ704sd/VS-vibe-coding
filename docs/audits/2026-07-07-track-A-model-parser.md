# Track A: 模型服务 + Worker + Parser 审计 (2026-07-07)

审计范围：`src/services/modelService.ts`、`src/hooks/useModelInference.ts`、`src/workers/inference.worker.ts`、`src/utils/dicomParser.ts`，并按需核对导入链路与相关单测。按任务要求本轮只读源码，不修改业务代码，不运行 `npm run build`。

## 0. 速读表

| # | 风险轴 | 一句话结论 | Severity | AUDIT 对照 |
|---|-------|-----------|----------|-----------|
| A-01 | DICOM parser | 仍只认 128 偏移 `DICM`，且把 tag 后 4 字节直接当长度，显式 VR/真实 Waveform Sequence 基本解析不了 | P0 | 残留 R-03 |
| A-02 | DICOM waveform | 波形从 132 偏移裸读 12 导联 Int16，忽略 DICOM waveform tags/字节序，`samples` 与实际每导联样本数还不一致 | P1 | R-03 延伸 / 新发现 |
| A-03 | WFDB parser | 原始 `charCodeAt` 直接截断问题已有缓解，但 UI 先用 `TextDecoder('ascii')` 会改写 0x80-0x9F；同时 parser 忽略 WFDB `212` 等打包格式 | P0 | R-04 残留变体 |
| A-04 | HL7 parser | 仍用 `atob` 后按 4 字节裸切 Float32，并写死 500Hz/默认大端，非此私有格式会错读或失败 | P1 | 残留 R-05 |
| A-05 | Parser 导入链路 | UI 标称支持 `.hl7`，但单文件导入把 HL7 当 ArrayBuffer 给 `detectFormat`，永远无法命中 `MSH` 字符串分支 | P1 | 新发现 |
| A-06 | 模型资源 | 默认 `/models/ecg-classifier/model.json` 仍不存在，`loadModel` 远程失败后缓存失败，默认进入 mock | P1 | 残留 R-06 |
| A-07 | 模型缓存 | `ModelService.loadModel` 远程加载成功后先 `save`，`save`/IndexedDB 配额失败会丢掉刚加载的真实模型 | P1 | 残留 R-07 / R-18 |
| A-08 | 缓存命名 | Service 与 hook 仍使用两套 IndexedDB 前缀；Worker 失败后缓存回退路由已修，但跨入口缓存仍互不可见 | P1 | R-08 部分残留 / 部分已修 |
| A-09 | Tensor 输入/输出 | `buildInputTensor` 仍靠 shape 启发式猜 lead/time-major；`normalizeToProbabilities` 会把 sigmoid 多标签强行 softmax | P1 | 残留 R-09 |
| A-10 | Worker 协议 | Worker `predictWithHeatmap` 仍先发 prediction 再发 heatmap；主线程只处理 prediction，且当前没有 caller 使用该 message | P1 | 残留 R-10 |
| A-11 | Worker backend | Worker 只 import `@tensorflow/tfjs`，没有 `tf.setBackend`/`tf.ready`，浏览器 Worker 中仍会退到默认 backend | P2 | 残留 R-11 |
| A-12 | Mock/Heatmap | `mockPredict`、Service heatmap、hook heatmap、Worker heatmap 都只看 `signal[0]`，首导联空会吞掉其他有效导联 | P1 | 残留 R-13 / 新边界 |
| A-13 | 模型路径配置 | 模型 URL 硬编码不止两处：AnnotationStudio、hook 默认值、ModelLoader；`env.ts` 没有模型 URL 配置项 | P2 | 残留 R-21 |
| A-14 | Hook 主线程推理 | hook 的 main/cache 路径直接 `tf.tensor3d([signal])`，没有复用 `ModelService.buildInputTensor`，Worker/main/service 三条路径形状合同不一致 | P1 | 新发现 |

## 1. 详细发现

### 1.1 [P0] DICOM parser 仍无法处理真实显式 VR / Waveform Sequence

- **文件:行号**: `src/utils/dicomParser.ts:55-65`, `src/utils/dicomParser.ts:107-120`
- **证据**:

```ts
private isValidDICOM(dataView: DataView): boolean {
  if (dataView.byteLength < 132) {
    return false;
  }

  return (
    dataView.getUint8(128) === 0x44 &&
    dataView.getUint8(129) === 0x49 &&
    dataView.getUint8(130) === 0x43 &&
    dataView.getUint8(131) === 0x4d
  );
}
```

```ts
private findTagData(dataView: DataView, group: number, element: number): ArrayBuffer | null {
  const fileSize = dataView.byteLength;
  const searchPattern = new Uint8Array([group & 0xff, group >> 8, element & 0xff, element >> 8]);
  
  for (let i = 132; i < fileSize - 4; i++) {
    if (dataView.getUint8(i) === searchPattern[0] &&
        dataView.getUint8(i + 1) === searchPattern[1] &&
        dataView.getUint8(i + 2) === searchPattern[2] &&
        dataView.getUint8(i + 3) === searchPattern[3]) {
      const length = dataView.getUint32(i + 4, true);
      if (length > 0 && length < fileSize - i - 8 && length % 2 === 0) {
        const buffer = dataView.buffer as ArrayBuffer;
        return buffer.slice(i + 8, i + 8 + length);
      }
```

- **复现**:
  1. 准备一个标准 Explicit VR Little Endian DICOM ECG，tag 后紧跟 2 字节 VR + 2/4 字节长度。
  2. 导入后 `isValidDICOM` 只看 `DICM`；`findTagData` 把 VR 两字节和 length 两字节整体当 `uint32` 长度。
  3. metadata 读不到，waveform 也不会按 DICOM waveform sequence 定位，只会进入裸读路径。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\utils\dicomParser.ts' -Pattern 'isValidDICOM|findTagData|getUint32\(i \+ 4' -Context 2,8
```

- **AUDIT 对照**: 残留 `R-03`。当前实现仍是轻量 mock parser，不是临床 DICOM ECG parser。
- **修复建议**: 明确只支持 demo DICOM，或引入/封装真实 DICOM 解析库；至少按 transfer syntax 处理 implicit/explicit VR、sequence、waveform channel definition、sample interpretation 与 endian。

### 1.2 [P1] DICOM waveform 裸读 132 偏移，样本数和字节序都不可信

- **文件:行号**: `src/utils/dicomParser.ts:137-157`, `src/utils/dicomParser.ts:187-190`
- **证据**:

```ts
private parseWaveformData(dataView: DataView): DICOMWaveformData {
  const waveformData: DICOMWaveformData = {
    channels: 12,
    samples: Math.floor(dataView.byteLength / 2 / 12),
    samplingRate: 500,
    data: []
  };

  const offset = 132;
  const samplesPerChannel = Math.floor((dataView.byteLength - offset) / 2 / waveformData.channels);

  for (let ch = 0; ch < waveformData.channels; ch++) {
    const channelData: number[] = [];
    for (let i = 0; i < samplesPerChannel; i++) {
      const value = dataView.getInt16(offset + (i * waveformData.channels + ch) * 2);
      channelData.push(value / 32768);
```

```ts
return {
  leads,
  duration: waveformData.samples / waveformData.samplingRate,
  samplingRate: waveformData.samplingRate,
  patientInfo,
```

- **复现**:
  1. 构造 132 字节 preamble + 12 导联 × 1000 样本 little-endian Int16 的 buffer。
  2. `samplesPerChannel` 为 1000，但 `waveformData.samples = floor(totalByteLength / 24)`，把 132 字节 preamble 算进样本数，duration 偏大。
  3. `getInt16(offset)` 未传 `true`，默认大端；little-endian 样本会被翻转。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\utils\dicomParser.ts' -Pattern 'samples: Math.floor|getInt16\(offset|duration: waveformData.samples' -Context 2,5
```

- **AUDIT 对照**: `R-03` 的延伸，当前 commit 新增可确认的 duration/endianness 边界风险。
- **修复建议**: `samples` 应来自实际 waveform tag 或至少复用 `samplesPerChannel`；按 transfer syntax 传入 endian；不要把 preamble/metadata 当 waveform payload。

### 1.3 [P0] WFDB 高字节仍会在 UI 转换链路损坏，且 parser 忽略 MIT-BIH 常见打包格式

- **文件:行号**: `src/pages/AnnotationStudio.tsx:342-356`, `src/utils/dicomParser.ts:239-263`
- **证据**:

```ts
const arrayBufferToBinaryString = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  // Use TextDecoder for efficient conversion, fallback to String.fromCharCode for small buffers
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('ascii').decode(bytes);
  }
  // Fallback for environments without TextDecoder
  return String.fromCharCode(...bytes);
};

const parseWfdbPair = async (heaFile: File, datFile: File): Promise<ECGLead[]> => {
  const parser = new WFDBParser();
  const headerText = await heaFile.text();
  const datBinary = arrayBufferToBinaryString(await datFile.arrayBuffer());
  const ecgData = parser.parse(headerText, datBinary);
```

```ts
const bytes = new Uint8Array(dataFile.length);
for (let index = 0; index < dataFile.length; index += 1) {
  bytes[index] = dataFile.charCodeAt(index) & 0xff;
}

if (bytes.length < numLeads * 2) {
  return null;
}

const sampleCount = Math.min(numSamples, Math.floor(bytes.length / 2 / numLeads));
const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
```

```ts
const offset = (sampleIndex * numLeads + ch) * 2;
if (offset + 2 > dataView.byteLength) {
  break;
}
channelData.push(dataView.getInt16(offset, true) / 32768);
```

- **复现**:
  1. 上传 MIT-BIH `.hea/.dat`，dat 中包含 0x80-0x9F 字节。
  2. UI 用 `TextDecoder('ascii')` 先把字节映射成 Unicode 字符；例如 Windows-1252 兼容映射会把部分高字节改成非原始 code point。
  3. parser 再 `charCodeAt(index) & 0xff`，无法恢复原字节。
  4. 真实 MIT-BIH 常见 `212` 12-bit packed 格式也不会被解析，因为 parser 一律按 interleaved little-endian Int16 读。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\pages\AnnotationStudio.tsx','D:\VS vibe coding files\ecg-annotation-platform\src\utils\dicomParser.ts' -Pattern "TextDecoder\('ascii'\)|charCodeAt\(index\)|getInt16\(offset, true\)" -Context 2,4
```

- **AUDIT 对照**: `R-04` 残留变体。`WFDBParser` 内部 `& 0xff` 使“直接 binary string 输入”比旧描述好，但当前 UI 调用链仍会在 parser 前损坏高字节；且真实 WFDB 格式支持仍缺失。
- **修复建议**: `WFDBParser.parse` 应接收 `ArrayBuffer/Uint8Array` 而不是 binary string；解析 `.hea` 每条 signal 的 format/gain/baseline，并实现至少 MIT-BIH `212`。

### 1.4 [P1] HL7 parser 仍是私有 Float32/base64 假设，采样率和 duration 写死 500Hz

- **文件:行号**: `src/utils/dicomParser.ts:311-343`
- **证据**:

```ts
for (const obx of obxSegments) {
  const fields = obx.split('|');
  if (fields[3]?.includes('ECG')) {
    const waveformData = fields[5];
    if (waveformData) {
      const decoded = atob(waveformData);
      const floatArray = new Float32Array(decoded.length / 4);
      for (let i = 0; i < floatArray.length; i++) {
        floatArray[i] = new DataView(
          new Uint8Array([
            decoded.charCodeAt(i * 4),
            decoded.charCodeAt(i * 4 + 1),
            decoded.charCodeAt(i * 4 + 2),
            decoded.charCodeAt(i * 4 + 3)
          ]).buffer
        ).getFloat32(0);
```

```ts
leads.push({
  name: fields[4]?.split('^')[1] || 'I',
  data: Array.from(floatArray),
  samplingRate: 500
});
```

```ts
return {
  leads,
  duration: leads[0]?.data.length ? leads[0].data.length / 500 : 0,
  samplingRate: 500,
  patientInfo
};
```

- **复现**:
  1. 构造 HL7 OBX，其中 waveform 不是 Float32 big-endian base64，或长度不是 4 的倍数。
  2. parser 仍按 4 字节 Float32 拆；未读取 HL7 中的单位、采样率、编码或 lead metadata。
  3. 输出始终 `samplingRate: 500`，duration 也按 500 计算。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\utils\dicomParser.ts' -Pattern 'atob\(|Float32Array|getFloat32\(0\)|samplingRate: 500|duration: leads\[0\]' -Context 2,5
```

- **AUDIT 对照**: 残留 `R-05`。
- **修复建议**: 明确支持的 HL7 waveform 编码；解析采样率/单位/字节序；对 base64 长度、字段缺失、CRLF 做显式校验并返回可诊断错误。

### 1.5 [P1] `.hl7` 文件在 UI 单文件导入路径不可达

- **文件:行号**: `src/pages/AnnotationStudio.tsx:770-777`, `src/services/ecgParser.ts:20-27`, `src/utils/dicomParser.ts:351-375`
- **证据**:

```ts
setImporting(true);
try {
  if (lowerName.endsWith('.json')) {
    const text = await file.text();
    await parseJsonTextAndApply(text);
  } else {
    const parsed = await ecgParserService.parseFile(file, {
      removeBaseline: true,
      normalize: true,
```

```ts
const arrayBuffer = await file.arrayBuffer();
const format = detectFormat(arrayBuffer);

if (format === 'unknown') {
  return { success: false, error: 'Unsupported file format' };
}

const ecgData = parseECG(arrayBuffer);
```

```ts
export function detectFormat(data: ArrayBuffer | string): 'dicom' | 'wfdb' | 'hl7' | 'json' | 'unknown' {
  if (typeof data === 'string') {
    if (data.startsWith('MSH')) {
      return 'hl7';
    }
    if (data.startsWith('{') || data.startsWith('[')) {
      return 'json';
    }
    return 'unknown';
  }

  const view = new DataView(data);
```

- **复现**:
  1. 选择 UI 上“单文件支持 JSON / DICOM / HL7”的 `.hl7` 文件。
  2. 除 `.json` 之外都走 `ecgParserService.parseFile(file)`。
  3. `parseFile` 读取 `arrayBuffer`，`detectFormat(ArrayBuffer)` 只检查 DICOM magic，不可能走 `data.startsWith('MSH')`。
  4. 返回 `Unsupported file format`。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\pages\AnnotationStudio.tsx','D:\VS vibe coding files\ecg-annotation-platform\src\services\ecgParser.ts','D:\VS vibe coding files\ecg-annotation-platform\src\utils\dicomParser.ts' -Pattern 'endsWith\(\'.json\'\)|arrayBuffer\(\)|startsWith\(\'MSH\'\)|支持格式: JSON / DICOM / HL7' -Context 2,5
```

- **AUDIT 对照**: 新发现。它会让 `HL7Parser` 即使有实现也无法从主 UI 入口使用。
- **修复建议**: `.hl7` 分支应使用 `file.text()` 后调用 `parseECG(text)`；同时统一 CRLF/CR 分段。

### 1.6 [P1] 默认真实模型资源仍不存在，失败后默认进入 mock

- **文件:行号**: `src/pages/AnnotationStudio.tsx:586-595`, `src/services/modelService.ts:18-31`
- **证据**:

```ts
const handleModelLoad = async (): Promise<void> => {
  dispatch(setModelLoading(true));
  try {
    await modelService.loadModel('/models/ecg-classifier/model.json');
    dispatch(setModelLoaded(true));
    if (modelService.isUsingMockInference()) {
      message.warning('未配置真实模型，已切换到模拟推理模式');
    } else {
      message.success('真实模型加载成功');
    }
```

```ts
try {
  this.model = await tf.loadLayersModel(modelUrl);
  await this.model.save(cacheKey);
  this.useMockInference = false;
} catch (error) {
  console.error('[ModelService] Failed to load remote model:', error);
  try {
    this.model = await tf.loadLayersModel(cacheKey);
    this.useMockInference = false;
  } catch (cacheError) {
    console.error('[ModelService] Failed to load cached model:', cacheError);
    this.model = null;
    this.useMockInference = true;
```

- **复现**:
  1. 清空 IndexedDB 后打开标注工作台。
  2. 点击“加载模型”。
  3. `/models/ecg-classifier/model.json` 404；`indexeddb://ecg-model-cache-%2Fmodels...` 首次也不存在；UI 警告后进入 mock。
- **验证命令**:

```powershell
Get-ChildItem -Path 'D:\VS vibe coding files\ecg-annotation-platform\public\models\ecg-classifier' -Recurse
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\pages\AnnotationStudio.tsx','D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts' -Pattern 'ecg-classifier/model\.json|useMockInference = true' -Context 2,4
```

- **AUDIT 对照**: 残留 `R-06`。本次目录核对仍只有 `public/models/ecg-classifier/README.md`，没有 `model.json`。
- **修复建议**: 要么提交/发布真实模型资源并在构建中复制，要么把模型加载按钮明确标为“模拟推理”，避免默认承诺真实模型。

### 1.7 [P1] `ModelService.loadModel` 保存缓存失败会丢弃已加载模型

- **文件:行号**: `src/services/modelService.ts:13-31`
- **证据**:

```ts
async loadModel(modelUrl: string): Promise<void> {
  this.modelUrl = modelUrl;
  const cacheKey = this.getCacheKey(modelUrl);
  this.useMockInference = false;

  try {
    this.model = await tf.loadLayersModel(modelUrl);
    await this.model.save(cacheKey);
    this.useMockInference = false;
  } catch (error) {
    console.error('[ModelService] Failed to load remote model:', error);
    try {
      this.model = await tf.loadLayersModel(cacheKey);
      this.useMockInference = false;
```

```ts
    } catch (cacheError) {
      console.error('[ModelService] Failed to load cached model:', cacheError);
      this.model = null;
      this.useMockInference = true;
    }
  }
}
```

- **复现**:
  1. 让 `tf.loadLayersModel(modelUrl)` 成功（真实模型可达）。
  2. 在浏览器中使 IndexedDB quota 满、禁用 IndexedDB，或让 `model.save(cacheKey)` 抛错。
  3. 外层 catch 把“远程加载失败”和“缓存保存失败”混在一起处理，随后缓存加载失败会 `this.model = null`，真实模型引用被丢弃。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts' -Pattern 'tf\.loadLayersModel\(modelUrl\)|model\.save\(cacheKey\)|this\.model = null|useMockInference = true' -Context 2,5
```

- **AUDIT 对照**: 残留 `R-07`，同时覆盖 `R-18` 的 IndexedDB 大模型/配额失败边界。
- **修复建议**: 将远程加载与缓存写入拆成两个 try/catch；缓存保存失败只 warning，不应改变 `this.model` 和真实推理可用性。

### 1.8 [P1] Hook 与 Service 缓存 namespace 仍分裂；Worker fallback 路由已修但缓存互通未修

- **文件:行号**: `src/services/modelService.ts:4`, `src/hooks/useModelInference.ts:22`, `src/hooks/useModelInference.ts:167-187`
- **证据**:

```ts
const MODEL_CACHE_PREFIX = 'indexeddb://ecg-model-cache-';
```

```ts
const MODEL_CACHE_PREFIX = 'indexeddb://ecg-hook-model-';
const CLASS_NAMES = ['正常', '房颤', '室上性心动过速', '室性心动过速', '停搏'];
```

```ts
const fallbackModel = await loadFromCache(modelUrlToLoad);
const outcome = resolveLoadFailureOutcome({
  useWorker,
  primaryLoadFailed: true,
  cacheModel: fallbackModel,
  loadError,
});

if (fallbackModel) {
  if (outcome.terminateWorker && workerRef.current) {
    workerRef.current.terminate();
    workerRef.current = null;
  }
```

- **复现**:
  1. 通过 `ModelService.loadModel(url)` 成功缓存模型，key 为 `indexeddb://ecg-model-cache-...`。
  2. 后续组件使用 `useModelInference({ modelUrl: url })`，hook 只查 `indexeddb://ecg-hook-model-...`，认为缓存不存在。
  3. 反向也一样。当前 hook 的 Worker 失败 + cache hit 路由已新增 `activeBackendRef`，但前提仍是 hook 自己 namespace 中有缓存。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts','D:\VS vibe coding files\ecg-annotation-platform\src\hooks\useModelInference.ts' -Pattern 'MODEL_CACHE_PREFIX|resolveLoadFailureOutcome|activeBackendRef' -Context 2,5
```

- **AUDIT 对照**: `R-08` 部分残留、部分已修。`.planning/current-bug-audit-2026-07-04/findings.md` 第 5 条的“Worker 失败后缓存回退不可用”在当前 hook 中已有 `selectPredictionRoute/resolveLoadFailureOutcome` 测试覆盖；但两套 IndexedDB key 仍未统一。
- **修复建议**: 抽出单一 cache key helper；或让 hook/service 都接受注入的 cache namespace 并迁移旧 key。

### 1.9 [P1] 输入 tensor 和输出概率仍依赖启发式，sigmoid 多标签会被错误 softmax

- **文件:行号**: `src/services/modelService.ts:157-173`, `src/services/modelService.ts:180-239`
- **证据**:

```ts
private normalizeToProbabilities(scores: number[]): number[] {
  if (scores.length === 0) {
    return scores;
  }

  const hasNegative = scores.some((value) => value < 0);
  const sum = scores.reduce((acc, value) => acc + value, 0);
  const looksLikeProb = !hasNegative && sum > 0.95 && sum < 1.05;

  if (looksLikeProb) {
    return scores;
  }

  const maxScore = Math.max(...scores);
```

```ts
private buildInputTensor(signalData: number[][], inputShape: Array<number | null>): tf.Tensor {
  const samples = signalData[0]?.length || 0;
  const aligned = signalData.map((lead) => lead.slice(0, samples));

  if (inputShape.length === 3) {
    const expectedA = inputShape[1];
    const expectedB = inputShape[2];

    const leadMajor = tf.tensor(aligned).expandDims(0);
    const timeMajor = tf.tensor(aligned).transpose([1, 0]).expandDims(0);
```

```ts
if (inputShape.length === 4) {
  const expectedA = inputShape[1];
  const expectedB = inputShape[2];
  const expectedC = inputShape[3];

  const timeMajor4d = tf.tensor(aligned).transpose([1, 0]).expandDims(0).expandDims(-1);
```

- **复现**:
  1. 加载输出为 sigmoid 多标签的模型，输出 `[0.9, 0.8, 0.1, 0.0, 0.0]`，总和不是 1。
  2. `normalizeToProbabilities` 认为它不是概率，执行 softmax，改变每个标签的独立概率。
  3. 输入形状 `[null, null, null]` 或多个维度均动态时，`buildInputTensor` 优先返回 lead-major；实际模型若需要 time-major 会错位。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts' -Pattern 'normalizeToProbabilities|looksLikeProb|Math\.exp|buildInputTensor|leadMajor|timeMajor|inputShape\.length === 4' -Context 2,6
```

- **AUDIT 对照**: 残留 `R-09`。
- **修复建议**: 模型包应携带 metadata（layout、sample rate、lead order、output activation）；不要从 tensor shape 猜语义；sigmoid/softmax 由模型 metadata 决定。

### 1.10 [P1] Worker `predictWithHeatmap` 协议仍会丢 heatmap，且当前是死代码

- **文件:行号**: `src/workers/inference.worker.ts:40-53`, `src/hooks/useModelInference.ts:203-225`, `src/services/modelService.ts:101-118`
- **证据**:

```ts
self.onmessage = async (event: MessageEvent) => {
  const { type, data } = event.data;

  switch (type) {
    case 'loadModel':
      await loadModel(data.modelUrl);
      break;
    case 'predict':
      await runInference(data.signal);
      break;
    case 'predictWithHeatmap':
      await runInference(data.signal);
      self.postMessage({ type: 'heatmap', heatmap: generateHeatmap(data.signal) });
      break;
```

```ts
workerRef.current.onmessage = (event: MessageEvent) => {
  if (event.data.type === 'prediction') {
    const predictions = CLASS_NAMES.map((label, index) => ({
      className: label,
      probability: event.data.result[index] || 0,
    })).sort((a, b) => b.probability - a.probability);
    resolve(predictions);
  }
  if (event.data.type === 'error') {
    reject(new Error(event.data.error));
  }
};
```

```ts
this.worker.onmessage = (event) => {
  if (event.data.type === 'prediction') {
    resolve(this.formatPrediction(event.data.result));
  }
  if (event.data.type === 'error') {
    reject(new Error(event.data.error));
  }
};
```

- **复现**:
  1. 给 worker 发送 `{ type: 'predictWithHeatmap' }`。
  2. Worker 先通过 `runInference` 发 `{ type: 'prediction' }`，随后再发 `{ type: 'heatmap' }`。
  3. hook/service 的 Promise 在 `prediction` 时 resolve，且没有处理 `heatmap` 分支；后续 heatmap 消息被覆盖/丢弃。
  4. 当前主线程 grep 也没有发送 `predictWithHeatmap` 的 caller，因此该分支既错又死。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\workers\inference.worker.ts','D:\VS vibe coding files\ecg-annotation-platform\src\hooks\useModelInference.ts','D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts' -Pattern 'predictWithHeatmap|type === ''prediction''|type === ''heatmap''|postMessage\(\{ type: ''predict''' -Context 2,6
```

- **AUDIT 对照**: 残留 `R-10`；另确认“Worker 消息协议有死代码”。
- **修复建议**: 要么删除 worker 的 `predictWithHeatmap`，要么统一成单条 `{ type: 'predictionWithHeatmap', prediction, heatmap }` 响应并让主线程 await 完整 payload。

### 1.11 [P2] Worker 没有显式选择/等待 TF.js backend

- **文件:行号**: `src/workers/inference.worker.ts:1-8`
- **证据**:

```ts
import * as tf from '@tensorflow/tfjs';

let model: tf.LayersModel | null = null;

const loadModel = async (modelUrl: string) => {
  try {
    model = await tf.loadLayersModel(modelUrl);
    self.postMessage({ type: 'modelLoaded', success: true });
```

- **复现**:
  1. 在浏览器 Worker 中加载模型。
  2. 代码没有 `tf.setBackend(...)` / `await tf.ready()`，也没有检测 WebGL/wasm/CPU。
  3. 不同浏览器/Worker 能力下默认 backend 不稳定，性能很可能落回 CPU。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\workers\inference.worker.ts' -Pattern 'setBackend|ready|wasm|webgl|cpu'
```

- **AUDIT 对照**: 残留 `R-11`。
- **修复建议**: 在 worker 初始化时显式 backend 策略：检测支持、设置 backend、等待 `tf.ready()`，并把 backend 名称回传给 UI/日志。

### 1.12 [P1] Mock 与 heatmap 都只看首导联；首导联为空时其他导联被静默忽略

- **文件:行号**: `src/services/modelService.ts:242-272`, `src/hooks/useModelInference.ts:253-263`, `src/workers/inference.worker.ts:34-38`
- **证据**:

```ts
private mockPredict(signalData: number[][]): ModelPrediction[] {
  const lead = signalData[0] || [];
  if (lead.length === 0) {
    return this.formatPrediction([0.2, 0.2, 0.2, 0.2, 0.2]);
  }

  const mean = lead.reduce((sum, value) => sum + value, 0) / lead.length;
```

```ts
private generateHeatmap(signalData: number[][]): number[] {
  const lead = signalData[0] || [];
  if (lead.length === 0) return [];
  const max = Math.max(...lead.map((value) => Math.abs(value)), 1);
  return lead.map((value) => Math.abs(value) / max);
}
```

```ts
const lead = signal[0] || [];
const max = Math.max(...lead.map((value) => Math.abs(value)), 1);

return {
  predictions,
  inferenceTime: performance.now() - startTime,
  heatmap: [lead.map((value) => Math.abs(value) / max)],
};
```

- **复现**:
  1. 构造 `signalData = [[], [0.1, 0.8, -0.2, ...]]` 或第一导联噪声很低、第二导联异常明显。
  2. mock 直接返回均匀概率或首导联结论；heatmap 为空/首导联 heatmap。
  3. UI 仍显示“分析完成”，不会提示多导联被压成单导联。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts','D:\VS vibe coding files\ecg-annotation-platform\src\hooks\useModelInference.ts','D:\VS vibe coding files\ecg-annotation-platform\src\workers\inference.worker.ts' -Pattern 'signalData\[0\]|signal\[0\]|generateHeatmap|mockPredict' -Context 2,5
```

- **AUDIT 对照**: 残留 `R-13`，并新增“首导联空/短会吞掉其他有效导联”的边界风险。
- **修复建议**: mock/heatmap 至少应聚合所有导联，或选择当前 lead 并在结果中标注来源；空首导联但其他导联有效时应报 validation error。

### 1.13 [P2] 模型路径硬编码三处，env 仍不可覆盖

- **文件:行号**: `src/pages/AnnotationStudio.tsx:586-590`, `src/hooks/useModelInference.ts:87-89`, `src/components/AI/HeatmapOverlay.tsx:193-195`, `src/config/env.ts:36-58`
- **证据**:

```ts
const handleModelLoad = async (): Promise<void> => {
  dispatch(setModelLoading(true));
  try {
    await modelService.loadModel('/models/ecg-classifier/model.json');
```

```ts
export function useModelInference(options: UseModelInferenceOptions = {}): UseModelInferenceReturn {
  const { modelUrl = '/models/ecg-classifier/model.json', autoLoad = false, useWorker = true } = options;
```

```ts
export const ModelLoader: React.FC<ModelLoaderProps> = ({
  modelUrl = '/models/ecg-classifier/model.json',
  onLoad,
```

```ts
export const MINIMAX_PROXY_ENDPOINT: string = '/api/ecg/analyze';
```

- **复现**:
  1. 设置 `.env` 或 shell 变量如 `ECG_MODEL_URL=...`。
  2. 构建/启动后上述三处仍使用字面量 `/models/ecg-classifier/model.json`。
  3. 生产环境无法用配置切换 CDN/sidecar 模型路径。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\pages\AnnotationStudio.tsx','D:\VS vibe coding files\ecg-annotation-platform\src\hooks\useModelInference.ts','D:\VS vibe coding files\ecg-annotation-platform\src\components\AI\HeatmapOverlay.tsx','D:\VS vibe coding files\ecg-annotation-platform\src\config\env.ts' -Pattern 'ecg-classifier/model\.json|MODEL_URL|process\.env.*MODEL' -Context 2,4
```

- **AUDIT 对照**: 残留 `R-21`；当前 commit 中实际硬编码是三处，不止旧审计里的两处。
- **修复建议**: 在 `src/config/env.ts` 增加 `ECG_MODEL_URL`（或 `MODEL_CLASSIFIER_URL`）并同步 webpack DefinePlugin / `.env.example`；所有 UI/service 默认值只从该常量读取。

### 1.14 [P1] hook main/cache 推理路径与 ModelService/Worker 的输入形状合同不一致

- **文件:行号**: `src/hooks/useModelInference.ts:232-250`, `src/services/modelService.ts:180-239`
- **证据**:

```ts
// `selectPredictionRoute` only returns 'main' when the model is loaded,
// but TypeScript can't follow that invariant across the boundary, so we
// re-check before dereffing the ref.
const mainModel = modelRef.current;
if (!mainModel) {
  throw new Error('Model not loaded');
}

const inputTensor = tf.tensor3d([signal]);
const prediction = mainModel.predict(inputTensor) as tf.Tensor;
const probabilities = Array.from(await prediction.data());
```

```ts
private buildInputTensor(signalData: number[][], inputShape: Array<number | null>): tf.Tensor {
  const samples = signalData[0]?.length || 0;
  const aligned = signalData.map((lead) => lead.slice(0, samples));

  if (inputShape.length === 3) {
    const expectedA = inputShape[1];
    const expectedB = inputShape[2];
```

- **复现**:
  1. 使用 `useModelInference({ useWorker: false })` 或 Worker load 失败但 hook cache 命中。
  2. hook main path 固定生成 `[1, leads, samples]` 的 3D tensor。
  3. 同一个模型若需要 `[1, samples, leads]`、flatten 2D 或 4D conv 输入，`ModelService` 可能还能尝试适配，hook 直接 shape mismatch。
- **验证命令**:

```powershell
Select-String -Path 'D:\VS vibe coding files\ecg-annotation-platform\src\hooks\useModelInference.ts','D:\VS vibe coding files\ecg-annotation-platform\src\services\modelService.ts' -Pattern 'tf\.tensor3d\(\[signal\]\)|buildInputTensor|inputShape\.length' -Context 2,6
```

- **AUDIT 对照**: 新发现。它会放大 `R-09`：同一模型经不同入口推理可能结果不同或直接失败。
- **修复建议**: 抽出共享 tensor adapter；hook、service、worker 都用同一输入规范和同一 output normalization。

## 2. 测试覆盖评估

- `src/__tests__/useModelInference.test.ts` 覆盖了 `selectPredictionRoute` 与 `resolveLoadFailureOutcome` 两个纯函数，能证明 2026-07-04 findings 第 5 条“Worker 失败后缓存回退不可用”在当前 hook 逻辑层已修。但它没有实例化 hook、没有真实 Worker、没有 TF.js model，也没有覆盖两套 IndexedDB prefix 互不感知。
- `src/services/ecgParser.test.ts` 只通过伪造 `DICM` magic 测 `ecgParserService.parseFile` 的浅层合同；没有直接测试 `DICOMParser` metadata/tag/VR、真实 DICOM waveform、`WFDBParser` 高字节/212 格式、`HL7Parser` base64/CRLF/采样率。
- `src/utils/buildDiagnosis.test.ts` 与 `src/utils/exportUtils.test.ts` 已覆盖 mock diagnosis provenance（旧 R-01/R-02 的导出侧修复），但这不覆盖本 Track 的 `modelService.mockPredict` 多导联行为、真实模型加载、Worker 协议或 parser 正确性。
- 本轮 grep 未发现 `modelService.ts` 的直接单测，也未发现 `inference.worker.ts` 消息协议单测。
- 本轮按任务要求未运行 `npm run build`；由于只读审计且未改业务代码，也未运行全量测试。建议后续修复时补最小单测后运行 `npm run lint`、`npm run typecheck`、`npm run test:unit`。

## 3. 结论与建议

当前 commit 相比 2026-07-04 已修掉一部分导出 provenance 与 hook Worker fallback 状态机问题，但 Track A 里的核心模型/Parser 风险多数仍存在：真实模型默认资源缺失、ModelService 缓存失败会丢真实模型、Worker 协议和 backend 未定、DICOM/WFDB/HL7 parser 仍是 demo 级解析。

建议按优先级分三步处理：

1. **先消除误导**：模型未配置时 UI/导出/分析面板持续显示 mock；HL7/DICOM/WFDB 未达到临床解析能力前，文案改成“实验性/有限支持”。
2. **统一模型合同**：抽出共享 model URL、cache key、tensor adapter、output activation metadata，hook/service/worker 共用。
3. **重做 parser 边界**：WFDB 改为 `Uint8Array` 输入并支持 `212`；HL7 文件入口走 text；DICOM 要么引入成熟 parser，要么明确拒绝真实临床 DICOM ECG 而不是静默生成伪波形。
