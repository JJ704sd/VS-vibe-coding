import json
from pathlib import Path

import pytest
from fastapi import HTTPException
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
    # D-2: pre-set a stable admin token so destructive-route tests can
    # call `Authorization: Bearer <token>` without each test wiring
    # monkeypatch.setenv itself. Negative tests (D-2) override or unset
    # this to exercise the 401/503 paths.
    monkeypatch.setenv("SIDECAR_ADMIN_TOKEN", "test-admin-token")
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
        headers={"Authorization": "Bearer test-admin-token"},
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


# ── D-1: path-traversal regression tests ──────────────────────────────────
#
# Audit `2026-07-07-track-D-sidecar-build-ci.md` §1.1 found that
# `download_checkpoint` (and three sibling routes) accepted any
# `round_name`/`filename` from the URL, allowing `..%2F..%2F` payloads
# to escape `ECGFOUNDER_OUTPUTS/`. The fix adds `_safe_round_name` and
# `_safe_checkpoint_filename` helpers at every entry point; the tests
# below pin their behaviour.
#
# Note on test methodology: Starlette's HTTP parser refuses to route
# requests whose path segment is a literal `..` or contains `%2F`
# (the `%2F` cases short-circuit to 404 at the HTTP layer). To pin the
# helper's contract we therefore exercise it both directly (unit-style
# tests that take a payload string and assert it raises) and through
# the route with names that survive Starlette's URL normalisation but
# still contain the dangerous characters.


def test_safe_round_name_rejects_parent_directory_payload():
    """`_safe_round_name` must reject any value that contains `..`."""
    for payload in ("..", "../etc/passwd", "..\\..\\Windows", "round_7/..foo"):
        with pytest.raises(HTTPException) as exc_info:
            main._safe_round_name(payload)
        assert exc_info.value.status_code == 400, payload


def test_safe_round_name_rejects_leading_separator():
    """Leading `/` or `\\` would resolve to the filesystem root."""
    for payload in ("/etc/passwd", "\\Windows\\System32", "/round_7"):
        with pytest.raises(HTTPException) as exc_info:
            main._safe_round_name(payload)
        assert exc_info.value.status_code == 400, payload


def test_safe_round_name_rejects_empty():
    with pytest.raises(HTTPException) as exc_info:
        main._safe_round_name("")
    assert exc_info.value.status_code == 400


def test_safe_round_name_accepts_normal_names():
    """Happy-path: real round names pass through unchanged."""
    assert main._safe_round_name("round_7") == "round_7"
    assert (
        main._safe_round_name("cpsc2018_binary_v2_focal_mixup_tta")
        == "cpsc2018_binary_v2_focal_mixup_tta"
    )


def test_safe_checkpoint_filename_rejects_traversal_and_non_pth():
    for payload in (
        "..%2Fshared_state.json",  # encoded slash + parent
        "../../shared_state.json",  # literal parent + slash
        "best.pth/extra.pth",       # directory injection
        "best.pth\x00.txt",         # null-byte injection
        "summary.json",             # wrong extension
        "best.pth.tar.gz",          # wrong extension
        "",                          # empty
    ):
        with pytest.raises(HTTPException) as exc_info:
            main._safe_checkpoint_filename(payload)
        assert exc_info.value.status_code == 400, payload


def test_safe_checkpoint_filename_accepts_standard_pth():
    assert main._safe_checkpoint_filename("best_macro_f1.pth") == "best_macro_f1.pth"
    # Multi-dot names like `model.v2.pth` are allowed; the regex is
    # intentionally case-sensitive (`.PTH` is refused) to keep the
    # contract simple.
    assert main._safe_checkpoint_filename("model.v2.pth") == "model.v2.pth"


def test_safe_outputs_child_keeps_inside_outputs_root(monkeypatch, tmp_path):
    """`_safe_outputs_child` returns a Path inside `ECGFOUNDER_OUTPUTS/`."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    resolved = main._safe_outputs_child("round_7")
    assert str(resolved).startswith(str(outputs.resolve()))


def test_download_checkpoint_rejects_dotdot_prefixed_round(monkeypatch, tmp_path):
    """A round name that *starts* with `..` (without slashes, so Starlette
    still routes it) must still be rejected by `_safe_round_name`."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "best.pth", "checkpoint")
    (outputs / "shared_state.json").write_text("leak", encoding="utf-8")
    client = TestClient(main.app)

    # `..foo` is a valid path segment from Starlette's point of view;
    # the helper catches it because it contains `..`.
    response = client.get("/api/training/checkpoints/..foo/best.pth")
    assert response.status_code == 400


