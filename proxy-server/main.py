"""
proxy-server/main.py
FastAPI Sidecar — 暴露训练状态 API 和 SSE 实时流
端口: 6090
"""
import asyncio
import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

# 本地模块
from state import (
    ECGFOUNDER_BASE,
    read_shared_state,
    write_shared_state,
    read_param_stats,
    read_train_task,
    write_train_task,
    delete_train_task,
)
from parsers import (
    parse_train_log,
    parse_evaluation,
    list_history_rounds,
    list_all_history_with_dataset,
    parse_history_csv_epochs,
)

from assistant.memory_store import MemoryStore
from assistant.rag_store import RAGStore
from assistant.case_analysis import analyze_case_snapshot
from assistant.service import AssistantService
from assistant.training_diagnostics import diagnose_training, diagnose_training_history

ECGFOUNDER_OUTPUTS = ECGFOUNDER_BASE / "outputs"

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ASSISTANT_MEMORY_FILE = Path(__file__).resolve().parent / ".data" / "assistant_memory.json"
_assistant_service: AssistantService | None = None
RUNNER_CONFIG_KEYS = (
    "epochs",
    "batch_size",
    "lr_backbone",
    "balance_before_split",
    "unfreeze_mode",
)


def get_assistant_service() -> AssistantService:
    global _assistant_service
    if _assistant_service is None:
        memory_file = Path(os.environ.get("ASSISTANT_MEMORY_FILE", str(DEFAULT_ASSISTANT_MEMORY_FILE)))
        _assistant_service = AssistantService(
            MemoryStore(memory_file),
            RAGStore(REPO_ROOT),
        )
    return _assistant_service


def _normalize_live_param_stats(stats: dict) -> dict:
    normalized = dict(stats)
    if all(key in normalized for key in ("round", "epoch", "timestamp")):
        return normalized

    training_state = read_shared_state()
    epoch = training_state.get("current_epoch", training_state.get("epoch", 0))
    normalized.setdefault("round", training_state.get("round") or "")
    normalized.setdefault("epoch", epoch if epoch is not None else 0)
    normalized.setdefault("timestamp", training_state.get("updated_at") or time.strftime("%Y-%m-%dT%H:%M:%S"))
    return normalized


def _runner_config_fields(config: dict) -> dict:
    if not isinstance(config, dict):
        return {}
    return {key: config[key] for key in RUNNER_CONFIG_KEYS if key in config}

app = FastAPI(title="ECGFounder Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 健康检查 ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ecgfounder-sidecar", "port": 6090}


# ── Assistant Routes ──────────────────────────────────────────────────────────

@app.post("/api/assistant/knowledge/rebuild")
async def rebuild_assistant_knowledge():
    return get_assistant_service().rebuild_knowledge()


@app.post("/api/assistant/memory/case")
async def record_assistant_case_snapshot(body: dict):
    if not body.get("recordId"):
        raise HTTPException(status_code=400, detail="recordId is required")
    return get_assistant_service().record_case_snapshot(body)


@app.post("/api/assistant/ask")
async def ask_assistant(body: dict):
    question = str(body.get("question", "")).strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    context = body.get("context") or {}
    return get_assistant_service().ask(question, context)


@app.post("/api/assistant/case/analyze")
async def analyze_assistant_case(body: dict):
    context = body.get("context") or {}
    if not isinstance(context, dict):
        raise HTTPException(status_code=400, detail="context must be an object")
    return analyze_case_snapshot(context)


@app.get("/api/assistant/training/diagnose")
async def diagnose_training_assistant():
    return diagnose_training(
        read_shared_state(),
        read_param_stats(),
        list_all_history_with_dataset(),
    )


@app.get("/api/assistant/training/history/diagnose")
async def diagnose_training_history_assistant():
    return diagnose_training_history(list_all_history_with_dataset())


# ── 训练状态 ────────────────────────────────────────────────────────────────

@app.get("/api/training/state")
async def get_training_state():
    return read_shared_state()


@app.get("/api/training/state/stream")
async def training_state_stream():
    async def event_generator():
        last_mtime = ""
        idle_count = 0
        while True:
            state = read_shared_state()
            current_mtime = state.get("updated_at", "")
            status = state.get("status", "idle")

            if current_mtime != last_mtime:
                last_mtime = current_mtime
                idle_count = 0
                yield {"event": "state_update", "data": json.dumps(state, default=str)}
            else:
                idle_count += 1

            # Training: 2s poll; idle/done: 30s poll (reduce CPU)
            sleep_interval = 2 if status in ("training", "running") else 30
            await asyncio.sleep(sleep_interval)

    return EventSourceResponse(event_generator())


# ── 参数统计 ────────────────────────────────────────────────────────────────

@app.get("/api/training/param-stats")
async def get_param_stats():
    stats = read_param_stats()
    if stats is None:
        raise HTTPException(status_code=404, detail="param_stats.json not found")
    return _normalize_live_param_stats(stats)


@app.get("/api/training/param-stats/stream")
async def param_stats_stream():
    async def event_generator():
        last_data = None
        idle_count = 0
        while True:
            stats = read_param_stats()
            current_data = json.dumps(stats, default=str) if stats else None
            if current_data != last_data:
                last_data = current_data
                idle_count = 0
                if current_data:
                    yield {"event": "param_update", "data": current_data}
            else:
                idle_count += 1

            # Training: 5s poll; idle/done: 30s poll
            sleep_interval = 5 if idle_count < 6 else 30
            await asyncio.sleep(sleep_interval)

    return EventSourceResponse(event_generator())


