# ECGFounder 训练可视化与标注平台集成设计

## 验收目标

在 `ecg-annotation-platform` Web 平台上实现：
1. **历史训练看板** — 读取已有的 12 轮 MIT-BIH 微调记录，展示 loss/accuracy/f1 曲线、per-class 指标、confusion matrix、参数统计
2. **Checkpoint 管理** — 列出 `round_N/best_macro_f1.pth`，支持加载/导出
3. **新训练任务** — 在 Web 平台发起微调，实时监控进度（Loss/Acc/F1/参数统计），训练完成后自动归档到历史记录

---

## 一、架构设计

### 1.1 整体拓扑

```
Windows 本地
┌──────────────────────────────────────────────────────────────────┐
│  D:\ECG founder\ECGFounder                                       │
│                                                                  │
│  ┌──────────────────┐         ┌────────────────────┐            │
│  │ finetune_runner  │────────→│ param_observer.py  │            │
│  │ (训练进程)        │ stdout  │ (独立监控进程)      │            │
│  └────────┬─────────┘         └─────────┬──────────┘            │
│           │                             │                       │
│           │ shared_state.json           │ param_stats.json     │
│           │                             │                       │
│           └──────────────┬────────────────┘                       │
│                          ▼                                      │
│                  ┌──────────────┐                                │
│                  │  FastAPI     │                                │
│                  │  Sidecar     │                                │
│                  │  (6090)      │                                │
│                  └──────┬───────┘                                │
│                         │ HTTP/SSE                              │
└────────────────────────┼────────────────────────────────────────┘
                         │
                         ▼
         ┌──────────────────────────────┐
         │  ecg-annotation-platform     │
         │  React 前端 (3000)           │
         │  /training                  │
         └──────────────────────────────┘
```

### 1.2 组件职责

| 组件 | 职责 |
|------|------|
| `finetune_runner.py` | 受控训练脚本，读取 `train_task.json`，启动微调 **（不修改原有训练代码）** |
| `param_observer.py` | **独立进程**，轮询检测每轮训练状态，加载 checkpoint 计算参数统计，写入 `param_stats.json` |
| `proxy-server/main.py` | FastAPI 服务，历史文件读取 + 训练控制 API + SSE 实时状态流 |
| `shared_state.json` | 训练进程 ↔ API 共享状态 |
| `param_stats.json` | param_observer.py 计算的参数统计，供 API 读取 |
| `train_task.json` | 前端发起训练请求的队列文件 |
| 前端 `/training` 页面 | 训练看板 UI + Checkpoint 管理 UI |

---

## 二、数据流设计

### 2.1 状态文件格式

**shared_state.json**（训练进程写入，API 读取）
```json
{
  "status": "training",
  "round": "round_13",
  "current_epoch": 5,
  "total_epochs": 20,
  "stage": "finetune",
  "train_loss": 0.3311,
  "train_acc": 0.8928,
  "train_f1": 0.8930,
  "val_acc": 0.8350,
  "val_macro_f1": 0.8352,
  "lr": 9.89e-06,
  "message": "Epoch 5/20 Stage2 Loss=0.3311 Acc=0.8928",
  "error": null,
  "started_at": "2026-04-28T10:00:00",
  "updated_at": "2026-04-28T10:05:23"
}
```

**param_stats.json**（param_observer.py 写入，API 读取）
```json
{
  "round": "round_13",
  "epoch": 5,
  "timestamp": "2026-04-28T10:05:20",
  "layers": [
    {
      "name": "backbone.layer1.0.conv1.weight",
      "shape": [64, 3, 7, 7],
      "mean": 0.0231,
      "std": 0.1523,
      "min": -0.8912,
      "max": 0.9341,
      "grad_mean": 0.0012,
      "grad_std": 0.0089
    },
    {
      "name": "backbone.layer4.0.conv1.weight",
      "shape": [512, 128, 3, 3],
      "mean": 0.0451,
      "std": 0.2031,
      "min": -1.234,
      "max": 1.189,
      "grad_mean": 0.0003,
      "grad_std": 0.0045
    }
  ],
  "global_norm": 0.8231,
  "trainable_params": 30670389,
  "frozen_params": 0
}
```

