# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ECG 心电图标注与分析平台，支持 JSON、DICOM、HL7、WFDB 格式导入，提供人工标注、AI 辅助分析与导出。Web 前端基于 React + TypeScript + Ant Design + Redux Toolkit，Python FastAPI sidecar 负责训练状态转发。

## 常用命令

```bash
# 前端开发（端口 3000）
npm run dev:web

# 生产构建
npm run build

# 测试（ Jest）
npm test                        # 所有测试
npm test -- --testPathPattern=ecgParser  # 单个测试文件

# 代码检查
npm run lint
npm run lint -- --fix          # 自动修复

# 后端（proxy-server FastAPI，端口 6090）
cd proxy-server
python -m uvicorn main:app --host 0.0.0.0 --port 6090

# 后端测试
cd proxy-server
python -m pytest tests/ -v                     # 所有测试
python -m pytest tests/test_assistant_memory.py -v  # 单个测试文件
```

## 技术栈

- **前端**: React 18 + TypeScript + Redux Toolkit + Ant Design + Fabric.js + TensorFlow.js
- **后端**: Python FastAPI (proxy-server, port 6090)
- **构建**: Webpack（dev: webpack.config.dev.js, prod: webpack.config.js）
- **模板**: `templates/app.html`（不是 `public/`）

## 架构约束

- 数据模型: `Patient -> ECGRecord[] -> ECGLead[] + Annotation[] + ModelPrediction[]`
- 状态: `ecgSlice`（标注、画布、模型）+ `caseSlice`（患者、记录）
- Services: 单例模式，失败时回退到 mock
- 路由: 所有页面使用 `React.lazy()` + `Suspense` 懒加载
- `inferenceResults` 包含 TF tensor，排除在 Redux 序列化之外
- Canvas: Fabric.js，ref 初始化，不与 React 状态绑定
- 路径别名: `@`, `@components` 等（见 tsconfig.json）

## 标注工作台（AnnotationStudio）

核心页面。URL 参数 `?patientId=&recordId=` 驱动上下文。

主要状态:
- `currentPatientId`, `currentRecordId` — 从 URL query/string 注入
- `leads: ECGLead[]` — 当前加载的导联数据
- `annotations: Annotation[]` — 所有标注
- `inferenceResults` — AI 推理结果
- `wfdbBatches` — MIT-BIH 批量导入的记录

导出调用 `exportRecord()`，支持 JSON/CSV，携带 metadata、annotations、diagnosis。

## 训练平台（TrainingDashboard）

前端通过 SSE + REST 与 proxy-server 通信，后端转发给 `D:/ECG founder/ECGFounder/` 下的 Python 训练调度进程。

**输出目录结构** — `outputs/` 包含多个数据集：
- `round_N/` 子目录 → MIT-BIH 数据集（`train_*.log`, `result.json`, `test_evaluation_*.json`, `param_history.json`）
- `cpsc2018_*/` 子目录 → CPSC2018 数据集（只有 `history_*.csv` 和 `best_*.pth`，无日志/评估文件）

**关键路径**:
| 文件 | 用途 |
|------|------|
| `outputs/round_N/train_*.log` | MIT-BIH 训练日志 |
| `outputs/round_N/result.json` | MIT-BIH 最佳指标 |
| `outputs/cpsc2018_*/history_*.csv` | CPSC2018 训练历史（备用数据源） |
| `outputs/*/best_*.pth` | 最佳模型权重（通配匹配，支持 MIT-BIH 和 CPSC2018 命名） |
| `outputs/round_N/param_history.json` | 逐 epoch 参数统计 |
| `shared_state.json` | 实时训练状态 |
| `param_stats.json` | 当前参数统计 |
| `train_task.json` | 任务队列 |

**训练状态流**: `POST /api/training/task` → 写入 train_task.json → finetune_runner.py 轮询检测 → 启动训练子进程 → 每 2s 解析日志更新 shared_state.json → param_observer.py 检测新 epoch → 写入 param_stats.json → proxy-server SSE 推送前端

**性能优化**：SSE streams 在 idle/done 状态下降为 30s 轮询（训练中 2s）；param_observer 在同一 epoch 只加载一次 checkpoint（避免重复加载 100MB+ 模型文件）。

**前端表单默认值**：epochs=5, batch_size=16（已调低以减轻计算压力）。

GPU OOM 时调整: `BATCH_SIZE = 16`（默认 64），`MAX_PER_CLASS = 400`

## Assistant（Memory + RAG）

v1 实现本地 JSON + 关键词/TF-IDF 搜索，无外部 LLM/Qdrant/Neo4j。

后端: `proxy-server/assistant/`（text_index, memory_store, rag_store, service）
前端: `src/services/ecgAssistantApi.ts` + SmartAssistancePanel
API:
- `POST /api/assistant/knowledge/rebuild` — 重建知识库索引
- `POST /api/assistant/memory/case` — 记录病例上下文
- `POST /api/assistant/ask` — 提问（memory-first 或 knowledge-first）

安全约束: UI 使用"辅助""参考""上下文检索"，不输出"诊断结论"，答案必须暴露 sources。

## 开发注意事项

- proxy-server 修改路由后必须重启 uvicorn
- webpack 输出清理在 Windows 上保守处理
- 避免引入新的 lint 错误
- 多步骤工作使用 `.planning/` 目录记录
