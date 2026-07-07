"""
proxy-server/main.py
FastAPI Sidecar — 暴露训练状态 API 和 SSE 实时流
端口: 6090
"""
import asyncio
import hmac
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Annotated, Any, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

log = logging.getLogger("sidecar")

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


# ── 路径安全 helper ────────────────────────────────────────────────────────

# Checkpoint filenames are restricted to a single relative segment whose
# basename matches [A-Za-z0-9_.-]+\.pth. This blocks path-traversal
# payloads (e.g. `..%2F..%2Ffoo.pth`, `foo.pth/best_macro_f1.pth`,
# null-byte injection) at the boundary without needing to call into the
# filesystem.
_CHECKPOINT_FILENAME_PATTERN = re.compile(r"^[A-Za-z0-9_.\-]+\.pth$")

# Minimax default chat model. Override via `MINIMAX_MODEL` env var.
DEFAULT_MINIMAX_MODEL = os.environ.get("MINIMAX_MODEL", "abab6.5s-chat")
MINIMAX_UPSTREAM_URL = os.environ.get(
    "MINIMAX_UPSTREAM_URL",
    "https://api.minimax.chat/v1/text/chatcompletion_v2",
)
MINIMAX_PROXY_TIMEOUT_SECONDS = float(os.environ.get("MINIMAX_PROXY_TIMEOUT_SECONDS", "30"))


def _safe_round_name(name: str) -> str:
    """Validate a `round_name` path segment.

    Rejects empty values, parent-directory escapes, and any leading
    separator (forward or backward slash). The empty check guards against
    FastAPI passing the empty string for unmatched path params.
    """
    if not name or ".." in name or name.startswith("/") or name.startswith("\\"):
        raise HTTPException(status_code=400, detail="Invalid round name")
    return name


def _safe_checkpoint_filename(filename: str) -> str:
    """Validate a checkpoint filename matches the strict safe pattern."""
    if not _CHECKPOINT_FILENAME_PATTERN.match(filename):
        raise HTTPException(status_code=400, detail="Invalid checkpoint filename")
    return filename


def _safe_outputs_child(round_name: str) -> Path:
    """Resolve `ECGFOUNDER_OUTPUTS / round_name` and verify containment.

    Returns the resolved path when it stays inside `ECGFOUNDER_OUTPUTS/`
    (defence-in-depth even after the lexical check, because `Path.resolve`
    canonicalises any remaining `..` segments on the host filesystem).
    """
    safe_name = _safe_round_name(round_name)
    outputs_resolved = ECGFOUNDER_OUTPUTS.resolve()
    candidate = (outputs_resolved / safe_name).resolve()
    try:
        candidate.relative_to(outputs_resolved)
    except ValueError as exc:  # pragma: no cover - path.resolve catches
        raise HTTPException(status_code=400, detail="Invalid round name") from exc
    return candidate


def verify_admin_token(
    authorization: Annotated[Optional[str], Header()] = None,
) -> None:
    """FastAPI dependency that requires a Bearer admin token.

    Destructive routes (`POST /api/training/task`, `POST /api/training/stop`,
    `DELETE /api/training/history/{round}`) depend on this. The expected
    token is read from `SIDECAR_ADMIN_TOKEN`.

    Behaviour:
    * Env var unset → 503 (fail-closed; the operator must opt in).
    * Header missing/malformed → 401.
    * Header present but token mismatch → 401.

    Constant-time comparison avoids leaking the token through timing.
    """
    expected = os.environ.get("SIDECAR_ADMIN_TOKEN", "").strip()
    if not expected:
        log.warning(
            "SIDECAR_ADMIN_TOKEN is unset; destructive endpoints are locked. "
            "Set SIDECAR_ADMIN_TOKEN in the sidecar environment to enable them."
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "Admin token not configured on sidecar; destructive endpoints "
                "are disabled. Set SIDECAR_ADMIN_TOKEN and restart."
            ),
        )
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or malformed Authorization header (expected 'Bearer <token>')",
        )
    supplied = authorization[len("Bearer "):].strip()
    if not supplied:
        raise HTTPException(status_code=401, detail="Empty bearer token")
    # Use hmac.compare_digest for constant-time comparison.
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid admin token")


app = FastAPI(title="ECGFounder Sidecar", version="1.0.0")