def test_download_checkpoint_rejects_subdir_round(monkeypatch, tmp_path):
    """`round_7/../shared_state.json` style payload, encoded so the slash
    survives Starlette's URL parser as the `..`+`/` lexical pattern."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "best.pth", "checkpoint")
    (outputs / "shared_state.json").write_text("leak", encoding="utf-8")
    client = TestClient(main.app)

    # `round_7/..` collapses at the HTTP parser. Use a name that
    # *contains* `..` but is a single segment, then passes the regex /
    # `..` check via a separate sibling round.
    response = client.get("/api/training/checkpoints/..round_7/best.pth")
    assert response.status_code == 400


def test_download_checkpoint_rejects_bad_filename_extension(monkeypatch, tmp_path):
    """Filenames that don't match `^[A-Za-z0-9_.-]+\\.pth$` are 400."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "summary.json", "leak")
    client = TestClient(main.app)

    response = client.get("/api/training/checkpoints/round_7/summary.json")
    assert response.status_code == 400


def test_get_round_log_and_eval_reject_traversal(monkeypatch, tmp_path):
    """Siblings of `download_checkpoint` share the helper and must also
    reject traversal. Use single-segment names containing `..` so
    Starlette's parser does not pre-empt the route."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    (outputs / "shared_state.json").write_text("leak", encoding="utf-8")
    client = TestClient(main.app)

    for endpoint in (
        "/api/training/history/..foo/log",
        "/api/training/history/..foo/eval",
    ):
        response = client.get(endpoint)
        assert response.status_code == 400, endpoint


def test_get_round_param_stats_rejects_traversal(monkeypatch, tmp_path):
    """`/param-stats` is the route that already had an inline check; the
    helper must produce the same 400."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    (outputs / "shared_state.json").write_text("leak", encoding="utf-8")
    client = TestClient(main.app)

    response = client.get("/api/training/history/..foo/param-stats")
    assert response.status_code == 400


