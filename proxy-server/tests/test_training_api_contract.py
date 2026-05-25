import json
from pathlib import Path

from fastapi.testclient import TestClient

import main
import parsers
import state


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, data: dict) -> None:
    write_text(path, json.dumps(data))


def configure_runtime(monkeypatch, tmp_path):
    base = tmp_path / "ecgfounder"
    outputs = base / "outputs"
    outputs.mkdir(parents=True)

    monkeypatch.setattr(state, "ECGFOUNDER_BASE", base)
    monkeypatch.setattr(state, "SHARED_STATE_FILE", base / "shared_state.json")
    monkeypatch.setattr(state, "PARAM_STATS_FILE", base / "param_stats.json")
    monkeypatch.setattr(state, "TRAIN_TASK_FILE", base / "train_task.json")
    monkeypatch.setattr(state, "LOCK_FILE", base / ".state.lock")
    monkeypatch.setattr(parsers, "ECGFOUNDER_OUTPUTS", outputs)
    monkeypatch.setattr(main, "ECGFOUNDER_BASE", base)
    monkeypatch.setattr(main, "ECGFOUNDER_OUTPUTS", outputs)
    return base, outputs


def test_health_state_and_legacy_param_stats_match_frontend_contract(monkeypatch, tmp_path):
    base, _ = configure_runtime(monkeypatch, tmp_path)
    write_json(
        base / "shared_state.json",
        {
            "status": "training",
            "round": "round_7",
            "current_epoch": 3,
            "total_epochs": 5,
            "updated_at": "2026-05-25T20:00:00",
        },
    )
    write_json(
        base / "param_stats.json",
        {
            "layers": [],
            "global_norm": 0.0,
            "trainable_params": 12,
            "frozen_params": 4,
        },
    )

    client = TestClient(main.app)

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    training_state = client.get("/api/training/state")
    assert training_state.status_code == 200
    assert training_state.json()["current_epoch"] == 3

    stats = client.get("/api/training/param-stats")
    assert stats.status_code == 200
    body = stats.json()
    assert body["round"] == "round_7"
    assert body["epoch"] == 3
    assert body["timestamp"] == "2026-05-25T20:00:00"
    assert body["layers"] == []


def test_submit_training_task_writes_runner_compatible_top_level_config(monkeypatch, tmp_path):
    base, _ = configure_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/training/task",
        json={
            "dataset": "ECG",
            "config": {
                "epochs": 7,
                "batch_size": 16,
                "lr_backbone": 0.0002,
                "balance_before_split": False,
                "unfreeze_mode": "last_layer",
            },
        },
    )

    assert response.status_code == 200
    task = json.loads((base / "train_task.json").read_text(encoding="utf-8"))
    assert task["config"]["epochs"] == 7
    assert task["epochs"] == 7
    assert task["batch_size"] == 16
    assert task["lr_backbone"] == 0.0002


def test_history_log_eval_param_stats_and_checkpoints_contract(monkeypatch, tmp_path):
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    cpsc_dir = outputs / "cpsc2018_binary_v2_focal_mixup_tta"
    write_text(
        cpsc_dir / "history_20260511_203854.csv",
        "\n".join(
            [
                "epoch,train_loss,val_acc,val_macro_f1,val_weighted_f1,val_auc,threshold,best_macro_f1,best_auc,best_epoch,best_threshold,lr_backbone,lr_head,improved",
                "1,0.108,0.7369,0.5506,0.7625,0.6267,0.455,0.5506,0.6267,1,0.455,0.000003,0.00005,True",
                "2,0.0596,0.8532,0.7046,0.8581,0.7954,0.475,0.7046,0.7954,2,0.475,0.0000015,0.000013,True",
            ]
        ),
    )
    write_json(
        cpsc_dir / "summary_20260511_203854.json",
        {
            "best_epoch": 2,
            "best_val_macro_f1": 0.7046,
            "best_val_auc": 0.7954,
            "best_threshold": 0.475,
        },
    )
    write_text(cpsc_dir / "best_macro_f1.pth", "checkpoint")
    write_json(
        cpsc_dir / "param_history.json",
        {
            "round": "cpsc2018_binary_v2_focal_mixup_tta",
            "epochs": [
                {
                    "epoch": 2,
                    "timestamp": "2026-05-25T20:00:00",
                    "global_norm": 0.0,
                    "trainable_params": 12,
                    "frozen_params": 4,
                    "layer_summary": [],
                }
            ],
        },
    )

    mit_dir = outputs / "round_7"
    write_text(mit_dir / "train.log", "Epoch 1\nTrain Loss: 0.5\nVal F1    : 0.8\n")
    write_json(
        outputs / "test_evaluation_round_7.json",
        {
            "model": "round_7 Best",
            "checkpoint": "outputs/round_7/best_macro_f1.pth",
            "test_accuracy": 0.9,
            "test_macro_f1": 0.8,
            "test_weighted_f1": 0.82,
            "test_per_class_f1": {},
            "confusion_matrix": [],
            "classification_report": "report",
            "test_samples_count": 10,
        },
    )
    write_text(mit_dir / "best_macro_f1.pth", "checkpoint")
    write_json(mit_dir / "param_history.json", {"round": "round_7", "epochs": []})

    client = TestClient(main.app)

    history = client.get("/api/training/history")
    assert history.status_code == 200
    rounds = {item["round"]: item for item in history.json()}
    assert rounds["cpsc2018_binary_v2_focal_mixup_tta"]["source_type"] == "history_csv"
    assert rounds["round_7"]["dataset"] == "MIT-BIH"

    log = client.get("/api/training/history/cpsc2018_binary_v2_focal_mixup_tta/log")
    assert log.status_code == 200
    assert log.json()["epochs"][1]["epoch"] == 2

    eval_response = client.get("/api/training/history/round_7/eval")
    assert eval_response.status_code == 200
    assert eval_response.json()["test_macro_f1"] == 0.8

    param_history = client.get("/api/training/history/cpsc2018_binary_v2_focal_mixup_tta/param-stats")
    assert param_history.status_code == 200
    assert param_history.json()["epochs"][0]["epoch"] == 2

    checkpoints = client.get("/api/training/checkpoints")
    assert checkpoints.status_code == 200
    assert {item["round"] for item in checkpoints.json()} == {
        "cpsc2018_binary_v2_focal_mixup_tta",
        "round_7",
    }

    download = client.get("/api/training/checkpoints/round_7/best_macro_f1.pth")
    assert download.status_code == 200
