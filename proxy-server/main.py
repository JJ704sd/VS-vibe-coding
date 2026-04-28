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
    read_shared_state,
    write_shared_state,
    read_param_stats,
    read_train_task,
    write_train_task,
    delete_train_task,
)
from parsers import parse_train_log, parse_evaluation, list_history_rounds

ECGFOUNDER_OUTPUTS = Path("D:/ECG founder/ECGFounder/outputs")

app = FastAPI(title="ECGFounder Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 健康检查 ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "ecgfounder-sidecar", "port": 6090}


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
        "status": "pending",
        "submitted_at": time.time(),
    }
    write_train_task(task)
    return {"ok": True, "task_id": task_id}


@app.get("/api/training/task/status")
async def get_task_status():
    task = read_train_task()
    return {"has_task": task is not None, "task": task}


# ── 历史记录 ────────────────────────────────────────────────────────────────

@app.get("/api/training/history")
async def get_training_history():
    rounds = list_history_rounds()
    result = []
    for r in rounds:
        round_name = r["name"]
        eval_data = parse_evaluation(round_name)
        best_f1 = eval_data.get("best_macro_f1", 0) if eval_data else 0
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

@app.get("/api/checkpoints")
async def list_checkpoints():
    checkpoints = []
    for round_item in ECGFOUNDER_OUTPUTS.iterdir():
        if not (round_item.is_dir() and round_item.name.startswith("round_")):
            continue
        round_name = round_item.name
        eval_data = parse_evaluation(round_name)
        best_f1 = eval_data.get("best_macro_f1", 0) if eval_data else 0
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


@app.get("/api/checkpoints/{round_name}/{filename}")
async def download_checkpoint(round_name: str, filename: str):
    file_path = ECGFOUNDER_OUTPUTS / round_name / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Checkpoint file not found")
    return FileResponse(file_path, filename=filename)