# CORS allow-list. The default permits the local dev servers; deployments
# that expose the sidecar beyond localhost must set
# `SIDECAR_ALLOW_ORIGINS` to a comma-separated list of trusted origins
# (e.g. `https://ecg.example.com,https://staging.example.com`).
# Leaving the default `*` would let any site read training state and
# trigger destructive endpoints, so we restrict it explicitly here.
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
async def submit_training_task(
    body: dict,
    _admin: Annotated[None, Depends(verify_admin_token)] = None,
):
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
def stop_training(
    _admin: Annotated[None, Depends(verify_admin_token)] = None,
):
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
async def delete_training_round(
    round_name: str,
    confirm: str = Query(default=""),
    _admin: Annotated[None, Depends(verify_admin_token)] = None,
):
    """Delete a training round (directory and all its files).

    The `confirm` query parameter must equal the round name itself. This
    mirrors the typical browser confirm dialog so that a stray DELETE
    request (e.g. from a link prefetcher) cannot wipe a training round.
    """
    # Validate round_name to prevent path traversal (D-1: helper unifies
    # the lexical check across all round_name-handling endpoints).
    _safe_round_name(round_name)
    if confirm != round_name:
        raise HTTPException(
            status_code=400,
            detail="Pass ?confirm=<round_name> to acknowledge deletion",
        )
    import shutil

    round_dir = _safe_outputs_child(round_name)
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
    # D-1: reject traversal attempts before reaching the filesystem
    _safe_round_name(round_name)
    # 先尝试 MIT-BIH 风格的 train_*.log
    epochs = parse_train_log(round_name)
    if epochs:
        return {"round": round_name, "epochs": epochs}
    # 回退到 CPSC2018 风格的 history_*.csv
    round_dir = _safe_outputs_child(round_name)
    csv_epochs = parse_history_csv_epochs(round_dir)
    if csv_epochs:
        return {"round": round_name, "epochs": csv_epochs}
    raise HTTPException(status_code=404, detail=f"Log for {round_name} not found")


@app.get("/api/training/history/{round_name}/eval")
async def get_round_eval(round_name: str):
    # D-1: reject traversal attempts before reaching the filesystem
    _safe_round_name(round_name)
    eval_data = parse_evaluation(round_name)
    if eval_data is None:
        raise HTTPException(status_code=404, detail=f"Evaluation for {round_name} not found")
    return eval_data


@app.get("/api/training/history/{round_name}/param-stats")
async def get_round_param_stats(round_name: str):
    # D-1: helper unifies the lexical check.
    _safe_round_name(round_name)
    round_dir = _safe_outputs_child(round_name)
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
    outputs_resolved = ECGFOUNDER_OUTPUTS.resolve()
    for round_item in ECGFOUNDER_OUTPUTS.iterdir():
        if not round_item.is_dir():
            continue
        # D-1: defence-in-depth — even though the listing iterates an
        # already-resolved outputs directory, skip any entry whose
        # resolved path escapes ECGFOUNDER_OUTPUTS (e.g. a stray
        # symlink dropped into the directory).
        try:
            round_resolved = round_item.resolve()
            round_resolved.relative_to(outputs_resolved)
        except ValueError:
            log.warning("Skipping checkpoint dir outside outputs root: %s", round_item)
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
    # D-1: lexical round-name check + strict filename regex (blocks
    # `..%2F..%2Fshared_state.json`, `foo.pth/best.pth`, null-byte
    # injection, and any non-`.pth` suffix). `_safe_outputs_child` is a
    # second-line defence that re-checks the resolved path stays inside
    # `ECGFOUNDER_OUTPUTS/`.
    _safe_round_name(round_name)
    _safe_checkpoint_filename(filename)
    round_dir = _safe_outputs_child(round_name)
    file_path = round_dir / filename
    # Final containment check: even after lexical validation, refuse
    # paths whose `..` resolved somewhere unexpected.
    try:
        file_path.resolve().relative_to(ECGFOUNDER_OUTPUTS.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid checkpoint path")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Checkpoint file not found")
    return FileResponse(file_path, filename=filename)


# ── MiniMax proxy (C-12) ──────────────────────────────────────────────────
#
# The frontend `minimaxService.analyzeViaProxy()` POSTs to `/api/ecg/analyze`
# with a JSON body that contains the model name and the per-lead signal
# data. The sidecar forwards the request to Minimax's chat-completion
# endpoint, with the API key injected from the `MINIMAX_API_KEY` env var.
# This is the same-process replacement for the legacy
# `proxy-server/minimax-proxy.js` Node service so callers do not have to
# manage a second port or rely on a webpack devServer proxy.