**train_task.json**（前端写入，训练进程读取）
```json
{
  "task_id": "task_001",
  "dataset": "MIT-BIH",
  "config": {
    "epochs": 20,
    "batch_size": 32,
    "lr_backbone": 1e-5,
    "balance_before_split": true,
    "unfreeze_mode": "all"
  },
  "created_at": "2026-04-28T10:00:00"
}
```

### 2.2 API 端点

| 方法 | 路径 | 职责 |
|------|------|------|
| GET | `/api/training/history` | 列出所有历史训练轮次（解析 outputs/ 目录） |
| GET | `/api/training/history/:round/log` | 获取指定轮次的完整训练日志 |
| GET | `/api/training/history/:round/eval` | 获取指定轮次的测试评估 JSON |
| GET | `/api/training/history/:round/param-stats` | 获取指定轮次的参数统计历史 |
| GET | `/api/training/state` | 获取当前 shared_state.json |
| GET | `/api/training/state/stream` | SSE 流，实时推送 shared_state.json 变化 |
| GET | `/api/training/param-stats` | 获取当前 param_stats.json |
| GET | `/api/training/param-stats/stream` | SSE 流，实时推送参数统计变化 |
| POST | `/api/training/task` | 提交新训练任务（写入 train_task.json） |
| GET | `/api/training/task/status` | 查询任务队列状态 |
| GET | `/api/checkpoints` | 列出所有 checkpoint 文件 |
| GET | `/api/checkpoints/:round/:file` | 下载指定 checkpoint 文件 |

### 2.3 训练发起与闭环流程

```
[前端] POST /api/training/task
        ↓
[API] 写入 train_task.json，status: queued
        ↓
[finetune_runner] 检测到 train_task.json，status: queued
        ↓
[finetune_runner] 启动微调
[param_observer] 轮询检测 epoch 变化，加载 checkpoint，写 param_stats.json
        ↓
[前端] SSE /api/training/state/stream + /api/training/param-stats/stream
        ↓
[finetune_runner] 完成后写 test_evaluation_*.json，删除 train_task.json
[param_observer] 归档本轮参数统计到 round_N/param_history.json
        ↓
[前端] 训练结束提示，新 round 自动出现在历史列表
```

### 2.4 崩溃处理闭环

```
[finetune_runner] 训练崩溃
        ↓
写入 shared_state.json status=error + error 信息
        ↓
[param_observer] 检测到 status=error，停止观察
        ↓
[SSE] 推送 error 状态
        ↓
[前端] 显示错误提示，不卡死，可重新发起训练
```

---

## 三、前端功能模块

### 3.1 训练看板（Training Dashboard）

**入口**: `/training`

**Tab A: 历史训练记录**
- 表格展示所有 round（round_1 ~ round_12）
  - 列：轮次 | 最佳 F1 | 测试 Accuracy | 训练时间 | 操作
  - 点击行 → 展开该轮详细指标
- 详细指标面板：
  - Loss 曲线（Train Loss vs Epoch）
  - Accuracy/F1 曲线（Train vs Val）
  - Per-class F1 柱状图
  - Confusion Matrix 热力图
  - 分类报告表格
  - **参数统计曲线**（点击"参数"Tab）
    - 选择层（layer1 ~ layer4、head）
    - 显示 weight mean/std 随 epoch 变化曲线
    - Stage 切换线标注

**Tab B: 实时训练**
- 当前训练状态卡片（仅当 status ≠ idle 时显示）
  - 进度条（current_epoch / total_epochs）
  - 实时指标：Train Loss | Train Acc | Train F1 | Val Macro F1 | LR
  - Stage 指示（Freeze backbone → Finetune）
  - SSE 连接状态指示器
- **实时参数热力图**
  - 横轴：层（layer1.0 ~ layer4.2, head）
  - 颜色：weight std 幅度
  - 每 epoch 更新一次
- 训练日志滚动窗口

### 3.2 Checkpoint 管理器

- 表格列出所有 `round_N/best_macro_f1.pth`
  - 列：轮次 | 文件大小 | 最佳 F1 | 操作
  - 操作：下载 | 设为活跃
- "设为活跃" → 下载权重到浏览器本地，或记录到 LocalStorage

### 3.3 发起新训练

