# ECGFounder 训练可视化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `ecg-annotation-platform` 前端网站实现 ECGFounder 微调训练的可视化看板，包括历史记录展示、实时进度监控、Checkpoint 管理和参数统计观测。

**Architecture:** FastAPI Sidecar（6090 端口）管理训练进程和状态文件，前端 React 页面通过 HTTP/SSE 消费数据。原训练代码零修改。

**Tech Stack:** Python 3.10 + FastAPI + filelock | React + TypeScript + ECharts + Ant Design

---

## 文件结构

```
# 后端 (proxy-server/ — Python FastAPI)
proxy-server/
├── state.py              # shared_state.json 读写（filelock 保护）
├── parsers.py            # train_round_*.log 解析器
├── main.py               # FastAPI 服务（所有 API 端点 + SSE）
└── run_platform.bat      # 一键启动（API + finetune_runner + param_observer）

# ECGFounder 训练管控 (D:/ECG founder/ECGFounder/)
├── finetune_runner.py    # 受控训练脚本（读取 train_task.json，启动原训练脚本）
├── param_observer.py     # 独立参数统计观察进程
└── param_observer_backfill.py  # 批量补录历史 round 参数统计

# 前端 (ecg-annotation-platform/src/)
├── services/
│   └── trainingApi.ts    # 训练相关 API 调用
├── pages/
│   └── TrainingDashboard.tsx  # 训练看板页面
# App.tsx 添加 /training 路由
```

---

## 阶段划分

**阶段 1 — 后端基础设施**（Task 1-3）
**阶段 2 — 训练管控进程**（Task 4-6）
**阶段 3 — 前端服务层 + 路由**（Task 7-8）
**阶段 4 — 前端看板 UI**（Task 9-12）
**阶段 5 — 端到端验证**（Task 13-14）

---

## 阶段 1：后端基础设施

### Task 1: shared_state.json 读写工具

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/state.py`

```python
"""
proxy-server/state.py
shared_state.json 和 param_stats.json 的读写工具，使用 filelock 防止多进程冲突。
"""
import json
import filelock
from pathlib import Path
from typing import Optional

# 路径常量
ECGFOUNDER_BASE = Path("D:/ECG founder/ECGFounder")
SHARED_STATE_FILE = ECGFOUNDER_BASE / "shared_state.json"
PARAM_STATS_FILE = ECGFOUNDER_BASE / "param_stats.json"
TRAIN_TASK_FILE = ECGFOUNDER_BASE / "train_task.json"
LOCK_FILE = ECGFOUNDER_BASE / ".state.lock"


class StateLock:
    """文件锁上下文管理器"""
    def __enter__(self):
        self._lock = filelock.FileLock(str(LOCK_FILE))
        self._lock.acquire(timeout=10)
        return self

    def __exit__(self, *args):
        self._lock.release()


def read_shared_state() -> dict:
    if not SHARED_STATE_FILE.exists():
        return {"status": "idle", "error": None}
    with StateLock():
        return json.loads(SHARED_STATE_FILE.read_text(encoding="utf-8"))


def write_shared_state(data: dict) -> None:
    with StateLock():
        SHARED_STATE_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def read_param_stats() -> Optional[dict]:
    if not PARAM_STATS_FILE.exists():
        return None
    with StateLock():
        return json.loads(PARAM_STATS_FILE.read_text(encoding="utf-8"))


def write_param_stats(data: dict) -> None:
    with StateLock():
        PARAM_STATS_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def read_train_task() -> Optional[dict]:
    if not TRAIN_TASK_FILE.exists():
        return None
    with StateLock():
        return json.loads(TRAIN_TASK_FILE.read_text(encoding="utf-8"))


def write_train_task(data: dict) -> None:
    with StateLock():
        TRAIN_TASK_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def delete_train_task() -> None:
    with StateLock():
        if TRAIN_TASK_FILE.exists():
            TRAIN_TASK_FILE.unlink()
```

- [ ] **Step 1: 创建 proxy-server 目录（如不存在）和 state.py**

```bash
mkdir -p "D:/VS vibe coding files/ecg-annotation-platform/proxy-server"
```

- [ ] **Step 2: 安装依赖**

```bash
pip install filelock fastapi uvicorn sse-starlette
```

- [ ] **Step 3: 验证 state.py 可导入**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform/proxy-server"
python -c "from state import read_shared_state, write_shared_state; print('OK')"
```

- [ ] **Step 4: 提交**

```bash
git add proxy-server/state.py
git commit -m "feat(proxy-server): add shared state读写工具 with filelock"
```

---

### Task 2: 日志解析器

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/parsers.py`

```python
"""
proxy-server/parsers.py
解析 train_round_*.log 和 test_evaluation_round_*.json
"""
import re
import json
from pathlib import Path
from typing import Optional

ECGFOUNDER_OUTPUTS = Path("D:/ECG founder/ECGFounder/outputs")


def parse_train_log(round_name: str) -> list[dict]:
    """
    解析 train_round_N.log，返回 epoch 列表。
    每条记录包含: epoch, stage, train_loss, train_acc, train_f1,
                 val_acc, val_macro_f1, val_weighted_f1, lr, is_best
    """
    log_file = ECGFOUNDER_OUTPUTS / f"train_{round_name}.log"
    if not log_file.exists():
        return []

    text = log_file.read_text(encoding="utf-8")
    results = []
    current = {}

    for line in text.splitlines():
        line = line.strip()

        # Stage 行: "========== Stage 1: Freeze backbone, lr=0.0001 =========="
        stage_match = re.match(r"=+\s*Stage \d+:\s*(.+?),\s*lr=(.+?)\s*=+", line)
        if stage_match:
            stage_name = stage_match.group(1).strip()
            lr = float(stage_match.group(2).strip())
            if current and current.get("epoch") is not None:
                results.append(current)
            current = {"stage": stage_name, "lr": lr, "is_best": False, "epoch": None}
            continue

        # Epoch 行: "Epoch 1 (Stage 1)" 或 "Epoch 6 (Stage 2)"
        epoch_match = re.match(r"Epoch\s+(\d+)\s+\(Stage\s+\d+\)", line)
        if epoch_match:
            if current and current.get("epoch") is not None:
                results.append(current)
            current = {"epoch": int(epoch_match.group(1)), "is_best": False}
            continue

        # Train 行: "  Train Loss=1.2563 Acc=0.6031 F1=0.6089"
        train_match = re.match(r"Train\s+Loss=([\d.]+)\s+Acc=([\d.]+)\s+F1=([\d.]+)", line)
        if train_match:
            current["train_loss"] = float(train_match.group(1))
            current["train_acc"] = float(train_match.group(2))
            current["train_f1"] = float(train_match.group(3))
            continue

        # Val 行: "  Val   Acc=0.6900 MacroF1=0.6852 WeightedF1=0.6852 LR=9.89e-06"
        val_match = re.match(
            r"Val\s+Acc=([\d.]+)\s+MacroF1=([\d.]+)\s+WeightedF1=([\d.]+)(?:\s+LR=([\d.e+-]+))?",
            line
        )
        if val_match:
            current["val_acc"] = float(val_match.group(1))
            current["val_macro_f1"] = float(val_match.group(2))
            current["val_weighted_f1"] = float(val_match.group(3))
            if val_match.group(4):
                current["lr"] = float(val_match.group(4))
            continue

        # SAVE 行: "  [SAVE] best_macro_f1=0.6852"
        save_match = re.match(r"\[SAVE\]\s+best_macro_f1=([\d.]+)", line)
        if save_match:
            current["is_best"] = True
            current["best_macro_f1"] = float(save_match.group(1))

    if current and current.get("epoch") is not None:
        results.append(current)

    return results


def parse_evaluation(round_name: str) -> Optional[dict]:
    """解析 test_evaluation_round_N.json"""
    eval_file = ECGFOUNDER_OUTPUTS / f"test_evaluation_{round_name}.json"
    if not eval_file.exists():
        return None
    return json.loads(eval_file.read_text(encoding="utf-8"))


