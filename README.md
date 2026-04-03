# ECG Annotation & Analysis Platform

> 当前仓库的可用版本以代码实现为准。下面这份说明按“现在能做什么、怎么用、有哪些限制”来写，避免和旧设计文档混淆。

## 快速使用

### 你现在可以做什么

- 导入单个 ECG 文件，支持 `JSON`、`DICOM`、`HL7`
- 导入 `WFDB` 成对文件（`.hea` + `.dat`）
- 批量导入 `MIT-BIH` 记录文件夹
- 从 GitHub Raw 链接直接拉取 JSON 数据
- 在标注工作台里完成 `P / R / T` 波标注
- 运行本地模型推理或接入 `Minimax` 接口做辅助分析
- 导出当前记录为 `JSON` 或 `CSV`

### 推荐操作路径

1. 进入「病例管理」新建或选择患者。
2. 点击「标注工作台」，确认顶部患者上下文是否正确。
3. 用文件上传、文件夹上传或 Raw URL 导入数据。
4. 选择导联，调整 `R` 峰阈值，必要时开启动态回放。
5. 切换到标注模式后，在波形上修订人工标注。
6. 先加载模型，再执行 AI 分析。
7. 完成后导出 `JSON` 或 `CSV` 结果。

### 导入格式说明

- `JSON`：适合直接复用平台导出的结构化记录
- `DICOM`：基于本地解析器提取波形与部分元数据
- `HL7`：支持基础消息解析，适合实验性数据接入
- `WFDB`：需要 `.hea` 与 `.dat` 两个文件成对上传
- `MIT-BIH`：只识别三位数字记录名，例如 `100.hea` 和 `100.dat`

### 标注与分析

- `P`、`R`、`T` 三类标注已经在工作台中提供快捷入口
- 自动 R 峰检测依赖当前导联与阈值设置
- 本地模型加载失败时会回退到模拟推理，便于演示和调试
- `Minimax` 分析是可选项，只有填写 Endpoint 和 API Key 才会调用
- 快捷键目前支持 `Ctrl+1`、`Ctrl+2`、`Ctrl+3` 切换标注类型，`Space` 切换动态回放，`Esc` 退回平移模式

### 导出建议

- `JSON` 适合二次处理、回灌或继续标注
- `CSV` 适合快速查看标注点和导联数据
- 当前导出以当前会话为准，记录 ID 与患者 ID 会跟随当前上下文

## 代码审核结论

本次审核重点看了入口页、病例页、标注工作台、模型服务和导入导出链路。结论如下：

- 主流程已经能跑通，但原始文档与实际代码不一致，需要以这份 README 为准。
- 病例页跳转到标注页时，`patientId` 现在会被接入标注页上下文，不再只是一个丢失的参数。
- 当前的 DICOM / HL7 解析更偏“基础可用”，不是完整临床级解码器。
- 例子页、仪表盘和设置页仍然包含部分静态 mock 数据，适合演示，不适合当作真实业务数据源。
- 模型加载存在本地缓存和 mock fallback，这对于离线演示有用，但不应被误解为正式医疗推理结果。

## 已知限制

- `Settings` 页的配置目前主要是演示性，不会持久化到后端。
- `Dashboard`、`CaseDetail` 和 `AIModels` 里有部分 mock 数据，需要真实数据接入后再启用生产级流程。
- DICOM / HL7 / WFDB 的解析覆盖面有限，复杂样本可能需要继续扩展解析器。
- `Minimax` 调用依赖外部服务与密钥配置，前端无法替代服务端安全策略。

<p align="center">
  <img src="https://img.shields.io/badge/React-18.x-61DAFB?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TensorFlow.js-3.x-FF6F00?style=flat-square&logo=tensorflow" alt="TensorFlow.js">
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=flat-square&logo=firebase" alt="Firebase">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

> 基于 React + TensorFlow.js 的心电图智能标注与分析平台

## 📖 项目简介

ECG Annotation & Analysis Platform 是一个面向医疗场景的 Web 应用，旨在为心电图（ECG）数据标注、 AI 辅助诊断和病例管理提供一站式解决方案。

### 核心特性

- 🖌️ **智能标注工具** - 基于 Fabric.js 的交互式波形标注
- 🤖 **AI 实时推理** - TensorFlow.js 模型在浏览器端实时推理
- 📊 **病例管理系统** - Firebase 云端数据存储与检索
- 🔒 **离线推理支持** - IndexedDB 模型缓存，断网可用
- 📈 **DICOM 影像关联** - 心电图与医学影像跨模态分析

