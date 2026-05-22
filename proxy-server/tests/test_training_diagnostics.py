from assistant.training_diagnostics import diagnose_training, diagnose_training_history


def test_idle_training_diagnosis_recommends_best_history_round():
    result = diagnose_training(
        state={"status": "idle", "error": None},
        param_stats=None,
        history_rounds=[
            {"round": "round_1", "dataset": "MIT-BIH", "best_f1": 0.62, "test_accuracy": 0.7},
            {"round": "round_2", "dataset": "MIT-BIH", "best_f1": 0.81, "test_accuracy": 0.84},
        ],
    )

    assert result["status"] == "idle"
    assert result["severity"] == "info"
    assert "当前没有训练任务在运行" in result["summary"]
    assert any("round_2" in item for item in result["recommendations"])
    assert result["recommendedRound"]["round"] == "round_2"


def test_training_diagnosis_flags_overfitting_and_gradient_risk():
    result = diagnose_training(
        state={
            "status": "training",
            "current_epoch": 8,
            "total_epochs": 10,
            "stage": "Finetune",
            "train_acc": 0.96,
            "val_macro_f1": 0.42,
            "train_loss": 0.18,
            "lr": 0.001,
        },
        param_stats={
            "global_norm": 180.0,
            "trainable_params": 120000,
            "frozen_params": 900000,
            "layers": [],
        },
        history_rounds=[],
    )

    assert result["status"] == "training"
    assert result["severity"] == "warning"
    assert "可能过拟合" in result["summary"]
    assert any("降低学习率" in item for item in result["recommendations"])
    assert any(item["label"] == "Global Norm" and item["value"] == "180.0000" for item in result["evidence"])


def test_history_diagnosis_ranks_best_round_and_detects_improvement():
    result = diagnose_training_history([
        {"round": "round_1", "dataset": "MIT-BIH", "best_f1": 0.58, "test_accuracy": 0.7},
        {"round": "round_2", "dataset": "MIT-BIH", "best_f1": 0.64, "test_accuracy": 0.74},
        {"round": "round_3", "dataset": "MIT-BIH", "best_f1": 0.78, "test_accuracy": 0.82},
    ])

    assert result["severity"] == "info"
    assert result["bestRound"]["round"] == "round_3"
    assert result["trend"]["direction"] == "improving"
    assert result["rankedRounds"][0]["round"] == "round_3"
    assert any("round_3" in item for item in result["recommendations"])


def test_history_diagnosis_flags_zero_f1_and_accuracy_f1_gap():
    result = diagnose_training_history([
        {"round": "round_1", "dataset": "MIT-BIH", "best_f1": 0.0, "test_accuracy": 0.0},
        {"round": "round_2", "dataset": "MIT-BIH", "best_f1": 0.32, "test_accuracy": 0.88},
    ])

    assert result["severity"] == "warning"
    assert len(result["anomalies"]) == 2
    assert any(item["round"] == "round_1" and "缺少有效 F1" in item["reason"] for item in result["anomalies"])
    assert any(item["round"] == "round_2" and "类别不平衡" in item["reason"] for item in result["anomalies"])
