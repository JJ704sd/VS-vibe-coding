import json

import filelock
from fastapi.testclient import TestClient

import main
import state


def configure_state_files(monkeypatch, tmp_path):
    base = tmp_path / "ecgfounder"
    base.mkdir(parents=True)
    monkeypatch.setattr(state, "ECGFOUNDER_BASE", base)
    monkeypatch.setattr(state, "SHARED_STATE_FILE", base / "shared_state.json")
    monkeypatch.setattr(state, "PARAM_STATS_FILE", base / "param_stats.json")
    monkeypatch.setattr(state, "TRAIN_TASK_FILE", base / "train_task.json")
    monkeypatch.setattr(state, "LOCK_FILE", base / ".state.lock")
    monkeypatch.setattr(main, "ECGFOUNDER_BASE", base)
    return base


def test_training_state_endpoint_falls_back_when_state_lock_times_out(monkeypatch, tmp_path):
    base = configure_state_files(monkeypatch, tmp_path)
    (base / "shared_state.json").write_text(
        json.dumps({"status": "training", "round": "round_3", "current_epoch": 4}),
        encoding="utf-8",
    )

    class LockedState:
        def __enter__(self):
            raise filelock.Timeout(str(base / ".state.lock"))

        def __exit__(self, *args):
            return None

    monkeypatch.setattr(state, "StateLock", LockedState)

    response = TestClient(main.app).get("/api/training/state")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "training"
    assert body["current_epoch"] == 4
    assert body["lock_warning"] == "state lock timeout; read without lock"