---

## 🏗️ 技术架构

### 前端技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 框架 | React 18 + TypeScript | 组件化开发 |
| 状态管理 | Redux Toolkit | 全局状态管理 |
| UI 组件 | Ant Design Pro | 企业级组件库 |
| 画布交互 | Fabric.js | 波形绘制与标注 |
| AI 推理 | TensorFlow.js | 浏览器端模型推理 |
| 数据可视化 | ECharts + D3.js | 医学影像与图表渲染 |
| 后端服务 | Firebase | 认证、云存储、Firestore |

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户界面层 (React)                              │
├──────────────┬──────────────────────────────┬───────────────────────────────┤
│  病例管理面板  │        标注画布区域          │        AI 诊断面板            │
│  (左侧导航)   │   (波形渲染 + 标注交互)      │   (模型推理 + 热力图)          │
└──────┬───────┴──────────────┬───────────────┴───────────────┬───────────────┘
       │                     │                               │
       ▼                     ▼                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              业务逻辑层                                      │
├──────────────────┬─────────────────────┬─────────────────────┬───────────────┤
│   格式解析引擎    │    预处理引擎       │   AI 推理引擎      │   存储服务    │
│  (DICOM/HL7)     │   (信号标准化)       │  (Web Workers)     │  (Firebase)   │
└──────────────────┴─────────────────────┴─────────────────────┴───────────────┘
       │                     │                     │              │
       ▼                     ▼                     ▼              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据资源层                                      │
├──────────────────┬─────────────────────┬─────────────────────┬───────────────┤
│   ECG 信号数据   │   IndexedDB        │   TensorFlow.js    │   Firestore   │
│   (原始波形)     │   (模型缓存)        │   (模型权重)       │   (病例数据)  │
└──────────────────┴─────────────────────┴─────────────────────┴───────────────┘
```

---

## 📁 项目结构

```
ecg-annotation-platform/
├── public/
│   ├── models/                  # TensorFlow.js 模型文件
│   │   ├── ecg-classifier/
│   │   │   ├── model.json
│   │   │   └── group1-shard1of1.bin
│   │   └── heart-segmentation/
│   └── index.html
├── src/
│   ├── components/
│   │   ├── Canvas/              # 画布相关组件
│   │   │   ├── ECGCanvas.tsx
│   │   │   ├── AnnotationLayer.tsx
│   │   │   └── WaveformRenderer.tsx
│   │   ├── AI/                  # AI 推理组件
│   │   │   ├── ModelLoader.tsx
│   │   │   ├── InferenceWorker.ts
│   │   │   └── HeatmapOverlay.tsx
│   │   ├── Case/                # 病例管理组件
│   │   │   ├── CaseList.tsx
│   │   │   ├── CaseSearch.tsx
│   │   │   └── CaseDetail.tsx
│   │   └── Layout/              # 布局组件
│   │       ├── MainLayout.tsx
│   │       └── Header.tsx
│   ├── services/
│   │   ├── ecgParser.ts         # ECG 数据解析
│   │   ├── modelService.ts      # 模型加载与推理
│   │   └── firebaseService.ts   # Firebase 集成
│   ├── hooks/
│   │   ├── useECGCanvas.ts
│   │   ├── useModelInference.ts
│   │   └── useOfflineMode.ts
│   ├── workers/
│   │   └── inference.worker.ts  # Web Worker 推理
│   ├── store/
│   │   ├── index.ts
│   │   ├── ecgSlice.ts
│   │   └── caseSlice.ts
│   ├── utils/
│   │   ├── signalProcessor.ts
│   │   ├── dicomParser.ts
│   │   └── exportUtils.ts
│   ├── types/
│   │   └── index.ts
│   ├── App.tsx
│   ├── index.tsx
│   └── index.css
├── package.json
├── tsconfig.json
├── webpack.config.js
└── README.md
```

---

## 🚀 快速开始

### 前置要求

- Node.js >= 18.0.0
- npm >= 9.0.0

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/yourusername/ecg-annotation-platform.git
cd ecg-annotation-platform

# 2. 安装依赖
npm install

# 3. 配置 Firebase
# 创建 firebase-config.ts 并配置您的 Firebase 项目

# 4. 启动开发服务器
npm start
```

### 环境变量配置