def _build_minimax_payload(body: dict) -> Optional[dict]:
    """Translate the frontend `analyzeECG` payload into Minimax chat format.

    Returns the request body, or `None` when the input is malformed.
    """
    signal_data = body.get("signalData")
    if not isinstance(signal_data, list) or not signal_data:
        return None
    # The frontend sends a 2-D array (one entry per lead). We pass it
    # through as a JSON string in the user message so the upstream chat
    # model can reason about the signal structure directly.
    model = str(body.get("model") or DEFAULT_MINIMAX_MODEL)
    classes = body.get("classes") or [
        "正常",
        "房颤",
        "室上性心动过速",
        "室性心动过速",
        "停搏",
    ]
    return {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是ECG分类助手。请返回JSON对象，字段为predictions，"
                    "数组元素为{className, probability}，概率总和约为1。"
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": "classify_ecg",
                        "classes": classes,
                        "signal": signal_data,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0.1,
    }


def _extract_minimax_predictions(raw: Any) -> list[dict]:
    """Return a list of {className, probability} dicts from an upstream reply.

    Minimax sometimes wraps the structured answer in `output_text` or
    `choices[0].message.content`; we tolerate both shapes. The result is
    always a list (possibly empty) — never raises.
    """
    if not isinstance(raw, dict):
        return []
    direct = raw.get("predictions")
    if isinstance(direct, list):
        return [
            {"className": str(item.get("className") or item.get("label") or "未知"),
             "probability": float(item.get("probability") or item.get("score") or 0)}
            for item in direct
            if isinstance(item, dict)
        ]
    text = raw.get("output_text")
    if not text:
        choices = raw.get("choices")
        if isinstance(choices, list) and choices:
            text = choices[0].get("message", {}).get("content") if isinstance(choices[0], dict) else None
    if not isinstance(text, str):
        return []
    # Try strict JSON, then a relaxed "first JSON object" fallback.
    for candidate in (text, _first_json_object(text)):
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(parsed, dict) and isinstance(parsed.get("predictions"), list):
            return _extract_minimax_predictions(parsed)
    return []


def _first_json_object(text: str) -> Optional[str]:
    """Return the first balanced `{...}` substring, or None."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if escape:
            escape = False
            continue
        if char == "\\":
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start:index + 1]
    return None


@app.post("/api/ecg/analyze")
async def analyze_via_minimax_proxy(body: dict):
    """Forward the frontend ECG analysis request to Minimax.

    C-12 closes the default-deployment 404 by adding this route to the
    FastAPI sidecar. The Minimax API key is loaded from the
    `MINIMAX_API_KEY` env var; when it is missing the endpoint returns
    503 with a clear error so the frontend can show a configuration
    hint instead of hanging on a generic 5xx.

    The route does not require the admin token: ECG analysis is a
    user-facing AI feature, not a destructive operation, and the
    frontend talks to the sidecar from the local dev server. The
    upstream API key never reaches the browser.
    """
    api_key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "MINIMAX_API_KEY is not configured on the sidecar. "
                "Set MINIMAX_API_KEY in the sidecar environment and restart."
            ),
        )

    payload = _build_minimax_payload(body)
    if payload is None:
        raise HTTPException(
            status_code=400,
            detail="Request body must include a non-empty 'signalData' array",
        )

    try:
        async with httpx.AsyncClient(timeout=MINIMAX_PROXY_TIMEOUT_SECONDS) as client:
            upstream = await client.post(
                MINIMAX_UPSTREAM_URL,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
    except httpx.HTTPError as exc:
        log.warning("Minimax upstream transport error: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Upstream Minimax request failed: {exc}",
        )

    if upstream.status_code >= 400:
        # Bubble up a sanitized hint; the upstream body is not echoed
        # back to keep the contract small.
        raise HTTPException(
            status_code=502,
            detail=f"Upstream Minimax returned HTTP {upstream.status_code}",
        )

    try:
        raw = upstream.json()
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="Upstream Minimax response was not valid JSON",
        ) from exc

    predictions = _extract_minimax_predictions(raw)
    if not predictions:
        raise HTTPException(
            status_code=502,
            detail="Upstream Minimax response did not contain parseable predictions",
        )
    return {"predictions": predictions, "model": payload["model"]}