- 表单字段：
  - 数据集（MIT-BIH，暂定）
  - Epochs（默认 20）
  - Batch Size（默认 32）
  - 初始学习率 backbone（默认 1e-5）
  - unfreeze_mode（默认 all）
- 按钮：「开始训练」→ POST /api/training/task
- 训练中按钮变为「训练中...」+ 禁用状态

---

## 四、后端模块

### 4.1 FastAPI Sidecar (`proxy-server/main.py`)

依赖：
- `fastapi`
- `uvicorn`
- `sse-starlette`（SSE 支持）
- Python 标准库（`json`, `pathlib`, `filelock`）

核心功能：
- 启动时扫描 `D:/ECG founder/ECGFounder/outputs/` 建立历史索引
- 启动后每 2 秒轮询 `shared_state.json` 和 `param_stats.json` 变化，通过 SSE 推送给前端
- `/api/training/task` 写入 `train_task.json`
- `train_task.json` 变化检测触发训练进程
- `param_stats.json` 由 param_observer.py 写入，API 只负责读取和转发
- 静态文件服务：`/api/checkpoints/*` 对应 `D:/ECG founder/ECGFounder/outputs/round_*/`
- 管理 finetune_runner 和 param_observer 两个子进程的生命周期

### 4.2 训练受控脚本 (`finetune_runner.py`)

放在 `D:/ECG founder/ECGFounder/` 目录下，**不修改任何原有训练代码**：
- 主循环：每 5 秒检查 `train_task.json` 是否存在且 status=queued
- 检测到任务后：
  1. 写 `shared_state.json` status=running
  2. 启动子进程运行 `finetune_mitbih_ecgfounder_gpu_amp.py`（原脚本不改动）
  3. 每 epoch 末解析日志文件提取指标，写入 `shared_state.json`
  4. 训练完成：生成 `test_evaluation_*.json`，删除 `train_task.json`，写 `shared_state.json` status=done
  5. 崩溃：捕获异常，写 `shared_state.json` status=error + error 信息

### 4.3 参数统计独立观察进程 (`param_observer.py`)

放在 `D:/ECG founder/ECGFounder/` 目录下，**不修改任何原有训练代码**：
- 主循环：每 5 秒读取 `shared_state.json`
- 检测到 epoch 变化时：
  1. 读取 `shared_state.json` 获取当前 round 和 epoch
  2. 加载对应 `outputs/round_N/` 下的 checkpoint 文件（pth）
  3. 遍历所有 `named_parameters()`，计算 mean/std/min/max/grad_mean/grad_std
  4. 写入 `param_stats.json`
  5. 若 epoch=1，清空 `round_N/param_history.json`
  6. 追加本 epoch 统计到 `round_N/param_history.json`
- 训练结束时：关闭监控

### 4.4 共享状态读写工具 (`proxy-server/state.py`)

```python
import json, filelock
from pathlib import Path

STATE_FILE = Path("D:/ECG founder/ECGFounder/shared_state.json")
PARAM_STATS_FILE = Path("D:/ECG founder/ECGFounder/param_stats.json")
LOCK_FILE = Path("D:/ECG founder/ECGFounder/.state.lock")

def read_state() -> dict:
    with filelock.FileLock(LOCK_FILE):
        return json.loads(STATE_FILE.read_text())

def write_state(data: dict):
    with filelock.FileLock(LOCK_FILE):
        STATE_FILE.write_text(json.dumps(data, indent=2))
```

---

## 五、现有数据的兼容性

已有的历史训练数据无需转换：

| 已有文件 | 前端如何使用 |
|---------|-------------|
| `outputs/train_round_*.log` | 解析每行 `[Epoch N]` 条目提取 loss/acc/f1 曲线 |
| `outputs/test_evaluation_round_*.json` | 直接读取，展示最终指标 |
| `outputs/round_*/best_macro_f1.pth` | 列表展示，支持下载 |
| `outputs/round_*/param_history.json` | **新增**，历史参数统计（由 param_observer.py 批量补录历史轮次） |

批量补录历史参数统计：训练闭环验证稳定后，运行一次 `param_observer_backfill.py`，对 round_1 ~ round_12 逐一加载 checkpoint 生成 param_history.json。

---

## 六、日志解析工具

路径：`proxy-server/parsers.py`