def list_history_rounds() -> list[dict]:
    """扫描 outputs/ 目录，返回所有历史 round 列表（按编号排序）"""
    rounds = []
    for item in ECGFOUNDER_OUTPUTS.iterdir():
        if item.is_dir() and item.name.startswith("round_"):
            try:
                num = int(item.name.split("_")[1])
                rounds.append({"name": item.name, "number": num, "path": str(item)})
            except ValueError:
                pass
    rounds.sort(key=lambda x: x["number"])
    return rounds
```

- [ ] **Step 1: 创建 parsers.py**

- [ ] **Step 2: 验证解析 round_1 日志**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform/proxy-server"
python -c "
from parsers import parse_train_log, parse_evaluation
epochs = parse_train_log('round_1')
print(f'Epochs: {len(epochs)}, First: {epochs[0]}, Last: {epochs[-1]}')
eval_data = parse_evaluation('round_1')
print(f'Eval test_macro_f1: {eval_data[\"test_macro_f1\"]:.4f}')
"
```

预期输出：
```
Epochs: 20, First: {'epoch': 1, 'stage': 'Freeze backbone', ...}, Last: {...}
Eval test_macro_f1: 0.8778
```

- [ ] **Step 3: 提交**

```bash
git add proxy-server/parsers.py
git commit -m "feat(proxy-server): add log and eval JSON parsers"
```

---

### Task 3: FastAPI Sidecar 服务

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/main.py`

```python
"""
proxy-server/main.py
FastAPI Sidecar — 暴露训练状态 API 和 SSE 实时流
端口: 6090
"""
import asyncio
import json
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

# 本地模块
from state import (
    read_shared_state,
    write_shared_state,
    read_param_stats,
    read_train_task,
    write_train_task,
    delete_train_task,
)
from parsers import parse_train_log, parse_evaluation, list_history_rounds

ECGFOUNDER_OUTPUTS = Path("D:/ECG founder/ECGFounder/outputs")
CHECKPOINT_BASE = ECGFOUNDER_OUTPUTS

app = FastAPI(title="ECGFounder Training Sidecar", version="1.0.0")

# CORS — 允许前端 localhost:3000 访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
# 训练状态
# =====================================================================

@app.get("/api/training/state")
def get_training_state():
    """返回当前 shared_state.json"""
    return read_shared_state()


@app.get("/api/training/state/stream")
async def training_state_stream():
    """SSE 流：每 2 秒推送一次 shared_state.json"""
    async def event_generator():
        last_mtime = 0
        while True:
            state = read_shared_state()
            current_mtime = state.get("updated_at", "")
            if current_mtime != last_mtime:
                last_mtime = current_mtime
                yield {"event": "state_update", "data": json.dumps(state, default=str)}
            await asyncio.sleep(2)

    return EventSourceResponse(event_generator())


@app.get("/api/training/param-stats")
def get_param_stats():
    """返回当前 param_stats.json"""
    stats = read_param_stats()
    if stats is None:
        return JSONResponse({"error": "no param stats yet"}, status_code=404)
    return stats


@app.get("/api/training/param-stats/stream")
async def param_stats_stream():
    """SSE 流：每 5 秒推送一次 param_stats.json"""
    async def event_generator():
        last_mtime = 0
        while True:
            stats = read_param_stats()
            if stats:
                current_mtime = stats.get("timestamp", "")
                if current_mtime != last_mtime:
                    last_mtime = current_mtime
                    yield {"event": "param_update", "data": json.dumps(stats, default=str)}
            await asyncio.sleep(5)

    return EventSourceResponse(event_generator())


# =====================================================================
# 任务控制
# =====================================================================

