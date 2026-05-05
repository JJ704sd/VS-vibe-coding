"""
proxy-server/main.py
FastAPI Sidecar — 暴露训练状态 API 和 SSE 实时流
端口: 6090
"""
import asyncio
import json
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
from parsers import parse_train_log, parse_evaluation, list_history_rounds

from assistant.memory_store import MemoryStore
from assistant.rag_store import RAGStore
from assistant.service import AssistantService

ECGFOUNDER_OUTPUTS = ECGFOUNDER_BASE / "outputs"

REPO_ROOT = Path(__file__).resolve().parents[1]
ASSISTANT_MEMORY_FILE = Path(__file__).resolve().parent / "assistant_memory.json"
assistant_service = AssistantService(
    MemoryStore(ASSISTANT_MEMORY_FILE),
    RAGStore(REPO_ROOT),
)

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
    return assistant_service.rebuild_knowledge()


@app.post("/api/assistant/memory/case")
async def record_assistant_case_snapshot(body: dict):
    if not body.get("recordId"):
        raise HTTPException(status_code=400, detail="recordId is required")
    return assistant_service.record_case_snapshot(body)


@app.post("/api/assistant/ask")
async def ask_assistant(body: dict):
    question = str(body.get("question", "")).strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")
    context = body.get("context") or {}
    return assistant_service.ask(question, context)


# ── 训练状态 ────────────────────────────────────────────────────────────────

@app.get("/api/training/state")
async def get_training_state():
    return read_shared_state()


@app.get("/api/training/state/stream")
async def training_state_stream():
    async def event_generator():
        last_mtime = ""
        while True:
            state = read_shared_state()
            current_mtime = state.get("updated_at", "")
            if current_mtime != last_mtime:
                last_mtime = current_mtime
                yield {"event": "state_update", "data": json.dumps(state, default=str)}
            await asyncio.sleep(2)

    return EventSourceResponse(event_generator())


# ── 参数统计 ────────────────────────────────────────────────────────────────

@app.get("/api/training/param-stats")
async def get_param_stats():
    stats = read_param_stats()
    if stats is None:
        raise HTTPException(status_code=404, detail="param_stats.json not found")
    return stats


@app.get("/api/training/param-stats/stream")
async def param_stats_stream():
    async def event_generator():
        last_data = None
        while True:
            stats = read_param_stats()
            current_data = json.dumps(stats, default=str) if stats else None
            if current_data != last_data:
                last_data = current_data
                yield {"event": "param_update", "data": current_data}
            await asyncio.sleep(5)

    return EventSourceResponse(event_generator())


# ── 训练任务 ────────────────────────────────────────────────────────────────

@app.post("/api/training/task")
async def submit_training_task(body: dict):
    current_task = read_train_task()
    if current_task and current_task.get("status") == "training":
        raise HTTPException(status_code=409, detail="Training already in progress")

    task_id = f"task_{int(time.time() * 1000)}"
    task = {
        "id": task_id,
        "dataset": body.get("dataset"),
        "config": body.get("config", {}),
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
    rounds = list_history_rounds()
    result = []
    for r in rounds:
        round_name = r["name"]
        eval_data = parse_evaluation(round_name)
        best_f1 = eval_data.get("test_macro_f1", 0) if eval_data else 0
        test_acc = eval_data.get("test_accuracy", 0) if eval_data else 0
        result.append({
            "round": round_name,
            "number": r["number"],
            "best_f1": best_f1,
            "test_accuracy": test_acc,
            "path": r["path"],
        })
    return result


@app.get("/api/training/history/{round_name}/log")
async def get_round_log(round_name: str):
    epochs = parse_train_log(round_name)
    if not epochs:
        raise HTTPException(status_code=404, detail=f"Log for {round_name} not found")
    return {"round": round_name, "epochs": epochs}


@app.get("/api/training/history/{round_name}/eval")
async def get_round_eval(round_name: str):
    eval_data = parse_evaluation(round_name)
    if eval_data is None:
        raise HTTPException(status_code=404, detail=f"Evaluation for {round_name} not found")
    return eval_data


@app.get("/api/training/history/{round_name}/param-stats")
async def get_round_param_stats(round_name: str):
    round_dir = ECGFOUNDER_OUTPUTS / round_name
    param_file = round_dir / "param_history.json"
    if not param_file.exists():
        raise HTTPException(status_code=404, detail=f"param_history.json for {round_name} not found")
    return json.loads(param_file.read_text(encoding="utf-8"))


# ── Checkpoints ─────────────────────────────────────────────────────────────

@app.get("/api/training/checkpoints")
@app.get("/api/checkpoints")
async def list_checkpoints():
    checkpoints = []
    for round_item in ECGFOUNDER_OUTPUTS.iterdir():
        if not (round_item.is_dir() and round_item.name.startswith("round_")):
            continue
        round_name = round_item.name
        eval_data = parse_evaluation(round_name)
        best_f1 = eval_data.get("test_macro_f1", 0) if eval_data else 0
        try:
            round_num = int(round_name.split("_")[1])
        except ValueError:
            round_num = 0
        for ckpt_file in round_item.glob("*.pth"):
            checkpoints.append({
                "round": round_name,
                "number": round_num,
                "filename": ckpt_file.name,
                "size_bytes": ckpt_file.stat().st_size,
                "best_f1": best_f1,
            })
    checkpoints.sort(key=lambda x: x["number"])
    return checkpoints


@app.get("/api/training/checkpoints/{round_name}/{filename}")
@app.get("/api/checkpoints/{round_name}/{filename}")
async def download_checkpoint(round_name: str, filename: str):
    file_path = ECGFOUNDER_OUTPUTS / round_name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Checkpoint file not found")
    return FileResponse(file_path, filename=filename)