```python
def parse_train_log(log_text: str) -> list[dict]:
    """将 train_round_N.log 解析为 epoch 列表"""
    results = []
    for line in log_text.splitlines():
        # "Epoch 1 (Stage 1)" → epoch, stage
        # "Train Loss=1.2563 Acc=0.6031 F1=0.6089" → train metrics
        # "Val   Acc=0.6900 MacroF1=0.6852 WeightedF1=0.6852" → val metrics
        # "[SAVE] best_macro_f1=0.6852"
        ...
    return results
```

---

## 七、验收标准

| # | 验收项 | 验证方式 |
|---|-------|---------|
| 1 | 历史 12 轮训练记录全部展示 | 前端列表显示 12 条，点击展开有曲线 |
| 2 | Loss/Accuracy/F1 曲线正确渲染 | 对比 `train_round_1.log` 与前端图表数值 |
| 3 | Confusion Matrix 热力图显示 | 对比 `test_evaluation_round_1.json` |
| 4 | Checkpoint 文件可下载 | 点击下载，大小与 `round_1/best_macro_f1.pth` 一致 |
| 5 | 发起训练后进度条实时更新 | POST 训练任务，SSE 流式更新直到完成 |
| 6 | 训练完成自动归档到历史 | 新 round 出现在历史列表顶部 |
| 7 | 训练崩溃显示错误信息 | 人为触发一个错误，观察前端错误提示 |
| 8 | 断线重连恢复状态 | SSE 断开后重连，进度不丢失 |
| 9 | 进程重启后状态恢复 | FastAPI 重启，训练进程继续，前端重连后状态一致 |
| 10 | Windows 本地一键启动 | `run_platform.bat` 启动三个进程（API + runner + observer），无报错 |
| 11 | **参数统计实时更新** | 实时训练时 weight mean/std 每 epoch 变化一次，前端热力图刷新 |
| 12 | **历史轮次参数曲线** | 选中 round_1，查看参数 Tab，选择 layer1.0，显示 20 epoch 的 std 变化曲线 |
| 13 | **参数统计闭环验证** | 发起新训练，训练结束后 round_N/param_history.json 存在且内容完整 |
| 14 | **不修改原训练脚本** | `finetune_mitbih_ecgfounder_gpu_amp.py` 等原文件 MD5 未变化 |

---

## 八、文件清单

新增/修改文件：

```
ecg-annotation-platform/
├── proxy-server/
│   ├── main.py              # FastAPI 服务
│   ├── parsers.py           # 日志/评估 JSON 解析
│   ├── state.py             # shared_state.json 读写（filelock 保护）
│   └── run_platform.bat     # 一键启动脚本
│
ecg-annotation-platform/src/
│   └── pages/
│       └── TrainingDashboard.tsx   # 训练看板页面
│
D:/ECG founder/ECGFounder/
│   ├── finetune_runner.py   # 受控训练脚本（不修改原训练代码）
│   ├── param_observer.py    # 独立参数统计观察进程（不修改原训练代码）
│   └── shared_state.json    # 运行时状态
│   └── param_stats.json     # 实时参数统计
│
D:/ECG founder/ECGFounder/outputs/round_N/
│   └── param_history.json   # 本轮参数统计历史（由 param_observer 维护）
```

**不修改以下原文件**：
- `finetune_mitbih_ecgfounder_gpu_amp.py`
- `net1d.py`
- `dataset.py`
- 任何 `checkpoint/` 下的文件

---

## 九、技术约束

- **Python**: 3.10（ECGFounder 已有的 conda 环境）
- **Node.js**: ecg-annotation-platform 现有版本
- **前端框架**: React + TypeScript（已有）
- **图表库**: ECharts（ecg-annotation-platform 已引入）
- **无新增数据库依赖**：文件系统和 JSON 共享状态
- **端口**: FastAPI sidecar 默认 6090，避免与前端 3000 和其他服务冲突
- **文件锁**: `filelock` 库保证多进程读写 JSON 不会冲突
- **原代码零修改**：param_observer.py 纯观察，不注入、不修改、不依赖内部实现

---

*设计版本: 1.1*
*日期: 2026-04-28*
*更新: 增加 param_observer.py 独立参数统计模块，不修改原训练代码*
