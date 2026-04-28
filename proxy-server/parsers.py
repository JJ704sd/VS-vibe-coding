"""
proxy-server/parsers.py
解析 train_round_*.log 和 test_evaluation_round_*.json
"""
import json
import re
from pathlib import Path
from typing import Optional

ECGFOUNDER_OUTPUTS = Path("D:/ECG founder/ECGFounder/outputs")


def parse_train_log(round_name: str) -> list[dict]:
    """
    解析 train_round_N.log，返回 epoch 列表。
    每条记录包含: epoch, stage, train_loss, train_acc, train_f1,
                 val_acc, val_macro_f1, val_weighted_f1, lr, is_best
    """
    log_file = ECGFOUNDER_OUTPUTS / f"train_{round_name}.log"
    if not log_file.exists():
        return []

    text = log_file.read_text(encoding="utf-8")
    results = []
    current = {}
    current_stage = None
    current_lr = None

    for line in text.splitlines():
        line = line.strip()

        # Stage 行: "========== Stage 1: Freeze backbone, lr=0.0001 =========="
        # 或: "========== Stage 2: Finetune, lr_backbone=1e-05 =========="
        stage_match = re.match(r"=+\s*Stage \d+:\s*(.+?),\s*lr(?:_backbone)?=(.+?)\s*=+", line)
        if stage_match:
            current_stage = stage_match.group(1).strip()
            current_lr = float(stage_match.group(2).strip())
            # 如果有未提交的 epoch data，先提交
            if current and current.get("epoch") is not None:
                current["stage"] = current_stage
                current["lr"] = current_lr
                results.append(current)
                current = {}
            continue

        # Epoch 行: "Epoch 1 (Stage 1)"
        epoch_match = re.match(r"Epoch\s+(\d+)\s+\(Stage\s+\d+\)", line)
        if epoch_match:
            if current and current.get("epoch") is not None:
                current["stage"] = current_stage
                current["lr"] = current_lr
                results.append(current)
            current = {"epoch": int(epoch_match.group(1)), "is_best": False}
            continue

        # Train 行: "  Train Loss=1.2563 Acc=0.6031 F1=0.6089"
        train_match = re.match(r"Train\s+Loss=([\d.]+)\s+Acc=([\d.]+)\s+F1=([\d.]+)", line)
        if train_match:
            current["train_loss"] = float(train_match.group(1))
            current["train_acc"] = float(train_match.group(2))
            current["train_f1"] = float(train_match.group(3))
            continue

        # Val 行: "  Val   Acc=0.6900 MacroF1=0.6852 WeightedF1=0.6852 LR=9.89e-06"
        val_match = re.match(
            r"Val\s+Acc=([\d.]+)\s+MacroF1=([\d.]+)\s+WeightedF1=([\d.]+)(?:\s+LR=([\d.e+-]+))?",
            line
        )
        if val_match:
            current["val_acc"] = float(val_match.group(1))
            current["val_macro_f1"] = float(val_match.group(2))
            current["val_weighted_f1"] = float(val_match.group(3))
            lr_group = val_match.group(4)
            if lr_group is not None:
                current["lr"] = float(lr_group)
            continue

        # SAVE 行: "  [SAVE] best_macro_f1=0.6852"
        save_match = re.match(r"\[SAVE\]\s+best_macro_f1=([\d.]+)", line)
        if save_match:
            current["is_best"] = True
            continue

    if current and current.get("epoch") is not None:
        current["stage"] = current_stage
        current["lr"] = current_lr
        results.append(current)

    return results


def parse_evaluation(round_name: str) -> Optional[dict]:
    """解析 test_evaluation_round_N.json"""
    eval_file = ECGFOUNDER_OUTPUTS / f"test_evaluation_{round_name}.json"
    if not eval_file.exists():
        return None
    return json.loads(eval_file.read_text(encoding="utf-8"))


def list_history_rounds() -> list[dict]:
    """扫描 outputs/ 目录，返回所有历史 round 列表（按编号排序）"""
    rounds = []
    for item in ECGFOUNDER_OUTPUTS.iterdir():
        if item.is_dir() and item.name.startswith("round_"):
            try:
                num = int(item.name.split("_")[1])
                rounds.append({"name": item.name, "number": num, "path": str(item)})
            except ValueError:
                pass
    rounds.sort(key=lambda x: x["number"])
    return rounds