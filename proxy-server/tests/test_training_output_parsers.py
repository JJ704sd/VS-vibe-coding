import json
from pathlib import Path

import parsers


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_cpsc_history_summary_and_eval_are_parsed(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    run_dir = outputs / "cpsc2018_binary_v2_focal_mixup_tta"
    write_text(
        run_dir / "history_20260511_203854.csv",
        "\n".join(
            [
                "epoch,train_loss,val_acc,val_macro_f1,val_weighted_f1,val_auc,threshold,best_macro_f1,best_auc,best_epoch,best_threshold,lr_backbone,lr_head,mixup_batches,total_train_batches,patience,improved",
                "1,0.108,0.7369,0.5506,0.7625,0.6267,0.455,0.5506,0.6267,1,0.455,0.000003,0.00005,99,171,0,True",
                "20,0.0596,0.8532,0.7046,0.8581,0.7954,0.475,0.7046,0.7954,20,0.475,0.0000015,0.000013,87,171,0,True",
                "21,0.0581,0.8103,0.6765,0.8289,0.8017,0.540,0.7046,0.7954,20,0.475,0.0000014,0.000011,76,171,1,False",
            ]
        ),
    )
    write_text(
        run_dir / "summary_20260511_203854.json",
        json.dumps(
            {
                "best_epoch": 20,
                "best_val_macro_f1": 0.7045578231292517,
                "best_val_auc": 0.7954479136270791,
                "best_threshold": 0.475,
                "total_epochs_ran": 28,
            }
        ),
    )

    monkeypatch.setattr(parsers, "ECGFOUNDER_OUTPUTS", outputs)

    history = parsers.list_all_history_with_dataset()
    assert history == [
        {
            "round": "cpsc2018_binary_v2_focal_mixup_tta",
            "number": 0,
            "dataset": "cpsc2018_binary_v2_focal_mixup_tta",
            "best_f1": 0.704558,
            "test_accuracy": 0.8103,
            "path": str(run_dir),
            "source_type": "history_csv",
            "status": "completed",
            "epoch_count": 3,
            "best_epoch": 20,
            "best_auc": 0.795448,
            "best_threshold": 0.475,
        }
    ]

    epochs = parsers.parse_history_csv_epochs(run_dir)
    assert len(epochs) == 3
    assert epochs[1]["epoch"] == 20
    assert epochs[1]["val_auc"] == 0.7954
    assert epochs[1]["threshold"] == 0.475
    assert epochs[1]["is_best"] is True

    eval_data = parsers.parse_evaluation("cpsc2018_binary_v2_focal_mixup_tta")
    assert eval_data["model"] == "cpsc2018_binary_v2_focal_mixup_tta"
    assert eval_data["test_macro_f1"] == 0.7045578231292517
    assert eval_data["test_accuracy"] == 0.8103
    assert eval_data["best_epoch"] == 20
    assert eval_data["source_type"] == "summary_json"


def test_mitbih_evaluation_and_train_round_log_are_parsed(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    round_dir = outputs / "round_11"
    round_dir.mkdir(parents=True)
    write_text(round_dir / "best_macro_f1.pth", "checkpoint")
    write_text(
        outputs / "test_evaluation_round_11.json",
        json.dumps(
            {
                "model": "round_11 Best",
                "checkpoint": "outputs/round_11/best_macro_f1.pth",
                "test_accuracy": 0.8925,
                "test_macro_f1": 0.8912257182513592,
                "test_weighted_f1": 0.8921668766893126,
                "test_per_class_f1": {"N": 0.88},
                "confusion_matrix": [[1]],
                "classification_report": "report",
                "test_samples_count": 400,
            }
        ),
    )
    write_text(
        outputs / "train_round_11.log",
        "\n".join(
            [
                "========== Stage 2: Finetune, lr_backbone=1e-05 ==========",
                "Epoch 9",
                "Train Loss: 0.5136",
                "Train Acc : 0.8825",
                "Train F1  : 0.8830",
                "Val Acc   : 0.8350",
                "Val F1    : 0.8356",
                "Current LR: 0.00000010",
                "Best Macro F1: 0.8399",
                "Best Epoch   : 9",
            ]
        ),
    )

    monkeypatch.setattr(parsers, "ECGFOUNDER_OUTPUTS", outputs)

    history = parsers.list_all_history_with_dataset()
    assert history[0]["round"] == "round_11"
    assert history[0]["dataset"] == "MIT-BIH"
    assert history[0]["best_f1"] == 0.891226
    assert history[0]["test_accuracy"] == 0.8925
    assert history[0]["source_type"] == "evaluation_json"

    epochs = parsers.parse_train_log("round_11")
    assert epochs == [
        {
            "epoch": 9,
            "is_best": False,
            "train_loss": 0.5136,
            "train_acc": 0.8825,
            "train_f1": 0.883,
            "val_acc": 0.835,
            "val_macro_f1": 0.8356,
            "stage": "Finetune",
            "lr": 1e-07,
        }
    ]


def test_root_train_round_log_without_directory_is_listed(monkeypatch, tmp_path):
    outputs = tmp_path / "outputs"
    outputs.mkdir(parents=True)
    write_text(
        outputs / "train_round_17.log",
        "\n".join(
            [
                "Epoch 5",
                "Train Loss: 0.6136",
                "Train Acc : 0.7825",
                "Train F1  : 0.7830",
                "Val Acc   : 0.7350",
                "Val F1    : 0.7356",
                "Training finished.",
                "Best Macro F1: 0.7399",
                "Best Epoch   : 5",
            ]
        ),
    )

    monkeypatch.setattr(parsers, "ECGFOUNDER_OUTPUTS", outputs)

    history = parsers.list_all_history_with_dataset()
    assert history == [
        {
            "round": "round_17",
            "number": 17,
            "dataset": "MIT-BIH",
            "best_f1": 0.7399,
            "test_accuracy": 0.735,
            "path": str(outputs / "train_round_17.log"),
            "source_type": "train_log",
            "status": "completed",
            "epoch_count": 1,
            "best_epoch": 5,
            "best_auc": 0.0,
            "best_threshold": 0.0,
        }
    ]