# ── 训练任务 ────────────────────────────────────────────────────────────────

@app.post("/api/training/task")
async def submit_training_task(body: dict):
    current_task = read_train_task()
    if current_task and current_task.get("status") == "training":
        raise HTTPException(status_code=409, detail="Training already in progress")

    config = body.get("config", {})
    task_id = f"task_{int(time.time() * 1000)}"
    task = {
        "id": task_id,
        "dataset": body.get("dataset"),
        "config": config,
        **_runner_config_fields(config),
        "status": "queued",
        "submitted_at": time.time(),
    }
    write_train_task(task)
    return {"ok": True, "task_id": task_id}


@app.post("/api/training/stop")
def stop_training():
    """Send stop signal to finetune_runner and cancel training subprocess."""
    import shutil

    STOP_FILE = ECGFOUNDER_BASE / "stop_signal.txt"
    TRAIN_TASK = ECGFOUNDER_BASE / "train_task.json"

    STOP_FILE.write_text("stop", encoding="utf-8")
    write_shared_state({
        "status": "idle",
        "error": "Stopped by user",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    try:
        TRAIN_TASK.unlink(missing_ok=True)
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/training/task/status")
async def get_task_status():
    task = read_train_task()
    return {"has_task": task is not None, "task": task}


# ── 历史记录 ────────────────────────────────────────────────────────────────

@app.delete("/api/training/history/{round_name}")
async def delete_training_round(round_name: str):
    """Delete a training round (directory and all its files)"""
    # Validate round_name to prevent path traversal
    if ".." in round_name or round_name.startswith("/") or round_name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid round name")
    import shutil

    round_dir = ECGFOUNDER_OUTPUTS / round_name
    if not round_dir.exists():
        raise HTTPException(status_code=404, detail=f"Round {round_name} not found")

    try:
        shutil.rmtree(round_dir)
        return {"ok": True, "deleted": round_name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {str(e)}")


@app.get("/api/training/history")
async def get_training_history():
    """返回所有历史训练记录，按数据集分组"""
    all_history = list_all_history_with_dataset()
    return all_history


@app.get("/api/training/history/{round_name}/log")
async def get_round_log(round_name: str):
    # 先尝试 MIT-BIH 风格的 train_*.log
    epochs = parse_train_log(round_name)
    if epochs:
        return {"round": round_name, "epochs": epochs}
    # 回退到 CPSC2018 风格的 history_*.csv
    round_dir = ECGFOUNDER_OUTPUTS / round_name
    csv_epochs = parse_history_csv_epochs(round_dir)
    if csv_epochs:
        return {"round": round_name, "epochs": csv_epochs}
    raise HTTPException(status_code=404, detail=f"Log for {round_name} not found")


@app.get("/api/training/history/{round_name}/eval")
async def get_round_eval(round_name: str):
    eval_data = parse_evaluation(round_name)
    if eval_data is None:
        raise HTTPException(status_code=404, detail=f"Evaluation for {round_name} not found")
    return eval_data


@app.get("/api/training/history/{round_name}/param-stats")
async def get_round_param_stats(round_name: str):
    # Validate round_name to prevent path traversal
    if ".." in round_name or round_name.startswith("/") or round_name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid round name")
    round_dir = ECGFOUNDER_OUTPUTS / round_name
    param_file = round_dir / "param_history.json"
    if not param_file.exists():
        raise HTTPException(status_code=404, detail=f"param_history.json for {round_name} not found")
    try:
        return json.loads(param_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        raise HTTPException(status_code=500, detail=f"Failed to read param_stats: {e}")


# ── Checkpoints ─────────────────────────────────────────────────────────────

@app.get("/api/training/checkpoints")
@app.get("/api/checkpoints")
async def list_checkpoints():
    checkpoints = []
    for round_item in ECGFOUNDER_OUTPUTS.iterdir():
        if not round_item.is_dir():
            continue
        round_name = round_item.name

        # Determine dataset name from directory
        if round_name.startswith("round_"):
            dataset = "MIT-BIH"
            try:
                round_num = int(round_name.split("_")[1])
            except ValueError:
                round_num = 0
        else:
            # 非 round_ 目录 -> 数据集名为目录名（如 cpsc2018_binary_v2_focal_mixup_tta）
            dataset = round_name
            round_num = 0

        eval_data = parse_evaluation(round_name)
        best_f1 = eval_data.get("test_macro_f1", 0) if eval_data else 0

        for ckpt_file in round_item.glob("*.pth"):
            checkpoints.append({
                "round": round_name,
                "number": round_num,
                "dataset": dataset,
                "filename": ckpt_file.name,
                "size_bytes": ckpt_file.stat().st_size,
                "best_f1": best_f1,
            })
    checkpoints.sort(key=lambda x: (x["dataset"], x["number"]))
    return checkpoints


@app.get("/api/training/checkpoints/{round_name}/{filename}")
@app.get("/api/checkpoints/{round_name}/{filename}")
async def download_checkpoint(round_name: str, filename: str):
    # round_name may be a dataset dir (e.g. cpsc2018_binary_v2_focal_mixup_tta)
    file_path = ECGFOUNDER_OUTPUTS / round_name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Checkpoint file not found")
    return FileResponse(file_path, filename=filename)