@app.post("/api/training/task")
def submit_task(config: dict):
    """提交新训练任务"""
    state = read_shared_state()
    if state.get("status") == "training":
        raise HTTPException(400, "训练正在进行中")

    task = {
        "task_id": f"task_{int(time.time())}",
        "dataset": config.get("dataset", "MIT-BIH"),
        "config": config.get("config", {}),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    write_train_task(task)
    return {"ok": True, "task_id": task["task_id"]}


@app.get("/api/training/task/status")
def get_task_status():
    """查询训练任务队列状态"""
    task = read_train_task()
    return {"has_task": task is not None, "task": task}


# =====================================================================
# 历史记录
# =====================================================================

@app.get("/api/training/history")
def get_history():
    """列出所有历史训练轮次"""
    rounds = list_history_rounds()
    result = []
    for r in rounds:
        eval_data = parse_evaluation(r["name"])
        result.append({
            "round": r["name"],
            "number": r["number"],
            "best_f1": eval_data.get("test_macro_f1") if eval_data else None,
            "test_accuracy": eval_data.get("test_accuracy") if eval_data else None,
            "path": r["path"],
        })
    return result


@app.get("/api/training/history/{round}/log")
def get_history_log(round: str):
    """获取指定轮次的完整训练日志（结构化）"""
    epochs = parse_train_log(round)
    if not epochs:
        raise HTTPException(404, f"log not found for {round}")
    return {"round": round, "epochs": epochs}


@app.get("/api/training/history/{round}/eval")
def get_history_eval(round: str):
    """获取指定轮次的测试评估 JSON"""
    data = parse_evaluation(round)
    if data is None:
        raise HTTPException(404, f"eval not found for {round}")
    return data


@app.get("/api/training/history/{round}/param-stats")
def get_history_param(round: str):
    """获取指定轮次的参数统计历史"""
    param_file = ECGFOUNDER_OUTPUTS / round / "param_history.json"
    if not param_file.exists():
        return JSONResponse({"error": "param_history not found"}, status_code=404)
    return json.loads(param_file.read_text(encoding="utf-8"))


# =====================================================================
# Checkpoint
# =====================================================================

@app.get("/api/checkpoints")
def list_checkpoints():
    """列出所有 checkpoint 文件"""
    rounds = list_history_rounds()
    result = []
    for r in rounds:
        ckpt_file = ECGFOUNDER_OUTPUTS / r["name"] / "best_macro_f1.pth"
        if ckpt_file.exists():
            eval_data = parse_evaluation(r["name"])
            result.append({
                "round": r["name"],
                "number": r["number"],
                "filename": "best_macro_f1.pth",
                "size_bytes": ckpt_file.stat().st_size,
                "best_f1": eval_data.get("test_macro_f1") if eval_data else None,
            })
    return result


@app.get("/api/checkpoints/{round}/{filename}")
def download_checkpoint(round: str, filename: str):
    """下载指定 checkpoint 文件"""
    ckpt_file = ECGFOUNDER_OUTPUTS / round / filename
    if not ckpt_file.exists():
        raise HTTPException(404, "checkpoint not found")
    return FileResponse(
        str(ckpt_file),
        filename=filename,
        media_type="application/octet-stream"
    )


# =====================================================================
# 健康检查
# =====================================================================

@app.get("/health")
def health():
    return {"status": "ok", "service": "ecgfounder-sidecar", "port": 6090}
```

- [ ] **Step 1: 安装 FastAPI 依赖**

```bash
pip install fastapi uvicorn sse-starlette
```

- [ ] **Step 2: 验证服务可启动**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform/proxy-server"
python -c "from main import app; print('FastAPI app OK')"
```

- [ ] **Step 3: 启动服务测试**

```bash
python -m uvicorn main:app --host 0.0.0.0 --port 6090
# 浏览器访问 http://localhost:6090/health 应返回 {"status": "ok"}
# 访问 http://localhost:6090/api/training/history 应返回历史记录列表
```

- [ ] **Step 4: 提交**

```bash
git add proxy-server/main.py
git commit -m "feat(proxy-server): FastAPI sidecar with training state API and SSE"
```

---

## 阶段 2：训练管控进程

### Task 4: finetune_runner.py（受控训练脚本）

**Files:**
- Create: `D:/ECG founder/ECGFounder/finetune_runner.py`

```python
"""
D:/ECG founder/ECGFounder/finetune_runner.py
受控训练脚本：
- 每 5 秒检查 train_task.json 是否存在且 status=queued
- 启动原训练脚本 finetune_mitbih_ecgfounder_gpu_amp.py
- 每 epoch 解析日志写入 shared_state.json
- 不修改任何原训练代码
"""
import json
import subprocess
import time
import traceback
from datetime import datetime
from pathlib import Path
from threading import Thread
from typing import Optional

# 导入状态读写（需要把 state.py 路径加进来）
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "VS vibe coding files/ecg-annotation-platform/proxy-server"))
from state import (
    read_shared_state,
    write_shared_state,
    read_train_task,
    delete_train_task,
)

ECGFOUNDER_BASE = Path("D:/ECG founder/ECGFounder")
OUTPUTS = ECGFOUNDER_BASE / "outputs"
LOG_FILE = None  # 当前训练的日志文件路径


def find_next_round() -> str:
    """找下一个可用 round 编号"""
    existing = [int(d.name.split("_")[1]) for d in OUTPUTS.iterdir()
                if d.is_dir() and d.name.startswith("round_")]
    next_num = max(existing) + 1 if existing else 1
    return f"round_{next_num}"


def wait_for_train_task(poll_interval: float = 5.0):
    """主循环：等待 train_task.json"""
    print("[finetune_runner] 启动，等待训练任务...")

    while True:
        task = read_train_task()
        if task and task.get("status") != "queued":
            # 有任务但未标记为 queued，重新写入 queued
            task["status"] = "queued"
            import sys
            sys.path.insert(0, str(Path(__file__).parent.parent / "VS vibe coding files/ecg-annotation-platform/proxy-server"))
            from state import write_train_task
            write_train_task(task)

        if task:
            round_name = find_next_round()
            run_training(round_name, task)
            delete_train_task()

        time.sleep(poll_interval)


def run_training(round_name: str, task: dict):
    """执行单次训练"""
    global LOG_FILE
    config = task.get("config", {})
    epochs = config.get("epochs", 20)
    output_dir = OUTPUTS / round_name
    output_dir.mkdir(exist_ok=True)

    LOG_FILE = OUTPUTS / f"train_{round_name}.log"

    # 更新状态
    write_shared_state({
        "status": "training",
        "round": round_name,
        "current_epoch": 0,
        "total_epochs": epochs,
        "stage": "starting",
        "train_loss": None,
        "train_acc": None,
        "train_f1": None,
        "val_acc": None,
        "val_macro_f1": None,
        "lr": None,
        "message": f"Starting {round_name}...",
        "error": None,
        "started_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
    })

    # 构建训练命令（使用原脚本，不修改）
    script = ECGFOUNDER_BASE / "finetune_mitbih_ecgfounder_gpu_amp.py"
    cmd = [
        sys.executable,  # 当前 Python（应在 conda 环境中）
        str(script),
        "--output_dir", str(output_dir),
        "--epochs", str(epochs),
        # 其他参数从 config 映射
    ]
    if config.get("batch_size"):
        cmd.extend(["--batch_size", str(config["batch_size"])])
    if config.get("lr_backbone"):
        cmd.extend(["--lr_backbone", str(config["lr_backbone"])])
    if config.get("balance_before_split"):
        cmd.append("--balance_before_split")
    if config.get("unfreeze_mode"):
        cmd.extend(["--unfreeze_mode", config["unfreeze_mode"]])

    print(f"[finetune_runner] 启动训练: {' '.join(cmd)}")

    try:
        # 启动子进程，stdout 写入日志文件
        with LOG_FILE.open("w", encoding="utf-8") as log_f:
            proc = subprocess.Popen(
                cmd,
                stdout=log_f,
                stderr=subprocess.STDOUT,
                cwd=str(ECGFOUNDER_BASE),
            )
            proc.wait()

        # 解析最终日志，更新状态
        epochs_data = _parse_log_epochs(LOG_FILE.read_text(encoding="utf-8"))
        best_epoch = max(epochs_data, key=lambda e: e.get("val_macro_f1", 0))
        write_shared_state({
            "status": "done",
            "round": round_name,
            "current_epoch": epochs_data[-1]["epoch"],
            "total_epochs": epochs,
            "stage": "done",
            "best_macro_f1": best_epoch.get("val_macro_f1"),
            "message": f"Training complete. Best F1: {best_epoch.get('val_macro_f1'):.4f}",
            "error": None,
            "updated_at": datetime.now().isoformat(),
        })
        print(f"[finetune_runner] 训练完成: {round_name}, Best F1: {best_epoch.get('val_macro_f1'):.4f}")

    except Exception as e:
        error_msg = traceback.format_exc()
        print(f"[finetune_runner] 训练出错: {error_msg}")
        write_shared_state({
            "status": "error",
            "round": round_name,
            "error": str(e),
            "message": f"Training failed: {e}",
            "updated_at": datetime.now().isoformat(),
        })


def _parse_log_epochs(log_text: str) -> list[dict]:
    """从日志文本解析所有 epoch 数据"""
    import re
    epochs = []
    current = {}

    for line in log_text.splitlines():
        line = line.strip()

        epoch_match = re.match(r"Epoch\s+(\d+)\s+\(Stage\s+\d+\)", line)
        if epoch_match:
            if current:
                epochs.append(current)
            current = {"epoch": int(epoch_match.group(1))}
            continue

        train_match = re.match(r"Train\s+Loss=([\d.]+)\s+Acc=([\d.]+)\s+F1=([\d.]+)", line)
        if train_match:
            current["train_loss"] = float(train_match.group(1))
            current["train_acc"] = float(train_match.group(2))
            current["train_f1"] = float(train_match.group(3))
            continue

        val_match = re.match(
            r"Val\s+Acc=([\d.]+)\s+MacroF1=([\d.]+)\s+WeightedF1=([\d.]+)(?:\s+LR=([\d.e+-]+))?",
            line
        )
        if val_match:
            current["val_acc"] = float(val_match.group(1))
            current["val_macro_f1"] = float(val_match.group(2))
            if val_match.group(4):
                current["lr"] = float(val_match.group(4))

        stage_match = re.match(r"=+\s*Stage \d+:\s*(.+?),\s*lr=(.+?)\s*=+", line)
        if stage_match:
            current["stage"] = stage_match.group(1).strip()

        # 实时更新 shared_state（每 epoch 末）
        if "epoch" in current and "train_loss" in current:
            write_shared_state({
                "status": "training",
                "current_epoch": current["epoch"],
                "total_epochs": 20,
                "stage": current.get("stage", "training"),
                "train_loss": current.get("train_loss"),
                "train_acc": current.get("train_acc"),
                "train_f1": current.get("train_f1"),
                "val_macro_f1": current.get("val_macro_f1"),
                "lr": current.get("lr"),
                "message": f"Epoch {current['epoch']} {current.get('stage', '')} "
                           f"Loss={current.get('train_loss', 0):.4f} "
                           f"Acc={current.get('train_acc', 0):.4f}",
                "updated_at": datetime.now().isoformat(),
            })

    if current:
        epochs.append(current)
    return epochs


if __name__ == "__main__":
    wait_for_train_task()
```

- [ ] **Step 1: 创建 finetune_runner.py**

- [ ] **Step 2: 验证脚本可导入（不运行主循环）**

```bash
cd "D:/ECG founder/ECGFounder"
python -c "import sys; sys.path.insert(0, '../VS vibe coding files/ecg-annotation-platform/proxy-server'); from state import read_shared_state; print(read_shared_state())"
```

- [ ] **Step 3: 提交**

```bash
git add "D:/ECG founder/ECGFounder/finetune_runner.py"
git commit -m "feat(ecgfounder): add finetune_runner.py 受控训练脚本"
```

---

### Task 5: param_observer.py（独立参数统计进程）

**Files:**
- Create: `D:/ECG founder/ECGFounder/param_observer.py`

```python
"""
D:/ECG founder/ECGFounder/param_observer.py
独立参数统计观察进程：
- 轮询 shared_state.json，检测 epoch 变化
- 加载当前 checkpoint，计算各层参数统计
- 写入 param_stats.json 和 round_N/param_history.json
- 不修改任何原训练代码
"""
import json
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional

# 添加 state.py 路径
sys.path.insert(0, str(Path(__file__).parent.parent / "VS vibe coding files/ecg-annotation-platform/proxy-server"))
from state import read_shared_state, read_shared_state_raw, write_param_stats

ECGFOUNDER_BASE = Path("D:/ECG founder/ECGFounder")
OUTPUTS = ECGFOUNDER_BASE / "outputs"
PARAM_STATS_FILE = ECGFOUNDER_BASE / "param_stats.json"


def find_best_checkpoint(round_name: str) -> Optional[Path]:
    """找指定 round 的 checkpoint"""
    ckpt = OUTPUTS / round_name / "best_macro_f1.pth"
    return ckpt if ckpt.exists() else None


def compute_param_stats(checkpoint_path: Path) -> dict:
    """
    加载 checkpoint，计算各层参数统计。
    依赖 torch（需在 conda 环境中运行）。
    """
    import torch

    ckpt = torch.load(checkpoint_path, map_location="cpu")

    # 尝试从完整 checkpoint 加载模型 state_dict
    if "model_state_dict" in ckpt:
        state_dict = ckpt["model_state_dict"]
    elif "state_dict" in ckpt:
        state_dict = ckpt["state_dict"]
    else:
        state_dict = ckpt

    layers = []
    total_norm = 0.0
    trainable = 0
    frozen = 0

    for name, param in state_dict.items():
        if not isinstance(param, torch.Tensor):
            continue

        data = param.detach().cpu().float()
        grad = param.grad
        grad_data = grad.detach().cpu().float() if grad is not None else None

        item = {
            "name": name,
            "shape": list(data.shape),
            "mean": float(data.mean().item()),
            "std": float(data.std().item()),
            "min": float(data.min().item()),
            "max": float(data.max().item()),
            "grad_mean": float(grad_data.mean().item()) if grad_data is not None else None,
            "grad_std": float(grad_data.std().item()) if grad_data is not None else None,
        }
        layers.append(item)

        # 计算 global norm（用于训练稳定性监控）
        if grad_data is not None:
            total_norm += (grad_data.norm().item() ** 2)

        if param.requires_grad:
            trainable += param.numel()
        else:
            frozen += param.numel()

    global_norm = total_norm ** 0.5

    return {
        "layers": layers,
        "global_norm": global_norm,
        "trainable_params": trainable,
        "frozen_params": frozen,
    }


def append_to_param_history(round_name: str, epoch: int, stats: dict):
    """追加本 epoch 统计到 round_N/param_history.json"""
    history_file = OUTPUTS / round_name / "param_history.json"
    if history_file.exists():
        history = json.loads(history_file.read_text(encoding="utf-8"))
    else:
        history = {"round": round_name, "epochs": []}

    # 如果是新 epoch（ID 不重复），追加
    existing_epochs = [e["epoch"] for e in history["epochs"]]
    if epoch not in existing_epochs:
        history["epochs"].append({
            "epoch": epoch,
            "timestamp": datetime.now().isoformat(),
            "global_norm": stats["global_norm"],
            "trainable_params": stats["trainable_params"],
            "frozen_params": stats["frozen_params"],
            # 只保留各层 mean/std，不保留完整梯度
            "layer_summary": [
                {"name": l["name"], "mean": l["mean"], "std": l["std"]}
                for l in stats["layers"]
            ],
        })
        history_file.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")


def main(poll_interval: float = 5.0):
    print("[param_observer] 启动，开始监控训练状态...")

    last_epoch = 0
    current_round: Optional[str] = None

    while True:
        try:
            state = read_shared_state()
        except Exception:
            state = {}

        status = state.get("status", "idle")
        round_name = state.get("round")
        epoch = state.get("current_epoch", 0)

        if status == "training" and round_name:
            # 检测到新 epoch
            if epoch > last_epoch or round_name != current_round:
                last_epoch = epoch
                current_round = round_name

                ckpt_path = find_best_checkpoint(round_name)
                if ckpt_path:
                    try:
                        stats = compute_param_stats(ckpt_path)
                        stats["round"] = round_name
                        stats["epoch"] = epoch
                        stats["timestamp"] = datetime.now().isoformat()

                        write_param_stats(stats)
                        append_to_param_history(round_name, epoch, stats)

                        print(f"[param_observer] Epoch {epoch}: global_norm={stats['global_norm']:.4f}")
                    except Exception as e:
                        print(f"[param_observer] 计算参数统计失败: {e}")

        elif status in ("done", "error", "idle"):
            # 训练结束/未开始，重置信
            if status in ("done", "error"):
                last_epoch = 0
                current_round = None

        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
```

- [ ] **Step 1: 创建 param_observer.py**

- [ ] **Step 2: 验证 torch 可导入**

```bash
cd "D:/ECG founder/ECGFounder"
python -c "import torch; print(f'torch {torch.__version__}')"
```

- [ ] **Step 3: 提交**

```bash
git add "D:/ECG founder/ECGFounder/param_observer.py"
git commit -m "feat(ecgfounder): add param_observer.py 独立参数统计进程"
```

---

### Task 6: 一键启动脚本

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/proxy-server/run_platform.bat`

```batch
@echo off
chcp 65001 >nul
echo ========================================
echo ECGFounder Training Platform 启动器
echo ========================================

set SCRIPT_DIR=%~dp0
set PROXY_DIR=%SCRIPT_DIR%
set ECGFOUNDER_DIR=D:\ECG founder\ECGFounder

echo.
echo [1/3] 启动 FastAPI Sidecar (端口 6090)...
start "ECGFounder-Sidecar" cmd /c "cd /d %PROXY_DIR% && python -m uvicorn main:app --host 0.0.0.0 --port 6090"

echo.
echo [2/3] 启动 finetune_runner (训练控制器)...
start "finetune-runner" cmd /c "cd /d %ECGFOUNDER_DIR% && python finetune_runner.py"

echo.
echo [3/3] 启动 param_observer (参数统计监控)...
start "param-observer" cmd /c "cd /d %ECGFOUNDER_DIR% && python param_observer.py"

echo.
echo ========================================
echo 全部进程已启动！
echo Sidecar: http://localhost:6090
echo 前端:    http://localhost:3000
echo ========================================
echo.
pause
```

- [ ] **Step 1: 创建 run_platform.bat**

- [ ] **Step 2: 提交**

```bash
git add proxy-server/run_platform.bat
git commit -m "feat(proxy-server): add run_platform.bat 一键启动脚本"
```

---

## 阶段 3：前端服务层 + 路由

### Task 7: trainingApi.ts

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/src/services/trainingApi.ts`

```typescript
/**
 * src/services/trainingApi.ts
 * 训练看板相关 API 调用
 */
const API_BASE = 'http://localhost:6090';

export interface TrainingState {
  status: 'idle' | 'training' | 'done' | 'error';
  round?: string;
  current_epoch?: number;
  total_epochs?: number;
  stage?: string;
  train_loss?: number;
  train_acc?: number;
  train_f1?: number;
  val_acc?: number;
  val_macro_f1?: number;
  lr?: number;
  message?: string;
  error?: string | null;
  started_at?: string;
  updated_at?: string;
}

export interface ParamStats {
  round: string;
  epoch: number;
  timestamp: string;
  layers: Array<{
    name: string;
    shape: number[];
    mean: number;
    std: number;
    min: number;
    max: number;
    grad_mean?: number;
    grad_std?: number;
  }>;
  global_norm: number;
  trainable_params: number;
  frozen_params: number;
}

export interface TrainTaskConfig {
  dataset: string;
  config: {
    epochs: number;
    batch_size: number;
    lr_backbone: number;
    balance_before_split: boolean;
    unfreeze_mode: string;
  };
}

export interface HistoryRound {
  round: string;
  number: number;
  best_f1?: number;
  test_accuracy?: number;
  path: string;
}

export interface EpochData {
  epoch: number;
  stage: string;
  train_loss: number;
  train_acc: number;
  train_f1: number;
  val_acc: number;
  val_macro_f1: number;
  val_weighted_f1: number;
  lr: number;
  is_best: boolean;
  best_macro_f1?: number;
}

export interface EvaluationData {
  model: string;
  checkpoint: string;
  val_macro_f1_original: number;
  val_subset_macro_f1: number;
  test_accuracy: number;
  test_macro_f1: number;
  test_weighted_f1: number;
  test_per_class_f1: Record<string, number>;
  confusion_matrix: number[][];
  classification_report: string;
  test_samples_count: number;
}

export interface CheckpointInfo {
  round: string;
  number: number;
  filename: string;
  size_bytes: number;
  best_f1?: number;
}

export interface ParamHistory {
  round: string;
  epochs: Array<{
    epoch: number;
    timestamp: string;
    global_norm: number;
    trainable_params: number;
    frozen_params: number;
    layer_summary: Array<{ name: string; mean: number; std: number }>;
  }>;
}

// 历史训练记录列表
export async function getHistoryRounds(): Promise<HistoryRound[]> {
  const res = await fetch(`${API_BASE}/api/training/history`);
  if (!res.ok) throw new Error('Failed to fetch history');
  return res.json();
}

// 指定轮次训练日志（结构化）
export async function getHistoryLog(round: string): Promise<{ round: string; epochs: EpochData[] }> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/log`);
  if (!res.ok) throw new Error(`Failed to fetch log for ${round}`);
  return res.json();
}

