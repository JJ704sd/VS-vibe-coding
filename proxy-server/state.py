"""
proxy-server/state.py
shared_state.json 和 param_stats.json 的读写工具，使用 filelock 防止多进程冲突。
"""
import json
import filelock
from pathlib import Path
from typing import Optional

import os

# 路径常量 — 支持环境变量配置
# 默认值适配 Windows 用户，可通过 ECGFOUNDER_BASE 环境变量覆盖
ECGFOUNDER_BASE = Path(os.environ.get("ECGFOUNDER_BASE", "D:/ECG founder/ECGFounder"))
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


def _read_json_unlocked(path: Path) -> Optional[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, OSError):
        return None


def _with_lock_warning(data: Optional[dict]) -> Optional[dict]:
    if data is None:
        return None
    result = dict(data)
    result.setdefault("lock_warning", "state lock timeout; read without lock")
    return result


def _read_json_with_lock(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    try:
        with StateLock():
            return json.loads(path.read_text(encoding="utf-8"))
    except filelock.Timeout:
        return _with_lock_warning(_read_json_unlocked(path))


def read_shared_state() -> dict:
    if not SHARED_STATE_FILE.exists():
        return {"status": "idle", "error": None}
    data = _read_json_with_lock(SHARED_STATE_FILE)
    if data is None:
        return {"status": "idle", "error": "Failed to read shared_state.json"}
    return data


def write_shared_state(data: dict) -> None:
    ECGFOUNDER_BASE.mkdir(parents=True, exist_ok=True)
    with StateLock():
        SHARED_STATE_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def read_param_stats() -> Optional[dict]:
    if not PARAM_STATS_FILE.exists():
        return None
    return _read_json_with_lock(PARAM_STATS_FILE)


def write_param_stats(data: dict) -> None:
    ECGFOUNDER_BASE.mkdir(parents=True, exist_ok=True)
    with StateLock():
        PARAM_STATS_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def read_train_task() -> Optional[dict]:
    if not TRAIN_TASK_FILE.exists():
        return None
    return _read_json_with_lock(TRAIN_TASK_FILE)


def write_train_task(data: dict) -> None:
    ECGFOUNDER_BASE.mkdir(parents=True, exist_ok=True)
    with StateLock():
        TRAIN_TASK_FILE.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )


def delete_train_task() -> None:
    with StateLock():
        if TRAIN_TASK_FILE.exists():
            TRAIN_TASK_FILE.unlink()