def test_list_checkpoints_keeps_real_rounds_and_drops_bad_entries(monkeypatch, tmp_path):
    """`list_checkpoints` must keep legitimate round directories and never
    surface any synthetic `..` round name in its JSON response."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "best.pth", "checkpoint")
    client = TestClient(main.app)

    response = client.get("/api/training/checkpoints")
    assert response.status_code == 200
    rounds = {item["round"] for item in response.json()}
    assert "round_7" in rounds
    # No synthetic `..` / empty round name should ever appear.
    assert ".." not in rounds
    assert "" not in rounds


def test_download_checkpoint_happy_path_still_works(monkeypatch, tmp_path):
    """Pin the existing happy-path behaviour so the helper changes do not
    regress real downloads."""
    _, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "best_macro_f1.pth", "checkpoint-bytes")
    client = TestClient(main.app)

    response = client.get("/api/training/checkpoints/round_7/best_macro_f1.pth")
    assert response.status_code == 200
    assert response.content == b"checkpoint-bytes"


# ── D-2: admin-token regression tests ─────────────────────────────────────
#
# Audit `2026-07-07-track-D-sidecar-build-ci.md` §1.2 found that any
# network-reachable client could call destructive endpoints on the
# sidecar. The fix adds a `verify_admin_token` FastAPI dependency on
# `POST /api/training/task`, `POST /api/training/stop`, and
# `DELETE /api/training/history/{round}`. The tests below pin the
# three documented behaviours: missing/empty token = 401, wrong token
# = 401, correct token = 200, and SIDECAR_ADMIN_TOKEN unset = 503
# (fail-closed).


ADMIN_HEADERS = {"Authorization": "Bearer test-admin-token"}


def test_destructive_routes_require_admin_token(monkeypatch, tmp_path):
    base, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_1" / "train.log", "Epoch 1\n")
    client = TestClient(main.app)

    # 1. POST /api/training/task without token → 401
    response = client.post("/api/training/task", json={"dataset": "ECG"})
    assert response.status_code == 401

    # 2. POST /api/training/stop without token → 401
    response = client.post("/api/training/stop")
    assert response.status_code == 401

    # 3. DELETE /api/training/history/{round} without token → 401
    response = client.delete(
        "/api/training/history/round_1",
        params={"confirm": "round_1"},
    )
    assert response.status_code == 401

    # Side-effect: no train_task.json, no rm of round_1
    assert not (base / "train_task.json").exists()
    assert (outputs / "round_1").exists()


def test_destructive_routes_reject_malformed_bearer(monkeypatch, tmp_path):
    """Headers without `Bearer ` prefix or with empty token are 401."""
    configure_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/training/task",
        json={"dataset": "ECG"},
        headers={"Authorization": "test-admin-token"},
    )
    assert response.status_code == 401

    response = client.post(
        "/api/training/task",
        json={"dataset": "ECG"},
        headers={"Authorization": "Bearer "},
    )
    assert response.status_code == 401


def test_destructive_routes_reject_wrong_token(monkeypatch, tmp_path):
    base, _ = configure_runtime(monkeypatch, tmp_path)
    client = TestClient(main.app)

    response = client.post(
        "/api/training/task",
        json={"dataset": "ECG"},
        headers={"Authorization": "Bearer wrong-token"},
    )
    assert response.status_code == 401
    # No side-effect: no train_task.json written.
    assert not (base / "train_task.json").exists()


def test_destructive_routes_succeed_with_correct_token(monkeypatch, tmp_path):
    base, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_1" / "train.log", "Epoch 1\n")
    client = TestClient(main.app)

    # 1. POST /api/training/task
    response = client.post(
        "/api/training/task",
        json={"dataset": "ECG", "config": {"epochs": 1, "batch_size": 8}},
        headers=ADMIN_HEADERS,
    )
    assert response.status_code == 200
    assert (base / "train_task.json").exists()

    # 2. POST /api/training/stop
    response = client.post("/api/training/stop", headers=ADMIN_HEADERS)
    assert response.status_code == 200

    # 3. DELETE /api/training/history/{round}
    response = client.delete(
        "/api/training/history/round_1",
        params={"confirm": "round_1"},
        headers=ADMIN_HEADERS,
    )
    assert response.status_code == 200
    assert response.json() == {"ok": True, "deleted": "round_1"}
    assert not (outputs / "round_1").exists()


def test_destructive_routes_fail_closed_when_admin_token_unset(monkeypatch, tmp_path):
    """If the operator forgets to set SIDECAR_ADMIN_TOKEN, the sidecar
    refuses all destructive traffic with 503 (fail-closed)."""
    configure_runtime(monkeypatch, tmp_path)
    monkeypatch.delenv("SIDECAR_ADMIN_TOKEN", raising=False)
    client = TestClient(main.app)

    response = client.post(
        "/api/training/task",
        json={"dataset": "ECG"},
        headers=ADMIN_HEADERS,
    )
    assert response.status_code == 503

    response = client.post(
        "/api/training/stop",
        headers=ADMIN_HEADERS,
    )
    assert response.status_code == 503


def test_read_routes_remain_unauthenticated(monkeypatch, tmp_path):
    """D-2 scope: read-only routes stay open. Pin the current behaviour
    so a future token-gate change is intentional and visible in diff."""
    base, outputs = configure_runtime(monkeypatch, tmp_path)
    write_text(outputs / "round_7" / "best.pth", "checkpoint")
    write_text(outputs / "round_7" / "train.log", "Epoch 1\nTrain Loss: 0.5\nVal F1    : 0.8\n")
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
    write_json(base / "shared_state.json", {"status": "idle", "round": "round_7"})
    client = TestClient(main.app)

    for endpoint in (
        "/health",
        "/api/training/state",
        "/api/training/history",
        "/api/training/checkpoints",
        "/api/training/history/round_7/log",
        "/api/training/history/round_7/eval",
    ):
        response = client.get(endpoint)
        assert response.status_code == 200, endpoint