// 指定轮次评估数据
export async function getHistoryEval(round: string): Promise<EvaluationData> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/eval`);
  if (!res.ok) throw new Error(`Failed to fetch eval for ${round}`);
  return res.json();
}

// 指定轮次参数统计历史
export async function getHistoryParamStats(round: string): Promise<ParamHistory> {
  const res = await fetch(`${API_BASE}/api/training/history/${round}/param-stats`);
  if (!res.ok) throw new Error(`Failed to fetch param stats for ${round}`);
  return res.json();
}

// 当前训练状态
export async function getTrainingState(): Promise<TrainingState> {
  const res = await fetch(`${API_BASE}/api/training/state`);
  if (!res.ok) throw new Error('Failed to fetch training state');
  return res.json();
}

// SSE 实时训练状态流
export function createTrainingStateStream(
  onMessage: (state: TrainingState) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/training/state/stream`);
  es.addEventListener('state_update', (e) => {
    onMessage(JSON.parse(e.data));
  });
  if (onError) es.onerror = onError;
  return () => es.close();
}

// 当前参数统计
export async function getParamStats(): Promise<ParamStats | null> {
  const res = await fetch(`${API_BASE}/api/training/param-stats`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch param stats');
  return res.json();
}

// SSE 实时参数统计流
export function createParamStatsStream(
  onMessage: (stats: ParamStats) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/api/training/param-stats/stream`);
  es.addEventListener('param_update', (e) => {
    onMessage(JSON.parse(e.data));
  });
  if (onError) es.onerror = onError;
  return () => es.close();
}

// 发起新训练
export async function submitTrainingTask(config: TrainTaskConfig): Promise<{ ok: boolean; task_id: string }> {
  const res = await fetch(`${API_BASE}/api/training/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to submit training task');
  return res.json();
}

// Checkpoint 列表
export async function getCheckpoints(): Promise<CheckpointInfo[]> {
  const res = await fetch(`${API_BASE}/api/checkpoints`);
  if (!res.ok) throw new Error('Failed to fetch checkpoints');
  return res.json();
}

// 下载 Checkpoint
export function getCheckpointUrl(round: string, filename: string): string {
  return `${API_BASE}/api/checkpoints/${round}/${filename}`;
}
```

- [ ] **Step 1: 创建 trainingApi.ts**

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform"
npx tsc --noEmit src/services/trainingApi.ts
```

- [ ] **Step 3: 提交**

```bash
git add src/services/trainingApi.ts
git commit -m "feat: add trainingApi service for ECGFounder training dashboard"
```

---

### Task 8: 添加前端路由

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/src/App.tsx:10-16`

在 import 部分添加：
```typescript
const TrainingDashboard = lazy(() => import(/* webpackChunkName: "training-dashboard-page" */ './pages/TrainingDashboard'));
```

在 Routes 中添加：
```tsx
<Route path="/training" element={<TrainingDashboard />} />
```

- [ ] **Step 1: 修改 App.tsx 添加路由**

- [ ] **Step 2: 提交**

```bash
git add src/App.tsx
git commit -m "feat: add /training route for ECGFounder dashboard"
```

---

## 阶段 4：前端看板 UI

### Task 9: TrainingDashboard — 历史记录 Tab（曲线 + 指标）

**Files:**
- Create: `D:/VS vibe coding files/ecg-annotation-platform/src/pages/TrainingDashboard.tsx`

> 完整组件代码（分片段实现）：

**Part 1: 基础结构 + 历史记录表格**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Table, Tabs, Card, Row, Col, Tag, Spin, Empty, Button,
  Progress, Statistic, Space, Typography, Modal, Select, Descriptions,
} from 'antd';
import {
  CheckCircleOutlined, LoadingOutlined, StopOutlined,
  DownloadOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import * as trainingApi from '../services/trainingApi';
import type { HistoryRound, EpochData, EvaluationData, ParamHistory } from '../services/trainingApi';
import TrainingCharts from './components/TrainingCharts';
import ParamStatsPanel from './components/ParamStatsPanel';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

// ---------------------------------------------------------------------------
// 历史记录表格
// ---------------------------------------------------------------------------
interface HistoryTableProps {
  rounds: HistoryRound[];
  loading: boolean;
  onSelectRound: (round: HistoryRound) => void;
}

function HistoryTable({ rounds, loading, onSelectRound }: HistoryTableProps) {
  const columns = [
    {
      title: '轮次',
      dataIndex: 'round',
      key: 'round',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '测试 Macro F1',
      dataIndex: 'best_f1',
      key: 'best_f1',
      render: (v?: number) => v ? <Text strong style={{ color: '#52c41a' }}>{v.toFixed(4)}</Text> : '-',
      sorter: (a: HistoryRound, b: HistoryRound) => (a.best_f1 ?? 0) - (b.best_f1 ?? 0),
    },
    {
      title: '测试 Accuracy',
      dataIndex: 'test_accuracy',
      key: 'test_accuracy',
      render: (v?: number) => v ? v.toFixed(4) : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: HistoryRound) => (
        <Button size="small" onClick={() => onSelectRound(record)}>
          查看详情
        </Button>
      ),
    },
  ];

  return <Table dataSource={rounds} columns={columns} loading={loading} rowKey="round" />;
}

// ---------------------------------------------------------------------------
// 训练详情弹窗
// ---------------------------------------------------------------------------
interface DetailModalProps {
  round: HistoryRound | null;
  visible: boolean;
  onClose: () => void;
}

function DetailModal({ round, visible, onClose }: DetailModalProps) {
  const [epochs, setEpochs] = useState<EpochData[]>([]);
  const [evalData, setEvalData] = useState<EvaluationData | null>(null);
  const [paramHistory, setParamHistory] = useState<ParamHistory | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!round) return;
    setLoading(true);
    Promise.all([
      trainingApi.getHistoryLog(round.round),
      trainingApi.getHistoryEval(round.round),
      trainingApi.getHistoryParamStats(round.round).catch(() => null),
    ]).then(([logRes, evalRes, paramRes]) => {
      setEpochs(logRes.epochs);
      setEvalData(evalRes);
      setParamHistory(paramRes);
    }).finally(() => setLoading(false));
  }, [round]);

  if (!round) return null;

  return (
    <Modal open={visible} onCancel={onClose} width={1100} footer={null} title={`${round.round} 详情`}>
      <Spin indicator={<LoadingOutlined spin />} spinning={loading}>
        <Tabs defaultActiveKey="curves">
          <TabPane tab="训练曲线" key="curves">
            <TrainingCharts epochs={epochs} evalData={evalData} />
          </TabPane>
          <TabPane tab="参数统计" key="params">
            <ParamStatsPanel paramHistory={paramHistory} />
          </TabPane>
          <TabPane tab="评估结果" key="eval">
            <Descriptions bordered column={2}>
              <Descriptions.Item label="测试 Accuracy">{evalData?.test_accuracy?.toFixed(4)}</Descriptions.Item>
              <Descriptions.Item label="测试 Macro F1">{evalData?.test_macro_f1?.toFixed(4)}</Descriptions.Item>
              {evalData?.test_per_class_f1 && Object.entries(evalData.test_per_class_f1).map(([k, v]) => (
                <Descriptions.Item key={k} label={`F1 (${k})`}>{v.toFixed(4)}</Descriptions.Item>
              ))}
            </Descriptions>
          </TabPane>
        </Tabs>
      </Spin>
    </Modal>
  );
}
```

**Part 2: 实时训练面板**

```tsx
// ---------------------------------------------------------------------------
// 实时训练面板
// ---------------------------------------------------------------------------
interface LiveTrainingPanelProps {
  onSubmitTask: (config: trainingApi.TrainTaskConfig) => void;
}

function LiveTrainingPanel({ onSubmitTask }: LiveTrainingPanelProps) {
  const [state, setState] = useState<trainingApi.TrainingState | null>(null);
  const [paramStats, setParamStats] = useState<trainingApi.ParamStats | null>(null);
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<trainingApi.TrainTaskConfig>({
    dataset: 'MIT-BIH',
    config: { epochs: 20, batch_size: 32, lr_backbone: 1e-5, balance_before_split: true, unfreeze_mode: 'all' },
  });

  useEffect(() => {
    // 获取初始状态
    trainingApi.getTrainingState().then(setState).catch(console.error);

    // SSE 连接
    const closeState = trainingApi.createTrainingStateStream(
      (s) => { setState(s); setConnected(true); },
      () => setConnected(false)
    );
    const closeParams = trainingApi.createParamStatsStream(
      (p) => { setParamStats(p); },
      () => {}
    );

    return () => { closeState(); closeParams(); };
  }, []);

  const progress = state && state.total_epochs
    ? Math.round((state.current_epoch! / state.total_epochs) * 100)
    : 0;

  const isTraining = state?.status === 'training';
  const isDone = state?.status === 'done';
  const isError = state?.status === 'error';

  return (
    <Card
      title={
        <Space>
          <ThunderboltOutlined />
          实时训练
          <Tag color={connected ? 'green' : 'red'}>{connected ? '已连接' : '未连接'}</Tag>
        </Space>
      }
    >
      {/* 状态卡片 */}
      {isTraining && (
        <>
          <Row gutter={16}>
            <Col span={12}>
              <Progress percent={progress} status="active" />
              <Text type="secondary">{state!.message}</Text>
            </Col>
            <Col span={6}>
              <Statistic title="Epoch" value={`${state!.current_epoch}/${state!.total_epochs}`} />
            </Col>
            <Col span={6}>
              <Statistic title="Stage" value={state!.stage} />
            </Col>
          </Row>
          <Row gutter={16} style={{ marginTop: 16 }}>
            <Col span={4}><Statistic title="Train Loss" value={state!.train_loss?.toFixed(4) ?? '-'} /></Col>
            <Col span={4}><Statistic title="Train Acc" value={state!.train_acc?.toFixed(4) ?? '-'} /></Col>
            <Col span={4}><Statistic title="Val F1" value={state!.val_macro_f1?.toFixed(4) ?? '-'} /></Col>
            <Col span={4}><Statistic title="LR" value={state!.lr?.toExponential(2) ?? '-'} /></Col>
            <Col span={4}><Statistic title="Global Norm" value={paramStats?.global_norm?.toFixed(4) ?? '-'} /></Col>
          </Row>
          <ParamStatsPanel paramStats={paramStats} live />
        </>
      )}

      {isDone && <Alert type="success" message={`训练完成！最佳 F1: ${state!.message}`} showIcon />}
      {isError && <Alert type="error" message={`训练失败: ${state!.error}`} showIcon />}
      {state?.status === 'idle' && <Text type="secondary">当前无训练任务</Text>}

      {/* 发起训练表单 */}
      <div style={{ marginTop: 24, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text strong>发起新训练</Text>
          <Space wrap>
            <InputNumber label="Epochs" defaultValue={20} min={1} onChange={(v) => setConfig({ ...config, config: { ...config.config, epochs: v || 20 } })} />
            <InputNumber label="Batch Size" defaultValue={32} min={1} onChange={(v) => setConfig({ ...config, config: { ...config.config, batch_size: v || 32 } })} />
            <InputNumber label="LR Backbone" defaultValue={1e-5} min={0} step={1e-5} onChange={(v) => setConfig({ ...config, config: { ...config.config, lr_backbone: v || 1e-5 } })} />
          </Space>
          <Button
            type="primary"
            disabled={isTraining}
            onClick={() => onSubmitTask(config)}
            icon={isTraining ? <LoadingOutlined /> : <ThunderboltOutlined />}
          >
            {isTraining ? '训练中...' : '开始训练'}
          </Button>
        </Space>
      </div>
    </Card>
  );
}
```

**Part 3: 主组件 + Checkpoint 管理 + 最终导出**

```tsx
// ---------------------------------------------------------------------------
// Checkpoint 管理
// ---------------------------------------------------------------------------
interface CheckpointPanelProps {
  onDownload: (round: string, filename: string) => void;
}

function CheckpointPanel({ onDownload }: CheckpointPanelProps) {
  const [checkpoints, setCheckpoints] = useState<trainingApi.CheckpointInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    trainingApi.getCheckpoints().then(setCheckpoints).finally(() => setLoading(false));
  }, []);

  const columns = [
    { title: '轮次', dataIndex: 'round', key: 'round', render: (v: string) => <Tag>{v}</Tag> },
    {
      title: '文件大小',
      dataIndex: 'size_bytes',
      key: 'size_bytes',
      render: (v: number) => `${(v / 1024 / 1024).toFixed(1)} MB`,
    },
    {
      title: 'Best F1',
      dataIndex: 'best_f1',
      key: 'best_f1',
      render: (v?: number) => v ? v.toFixed(4) : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: trainingApi.CheckpointInfo) => (
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() => onDownload(record.round, record.filename)}
        >
          下载
        </Button>
      ),
    },
  ];

  return <Table dataSource={checkpoints} columns={columns} loading={loading} rowKey="round" />;
}

// ---------------------------------------------------------------------------
// 主页面
// ---------------------------------------------------------------------------
const TrainingDashboard: React.FC = () => {
  const [rounds, setRounds] = useState<HistoryRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRound, setSelectedRound] = useState<HistoryRound | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const loadHistory = useCallback(() => {
    setLoading(true);
    trainingApi.getHistoryRounds().then(setRounds).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSelectRound = (round: HistoryRound) => {
    setSelectedRound(round);
    setDetailVisible(true);
  };

  const handleSubmitTask = async (config: trainingApi.TrainTaskConfig) => {
    try {
      await trainingApi.submitTrainingTask(config);
    } catch (e) {
      console.error('提交训练任务失败:', e);
    }
  };

  const handleDownload = (round: string, filename: string) => {
    const url = trainingApi.getCheckpointUrl(round, filename);
    window.open(url, '_blank');
  };

  return (
    <div className="page-shell page-shell-wide">
      <div className="page-hero">
        <Title>ECGFounder 训练看板</Title>
        <Text type="secondary">
          实时监控微调训练，查看历史记录和参数统计
        </Text>
      </div>

      <Tabs defaultActiveKey="history">
        <TabPane tab="历史训练记录" key="history">
          <Card>
            <HistoryTable rounds={rounds} loading={loading} onSelectRound={handleSelectRound} />
          </Card>
        </TabPane>

        <TabPane tab="实时训练" key="live">
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <LiveTrainingPanel onSubmitTask={handleSubmitTask} />
            </Col>
          </Row>
        </TabPane>

        <TabPane tab="Checkpoint 管理" key="checkpoints">
          <Card>
            <CheckpointPanel onDownload={handleDownload} />
          </Card>
        </TabPane>
      </Tabs>

      <DetailModal
        round={selectedRound}
        visible={detailVisible}
        onClose={() => setDetailVisible(false)}
      />
    </div>
  );
};

export default TrainingDashboard;
```

- [ ] **Step 1: 创建 TrainingDashboard.tsx（完整文件）**

- [ ] **Step 2: 创建图表组件 TrainingCharts.tsx**

```tsx
// src/pages/components/TrainingCharts.tsx
import React from 'react';
import { Row, Col, Card } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { EpochData, EvaluationData } from '../../services/trainingApi';

interface Props {
  epochs: EpochData[];
  evalData?: EvaluationData | null;
}

export default function TrainingCharts({ epochs, evalData }: Props) {
  const epochsArr = epochs.map(e => e.epoch);
  const trainLoss = epochs.map(e => e.train_loss);
  const trainAcc = epochs.map(e => e.train_acc);
  const valF1 = epochs.map(e => e.val_macro_f1);

  const lossOption = {
    title: { text: 'Loss 曲线' },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: epochsArr },
    yAxis: { type: 'value', name: 'Loss' },
    series: [{ name: 'Train Loss', type: 'line', data: trainLoss, smooth: true }],
  };

  const accOption = {
    title: { text: 'Accuracy / F1 曲线' },
    tooltip: { trigger: 'axis' },
    legend: { data: ['Train Acc', 'Val Macro F1'] },
    xAxis: { type: 'category', data: epochsArr },
    yAxis: { type: 'value', name: 'Score' },
    series: [
      { name: 'Train Acc', type: 'line', data: trainAcc, smooth: true },
      { name: 'Val Macro F1', type: 'line', data: valF1, smooth: true },
    ],
  };

  const perClassF1 = evalData?.test_per_class_f1;
  const classBarOption = perClassF1 ? {
    title: { text: 'Per-Class F1' },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: Object.keys(perClassF1) },
    yAxis: { type: 'value', min: 0, max: 1 },
    series: [{
      type: 'bar',
      data: Object.values(perClassF1).map(v => parseFloat(v.toFixed(4))),
      itemStyle: { color: '#5470c6' },
    }],
  } : null;

  const confusionMatrix = evalData?.confusion_matrix;
  const cmOption = confusionMatrix ? {
    title: { text: 'Confusion Matrix' },
    tooltip: { trigger: 'cell' },
    xAxis: { type: 'category', data: Object.keys(perClassF1!) },
    yAxis: { type: 'category', data: Object.keys(perClassF1!) },
    series: [{ type: 'heatmap', data: confusionMatrix.map((row, i) => row.map((v, j) => [j, i, v])), 
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' } } }],
    visualMap: { min: 0, max: Math.max(...confusionMatrix.flat()), calculable: true, inRange: { color: ['#fff', '#5470c6'] } },
  } : null;

  return (
    <Row gutter={[16, 16]}>
      <Col span={12}><ReactECharts option={lossOption} style={{ height: 300 }} /></Col>
      <Col span={12}><ReactECharts option={accOption} style={{ height: 300 }} /></Col>
      {classBarOption && <Col span={12}><ReactECharts option={classBarOption} style={{ height: 300 }} /></Col>}
      {cmOption && <Col span={12}><ReactECharts option={cmOption} style={{ height: 300 }} /></Col>}
    </Row>
  );
}
```

- [ ] **Step 3: 创建参数统计面板 ParamStatsPanel.tsx**

```tsx
// src/pages/components/ParamStatsPanel.tsx
import React, { useState } from 'react';
import { Row, Col, Card, Select, Spin } from 'antd';
import ReactECharts from 'echarts-for-react';
import type { ParamStats, ParamHistory } from '../../services/trainingApi';

interface Props {
  paramStats?: ParamStats | null;
  paramHistory?: ParamHistory | null;
  live?: boolean;
}

export default function ParamStatsPanel({ paramStats, paramHistory, live }: Props) {
  const [selectedLayer, setSelectedLayer] = useState<string>('');

  if (!paramStats && !paramHistory) {
    return <Card><p>暂无参数统计数据</p></Card>;
  }

  // 实时模式：用 paramStats.layers
  if (live && paramStats) {
    const layers = paramStats.layers;
    const layerNames = layers.map(l => l.name);
    const activeLayer = selectedLayer && layers.find(l => l.name === selectedLayer);

    return (
      <Card title="实时参数统计">
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <p>Global Norm: <strong>{paramStats.global_norm.toFixed(4)}</strong></p>
            <p>Trainable Params: {paramStats.trainable_params.toLocaleString()}</p>
            <Select
              style={{ width: 300 }}
              placeholder="选择层查看详情"
              options={layerNames.map(n => ({ label: n, value: n }))}
              onChange={setSelectedLayer}
              showSearch
            />
          </Col>
          {activeLayer && (
            <Col span={12}>
              <p>Layer: {activeLayer.name}</p>
              <p>Mean: {activeLayer.mean.toFixed(6)}</p>
              <p>Std: {activeLayer.std.toFixed(6)}</p>
              <p>Min/Max: {activeLayer.min.toFixed(4)} / {activeLayer.max.toFixed(4)}</p>
              {activeLayer.grad_mean !== null && <p>Grad Mean: {activeLayer.grad_mean.toFixed(6)}</p>}
            </Col>
          )}
        </Row>
      </Card>
    );
  }

  // 历史模式：用 paramHistory
  if (paramHistory) {
    const epochs = paramHistory.epochs.map(e => e.epoch);
    const layerNames = paramHistory.epochs[0]?.layer_summary.map(l => l.name) ?? [];
    const activeLayerIdx = layerNames.indexOf(selectedLayer);

    const stdOption = {
      title: { text: 'Weight Std per Layer' },
      tooltip: { trigger: 'axis' },
      legend: { data: layerNames.slice(0, 5) },
      xAxis: { type: 'category', data: epochs },
      yAxis: { type: 'value' },
      series: paramHistory.epochs[0]?.layer_summary.slice(0, 5).map((l, i) => ({
        name: l.name,
        type: 'line',
        data: paramHistory.epochs.map(e => e.layer_summary[i]?.std ?? 0),
      })),
    };

    const normOption = {
      title: { text: 'Global Gradient Norm' },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: epochs },
      yAxis: { type: 'value' },
      series: [{ type: 'line', data: paramHistory.epochs.map(e => e.global_norm), 
        areaStyle: {}, itemStyle: { color: '#73d13d' } }],
    };

    return (
      <Card title="参数统计历史">
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Select
              style={{ width: 300, marginBottom: 16 }}
              placeholder="选择层"
              options={layerNames.map(n => ({ label: n, value: n }))}
              onChange={setSelectedLayer}
              showSearch
            />
          </Col>
          <Col span={12}><ReactECharts option={stdOption} style={{ height: 300 }} /></Col>
          <Col span={12}><ReactECharts option={normOption} style={{ height: 300 }} /></Col>
        </Row>
      </Card>
    );
  }

  return null;
}
```

- [ ] **Step 4: 提交**

```bash
git add src/pages/TrainingDashboard.tsx src/pages/components/TrainingCharts.tsx src/pages/components/ParamStatsPanel.tsx
git commit -m "feat: add TrainingDashboard page with charts and param stats"
```

---

## 阶段 5：端到端验证

### Task 10: 批量补录历史参数统计

**Files:**
- Create: `D:/ECG founder/ECGFounder/param_observer_backfill.py`

```python
"""
D:/ECG founder/ECGFounder/param_observer_backfill.py
对已有 round_1 ~ round_12 批量生成 param_history.json
一次性运行，不影响正在进行的训练
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "VS vibe coding files/ecg-annotation-platform/proxy-server"))

OUTPUTS = Path("D:/ECG founder/ECGFounder/outputs")


def compute_param_stats(checkpoint_path: Path) -> dict:
    import torch

    ckpt = torch.load(checkpoint_path, map_location="cpu")
    if "model_state_dict" in ckpt:
        state_dict = ckpt["model_state_dict"]
    elif "state_dict" in ckpt:
        state_dict = ckpt["state_dict"]
    else:
        state_dict = ckpt

    layers = []
    for name, param in state_dict.items():
        if not isinstance(param, torch.Tensor):
            continue
        data = param.detach().cpu().float()
        layers.append({
            "name": name,
            "shape": list(data.shape),
            "mean": float(data.mean().item()),
            "std": float(data.std().item()),
            "min": float(data.min().item()),
            "max": float(data.max().item()),
        })

    return {"layers": layers}


def backfill_round(round_name: str):
    ckpt_path = OUTPUTS / round_name / "best_macro_f1.pth"
    if not ckpt_path.exists():
        print(f"[SKIP] {round_name}: no checkpoint")
        return

    history_file = OUTPUTS / round_name / "param_history.json"
    if history_file.exists():
        print(f"[SKIP] {round_name}: param_history.json already exists")
        return

    print(f"[BACKFILL] {round_name}...")
    stats = compute_param_stats(ckpt_path)

    # 由于没有 epoch 信息，只存最终 checkpoint 的统计
    history = {
        "round": round_name,
        "epochs": [{
            "epoch": "final",
            "layer_summary": [{"name": l["name"], "mean": l["mean"], "std": l["std"]} for l in stats["layers"]],
        }]
    }

    history_file.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[DONE] {round_name}: {len(stats['layers'])} layers")


def main():
    for item in sorted(OUTPUTS.iterdir()):
        if item.is_dir() and item.name.startswith("round_"):
            backfill_round(item.name)


if __name__ == "__main__":
    main()
```

- [ ] **Step 1: 创建 backfill 脚本**

- [ ] **Step 2: 运行批量补录**

```bash
cd "D:/ECG founder/ECGFounder"
python param_observer_backfill.py
```

预期输出：round_1 ~ round_12 各生成 `param_history.json`

- [ ] **Step 3: 提交**

```bash
git add "D:/ECG founder/ECGFounder/param_observer_backfill.py"
git commit -m "feat(ecgfounder): add param_observer_backfill.py 批量补录历史参数统计"
```

---

### Task 11: 端到端集成验证

**Files:**
- Modify: `D:/VS vibe coding files/ecg-annotation-platform/docs/superpowers/plans/2026-04-28-ecgfounder-training-visualization-plan.md`

验收检查清单：

- [ ] **1. FastAPI Sidecar 启动正常**

```bash
cd "D:/VS vibe coding files/ecg-annotation-platform/proxy-server"
python -m uvicorn main:app --host 0.0.0.0 --port 6090
# curl http://localhost:6090/health → {"status": "ok"}
# curl http://localhost:6090/api/training/history | python -m json.tool | head -50
```

预期：返回 12 条历史 round 记录

- [ ] **2. finetune_runner 启动正常**

```bash
cd "D:/ECG founder/ECGFounder"
python finetune_runner.py
# 观察日志输出 "启动，等待训练任务..."
```

- [ ] **3. param_observer 启动正常**

```bash
cd "D:/ECG founder/ECGFounder"
python param_observer.py
# 观察日志输出 "启动，开始监控训练状态..."
```

- [ ] **4. run_platform.bat 一键启动**

```bash
# 双击或命令行运行
proxy-server/run_platform.bat
# 三个窗口应同时启动
```

- [ ] **5. 前端页面可访问**

```
浏览器打开 http://localhost:3000/training
```

预期：页面加载，显示"历史训练记录"和"实时训练"两个 Tab，历史表格应有 12 条数据

- [ ] **6. 历史曲线验证**

```
点击 round_1 的"查看详情"
→ 弹窗打开
→ Loss 曲线 Tab：应有 20 个数据点
→ 评估结果 Tab：Test Macro F1 ≈ 0.8778
```

- [ ] **7. 参数统计验证（历史）**

```
round_1 详情 → 参数统计 Tab
→ 应显示 param_history.json 中的层统计
```

- [ ] **8. Checkpoint 下载验证**

```
Checkpoint 管理 Tab
→ 点击 round_1 的"下载"
→ 浏览器下载 best_macro_f1.pth，大小 ≈ 123 MB
```

- [ ] **9. 发起训练验证**

```
实时训练 Tab
→ 修改 Epochs = 5（快速验证）
→ 点击"开始训练"
→ 进度条实时更新
→ 每 epoch 末 param_observer 更新 param_stats.json
→ 前端热力图刷新
→ 训练完成，新 round 出现在历史列表顶部
```

- [ ] **10. 错误处理验证**

```
训练中途手动终止 finetune_runner 进程
→ 前端应显示错误状态（而非卡在进度条）
```

- [ ] **11. 提交文档更新**

```bash
git add docs/superpowers/plans/2026-04-28-ecgfounder-training-visualization-plan.md
git commit -m "docs: add ECGFounder training visualization implementation plan"
```

---

## 文件清单汇总

| 文件 | 操作 | 描述 |
|------|------|------|
| `proxy-server/state.py` | 新建 | shared_state.json 读写工具 |
| `proxy-server/parsers.py` | 新建 | 日志/评估 JSON 解析器 |
| `proxy-server/main.py` | 新建 | FastAPI Sidecar |
| `proxy-server/run_platform.bat` | 新建 | 一键启动脚本 |
| `D:/ECG founder/ECGFounder/finetune_runner.py` | 新建 | 受控训练脚本 |
| `D:/ECG founder/ECGFounder/param_observer.py` | 新建 | 独立参数统计进程 |
| `D:/ECG founder/ECGFounder/param_observer_backfill.py` | 新建 | 批量补录脚本 |
| `src/services/trainingApi.ts` | 新建 | 前端 API 调用 |
| `src/pages/TrainingDashboard.tsx` | 新建 | 训练看板主页面 |
| `src/pages/components/TrainingCharts.tsx` | 新建 | 训练曲线图表 |
| `src/pages/components/ParamStatsPanel.tsx` | 新建 | 参数统计面板 |
| `src/App.tsx` | 修改 | 添加 /training 路由 |

**不修改的原文件**（MD5 验证）：
- `finetune_mitbih_ecgfounder_gpu_amp.py`
- `net1d.py`
- `dataset.py`

---

## 依赖安装清单

**Python 端（conda 环境）**：
```bash
pip install filelock fastapi uvicorn sse-starlette
# （torch 已安装在 ECGFounder conda 环境中）
```

**Node.js 端**：
```bash
# 无新增 npm 依赖（使用已有的 echarts-for-react）
# 如需安装：npm install echarts-for-react
```

---

*计划版本: 1.0*
*日期: 2026-04-28*