```bash
# .env.local
REACT_APP_FIREBASE_API_KEY=your_api_key
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your_storage_bucket
```

---

## 🔧 核心功能实现

### 1. 波形标注工具 (Fabric.js)

```typescript
// src/components/Canvas/ECGCanvas.tsx
import { fabric } from 'fabric';

export const initECGCanvas = (canvasRef: HTMLCanvasElement) => {
  const canvas = new fabric.Canvas(canvasRef, {
    selection: false,
    backgroundColor: '#000000',
  });

  // 分层渲染：波形层、标注层、注释层
  const waveformLayer = new fabric.Layer();
  const annotationLayer = new fabric.Layer();
  const commentLayer = new fabric.Layer();

  canvas.add(waveformLayer, annotationLayer, commentLayer);

  // 启用缩放和平移
  canvas.on('mouse:wheel', (opt) => {
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom() * (delta > 0 ? 0.9 : 1.1);
    canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
  });

  return canvas;
};
```

### 2. AI 推理引擎 (TensorFlow.js + Web Workers)

```typescript
// src/workers/inference.worker.ts
import * as tf from '@tensorflow/tfjs';

let model: tf.LayersModel | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, data } = e.data;

  switch (type) {
    case 'loadModel':
      model = await tf.loadLayersModel(data.modelUrl);
      self.postMessage({ type: 'modelLoaded' });
      break;

    case 'predict':
      if (!model) throw new Error('Model not loaded');
      
      const tensor = tf.tensor3d(data.signal);
      const prediction = model.predict(tensor) as tf.Tensor;
      
      self.postMessage({ 
        type: 'prediction', 
        result: prediction.arraySync() 
      });
      
      tensor.dispose();
      prediction.dispose();
      break;
  }
};
```

### 3. 离线模型缓存 (IndexedDB)

```typescript
// src/utils/modelCache.ts
import Dexie from 'dexie';

const db = new Dexie('ModelCache');
db.version(1).stores({
  models: '++id, name, version, data, timestamp'
});

export const cacheModel = async (name: string, modelUrl: string) => {
  const model = await tf.loadLayersModel(modelUrl);
  const modelArtifacts = await model.save();
  
  await db.models.add({
    name,
    version: '1.0.0',
    data: JSON.stringify(modelArtifacts),
    timestamp: Date.now()
  });
};

export const loadCachedModel = async (name: string) => {
  const cached = await db.models.where('name').equals(name).first();
  if (cached) {
    return await tf.loadLayersModel(cached.data);
  }
  throw new Error('Model not found in cache');
};
```

---

## 📊 性能优化

| 优化方向 | 实现方案 | 预期效果 |
|---------|---------|---------|
| 画布渲染 | WebGL 加速 + 分块渲染 | 2000+ 导联实时流畅渲染 |
| 模型推理 | FP32→INT8 量化 + 模型剪枝 | 推理速度提升 3 倍 |
| 内存管理 | react-window 虚拟化列表 | 10万+ 病例数据无卡顿 |
| 网络传输 | Protocol Buffers + Gzip 压缩 | 传输量减少 70% |

---

## 🔐 隐私与安全

- ✅ 端到端加密（Web Cryptography API）
- ✅ 符合 HIPAA 标准
- ✅ 本地数据处理，敏感信息不上传
- ✅ Firebase 安全规则配置

---

## 📋 数据格式

### 病例数据结构

```typescript
interface ECGRecord {
  patientId: string;
  ecgRecords: {
    deviceId: string;
    timestamp: string;
    signal: string;           // Base64 编码的原始数据
    annotations: Annotation[];
    diagnosis: {
      label: string;
      confidence: number;
    };
  }[];
}
```

### 标注数据格式

```typescript
interface Annotation {
  id: string;
  type: 'P' | 'Q' | 'R' | 'S' | 'T' | 'ST';
  position: number;           // 采样点位置
  confidence: number;        // AI 置信度
  manual: boolean;           // 是否人工确认
}
```

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'Add xxx'`)
4. 推送到分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

---

## 📄 许可证

MIT License - 请查看 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- [TensorFlow.js](https://tensorflow.org/js)
- [Fabric.js](http://fabricjs.com/)
- [Firebase](https://firebase.google.com/)
- [Ant Design](https://ant.design/)

---

## 📞 联系方式

- Email: your.email@example.com
- GitHub: https://github.com/yourusername/ecg-annotation-platform
