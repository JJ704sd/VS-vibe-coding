import csv
import json
import re
from pathlib import Path
from typing import Optional

from state import ECGFOUNDER_BASE

ECGFOUNDER_OUTPUTS = ECGFOUNDER_BASE / "outputs"


def _latest_file(directory: Path, pattern: str) -> Optional[Path]:
    files = list(directory.glob(pattern))
    if not files:
        return None
    return max(files, key=lambda p: p.stat().st_mtime)


def _safe_float(value, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _read_json(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _read_latest_summary(round_dir: Path) -> Optional[dict]:
    summary_file = _latest_file(round_dir, "summary_*.json")
    return _read_json(summary_file) if summary_file else None


def parse_history_csv(round_dir: Path) -> Optional[dict]:
    """Read the latest CPSC-style history CSV and return run-level metrics."""
    latest_csv = _latest_file(round_dir, "history_*.csv")
    if not latest_csv:
        return None

    try:
        with open(latest_csv, encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
    except OSError:
        return None

    if not rows:
        return None

    last = rows[-1]
    summary = _read_latest_summary(round_dir) or {}
    best_f1 = _safe_float(summary.get("best_val_macro_f1"), _safe_float(last.get("best_macro_f1")))
    test_acc = _safe_float(last.get("val_acc"))
    best_auc = _safe_float(summary.get("best_val_auc"), _safe_float(last.get("best_auc")))
    best_threshold = _safe_float(summary.get("best_threshold"), _safe_float(last.get("best_threshold")))
    best_epoch = _safe_int(summary.get("best_epoch"), _safe_int(last.get("best_epoch")))
    total_epochs_ran = _safe_int(summary.get("total_epochs_ran"), len(rows))

    return {
        "best_f1": round(best_f1, 6),
        "test_accuracy": round(test_acc, 6),
        "source_type": "history_csv",
        "status": "completed",
        "epoch_count": len(rows),
        "best_epoch": best_epoch,
        "best_auc": round(best_auc, 6),
        "best_threshold": round(best_threshold, 6),
        "total_epochs_ran": total_epochs_ran,
    }


def parse_history_csv_epochs(round_dir: Path) -> list[dict]:
    """Read all epochs from the latest CPSC-style history CSV."""
    latest_csv = _latest_file(round_dir, "history_*.csv")
    if not latest_csv:
        return []

    try:
        with open(latest_csv, encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
    except OSError:
        return []

    results = []
    for row in rows:
        epoch = _safe_int(row.get("epoch"))
        if epoch <= 0:
            continue
        results.append({
            "epoch": epoch,
            "stage": "Finetune",
            "train_loss": _safe_float(row.get("train_loss")),
            "train_acc": 0.0,
            "train_f1": 0.0,
            "val_acc": _safe_float(row.get("val_acc")),
            "val_macro_f1": _safe_float(row.get("val_macro_f1")),
            "val_weighted_f1": _safe_float(row.get("val_weighted_f1")),
            "val_auc": _safe_float(row.get("val_auc")),
            "threshold": _safe_float(row.get("threshold")),
            "lr": _safe_float(row.get("lr_backbone")),
            "lr_backbone": _safe_float(row.get("lr_backbone")),
            "lr_head": _safe_float(row.get("lr_head")),
            "is_best": str(row.get("improved", "")).strip().lower() == "true",
            "best_macro_f1": _safe_float(row.get("best_macro_f1")),
            "best_auc": _safe_float(row.get("best_auc")),
            "best_epoch": _safe_int(row.get("best_epoch")),
            "best_threshold": _safe_float(row.get("best_threshold")),
            "patience": _safe_int(row.get("patience")),
            "mixup_batches": _safe_int(row.get("mixup_batches")),
            "total_train_batches": _safe_int(row.get("total_train_batches")),
        })
    return results


def _set_current_defaults(current: dict, current_stage: Optional[str], current_lr: Optional[float]) -> dict:
    current.setdefault("stage", current_stage)
    if "lr" not in current:
        current["lr"] = current_lr
    return current


def parse_train_log(round_name: str) -> list[dict]:
    """Parse MIT-BIH train_round_N.log or outputs/round_N/train.log into epochs."""
    log_file = ECGFOUNDER_OUTPUTS / f"train_{round_name}.log"
    if not log_file.exists():
        log_file = ECGFOUNDER_OUTPUTS / round_name / "train.log"
    if not log_file.exists():
        return []

    text = log_file.read_text(encoding="utf-8", errors="replace")
    results = []
    current: dict = {}
    current_stage = None
    current_lr = None
    seen_progress_epochs: set[int] = set()

    def flush_current() -> None:
        nonlocal current
        if current.get("epoch") is not None and any(
            key in current for key in ("train_loss", "train_acc", "train_f1", "val_acc", "val_macro_f1")
        ):
            results.append(_set_current_defaults(current, current_stage, current_lr))
        current = {}

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        stage_match = re.match(r"=+\s*Stage \d+:\s*(.+?),\s*lr(?:_backbone)?=([\deE.+-]+)\s*=+", line)
        if stage_match:
            flush_current()
            current_stage = stage_match.group(1).strip()
            current_lr = _safe_float(stage_match.group(2))
            continue

        stage_epoch_match = re.match(r"Stage\s+\d+\s+Epoch\s+(\d+):", line)
        if stage_epoch_match:
            epoch = _safe_int(stage_epoch_match.group(1))
            if epoch not in seen_progress_epochs:
                flush_current()
                current = {"epoch": epoch, "is_best": False}
                seen_progress_epochs.add(epoch)
            continue

        epoch_match = re.match(r"^Epoch\s+(\d+)(?:\s+\(Stage\s+\d+\))?$", line)
        if epoch_match:
            flush_current()
            current = {"epoch": _safe_int(epoch_match.group(1)), "is_best": False}
            continue

        train_loss_match = re.match(r"^\s*Train\s+Loss[:=]\s*([\d.]+)", line)
        if train_loss_match:
            current["train_loss"] = _safe_float(train_loss_match.group(1))
            train_acc_eq = re.search(r"Acc=([\d.]+)", line)
            if train_acc_eq:
                current["train_acc"] = _safe_float(train_acc_eq.group(1))
            train_f1_eq = re.search(r"F1=([\d.]+)", line)
            if train_f1_eq:
                current["train_f1"] = _safe_float(train_f1_eq.group(1))
            continue

        train_acc_match = re.match(r"^\s*Train\s+Acc\s*[:=]\s*([\d.]+)", line)
        if train_acc_match:
            current["train_acc"] = _safe_float(train_acc_match.group(1))
            continue

        train_f1_match = re.match(r"^\s*Train\s+F1\s*[:=]\s*([\d.]+)", line)
        if train_f1_match:
            current["train_f1"] = _safe_float(train_f1_match.group(1))
            continue

        val_match = re.match(r"^\s*Val\s+Acc\s*[:=]\s*([\d.]+)", line)
        if val_match:
            current["val_acc"] = _safe_float(val_match.group(1))
            macro_match = re.search(r"MacroF1=([\d.]+)", line)
            if macro_match:
                current["val_macro_f1"] = _safe_float(macro_match.group(1))
            weighted_match = re.search(r"WeightedF1=([\d.]+)", line)
            if weighted_match:
                current["val_weighted_f1"] = _safe_float(weighted_match.group(1))
            lr_match = re.search(r"LR=([\deE.+-]+)", line)
            if lr_match:
                current["lr"] = _safe_float(lr_match.group(1))
            continue

        val_f1_match = re.match(r"^\s*Val\s+F1\s*[:=]\s*([\d.]+)", line)
        if val_f1_match:
            current["val_macro_f1"] = _safe_float(val_f1_match.group(1))
            continue

        current_lr_match = re.match(r"^\s*Current\s+LR\s*[:=]\s*([\deE.+-]+)", line)
        if current_lr_match:
            current_lr = _safe_float(current_lr_match.group(1))
            current["lr"] = current_lr
            continue

        if re.match(r"(\[SAVE\]|Saved best model)", line):
            current["is_best"] = True
            continue

    flush_current()
    return results


def parse_train_log_summary(round_name: str) -> Optional[dict]:
    """Read best metrics from a root train_round_N.log or round_N/train.log."""
    log_file = ECGFOUNDER_OUTPUTS / f"train_{round_name}.log"
    if not log_file.exists():
        log_file = ECGFOUNDER_OUTPUTS / round_name / "train.log"
    if not log_file.exists():
        return None

    text = log_file.read_text(encoding="utf-8", errors="replace")
    best_f1_match = re.search(r"Best\s+Macro\s+F1:\s*([\d.]+)", text)
    best_epoch_match = re.search(r"Best\s+Epoch\s*:\s*(\d+)", text)
    epochs = parse_train_log(round_name)
    last_epoch = epochs[-1] if epochs else {}
    if not best_f1_match and not epochs:
        return None

    best_f1 = _safe_float(best_f1_match.group(1) if best_f1_match else last_epoch.get("val_macro_f1"))
    return {
        "best_f1": round(best_f1, 6),
        "test_accuracy": round(_safe_float(last_epoch.get("val_acc")), 6),
        "source_type": "train_log",
        "status": "completed" if epochs or best_f1 > 0 else "unknown",
        "epoch_count": len(epochs),
        "best_epoch": _safe_int(best_epoch_match.group(1) if best_epoch_match else last_epoch.get("epoch")),
        "best_auc": 0.0,
        "best_threshold": 0.0,
    }


def parse_evaluation(round_name: str) -> Optional[dict]:
    """Parse test_evaluation JSON or synthesize one from CPSC summary/history files."""
    eval_file = ECGFOUNDER_OUTPUTS / f"test_evaluation_{round_name}.json"
    if eval_file.exists():
        return _read_json(eval_file)

    round_dir = ECGFOUNDER_OUTPUTS / round_name
    if not round_dir.exists():
        return None

    summary = _read_latest_summary(round_dir)
    csv_data = parse_history_csv(round_dir)
    epochs = parse_history_csv_epochs(round_dir)
    if not summary and not csv_data:
        return None

    last_epoch = epochs[-1] if epochs else {}
    report_file = _latest_file(round_dir, "classification_report_epoch_*.txt")
    report_text = ""
    if report_file:
        try:
            report_text = report_file.read_text(encoding="utf-8")
        except OSError:
            report_text = ""

    best_f1 = _safe_float(summary.get("best_val_macro_f1") if summary else None, csv_data.get("best_f1", 0.0) if csv_data else 0.0)
    return {
        "model": round_name,
        "checkpoint": str(next(round_dir.glob("*.pth"), "")),
        "val_macro_f1_original": best_f1,
        "val_subset_macro_f1": best_f1,
        "test_accuracy": _safe_float(last_epoch.get("val_acc"), csv_data.get("test_accuracy", 0.0) if csv_data else 0.0),
        "test_macro_f1": best_f1,
        "test_weighted_f1": _safe_float(last_epoch.get("val_weighted_f1")),
        "test_per_class_f1": {},
        "confusion_matrix": [],
        "classification_report": report_text,
        "test_samples_count": 0,
        "best_epoch": _safe_int(summary.get("best_epoch") if summary else None, csv_data.get("best_epoch", 0) if csv_data else 0),
        "best_auc": _safe_float(summary.get("best_val_auc") if summary else None, csv_data.get("best_auc", 0.0) if csv_data else 0.0),
        "best_threshold": _safe_float(summary.get("best_threshold") if summary else None, csv_data.get("best_threshold", 0.0) if csv_data else 0.0),
        "source_type": "summary_json" if summary else "history_csv",
    }


def list_all_history_with_dataset() -> list[dict]:
    """Scan every output directory and return normalized history rows."""
    results = []
    if not ECGFOUNDER_OUTPUTS.exists():
        return results
    seen_rounds: set[str] = set()

    for item in ECGFOUNDER_OUTPUTS.iterdir():
        if not item.is_dir():
            continue

        if item.name.startswith("round_"):
            dataset = "MIT-BIH"
            try:
                number = int(item.name.split("_")[1])
            except ValueError:
                continue
        else:
            dataset = item.name
            number = 0

        metadata = {
            "best_f1": 0.0,
            "test_accuracy": 0.0,
            "source_type": "unknown",
            "status": "unknown",
            "epoch_count": 0,
            "best_epoch": 0,
            "best_auc": 0.0,
            "best_threshold": 0.0,
        }

        result_file = item / "result.json"
        result_data = _read_json(result_file) if result_file.exists() else None
        if result_data:
            metadata.update({
                "best_f1": result_data.get("best_macro_f1", 0.0)
                or result_data.get("test_macro_f1", 0.0)
                or result_data.get("val_macro_f1", 0.0),
                "test_accuracy": result_data.get("test_accuracy", 0.0) or result_data.get("val_accuracy", 0.0),
                "source_type": "result_json",
                "status": "completed",
            })

        if _safe_float(metadata["best_f1"]) == 0.0:
            csv_data = parse_history_csv(item)
            if csv_data:
                metadata.update(csv_data)
                epochs = parse_history_csv_epochs(item)
                if epochs:
                    metadata["test_accuracy"] = _safe_float(epochs[-1].get("val_acc"), metadata["test_accuracy"])
            else:
                eval_data = parse_evaluation(item.name)
                if eval_data:
                    source_type = eval_data.get("source_type") or "evaluation_json"
                    metadata.update({
                        "best_f1": eval_data.get("test_macro_f1", 0.0),
                        "test_accuracy": eval_data.get("test_accuracy", 0.0),
                        "source_type": source_type,
                        "status": "completed",
                        "best_epoch": eval_data.get("best_epoch", 0) or 0,
                        "best_auc": eval_data.get("best_auc", 0.0) or 0.0,
                        "best_threshold": eval_data.get("best_threshold", 0.0) or 0.0,
                    })

        epochs = parse_history_csv_epochs(item) or parse_train_log(item.name)
        if epochs:
            metadata["epoch_count"] = metadata.get("epoch_count") or len(epochs)
            metadata["status"] = "completed"

        if _safe_float(metadata["best_f1"]) == 0.0:
            log_summary = parse_train_log_summary(item.name)
            if log_summary:
                metadata.update(log_summary)

        results.append({
            "round": item.name,
            "number": number,
            "dataset": dataset,
            "best_f1": round(_safe_float(metadata.get("best_f1")), 6),
            "test_accuracy": round(_safe_float(metadata.get("test_accuracy")), 6),
            "path": str(item),
            "source_type": metadata.get("source_type", "unknown"),
            "status": metadata.get("status", "unknown"),
            "epoch_count": _safe_int(metadata.get("epoch_count")),
            "best_epoch": _safe_int(metadata.get("best_epoch")),
            "best_auc": round(_safe_float(metadata.get("best_auc")), 6),
            "best_threshold": round(_safe_float(metadata.get("best_threshold")), 6),
        })
        seen_rounds.add(item.name)

    for log_file in ECGFOUNDER_OUTPUTS.glob("train_round_*.log"):
        match = re.match(r"train_(round_(\d+))\.log$", log_file.name)
        if not match:
            continue
        round_name = match.group(1)
        if round_name in seen_rounds:
            continue
        summary = parse_train_log_summary(round_name)
        if not summary:
            continue
        results.append({
            "round": round_name,
            "number": _safe_int(match.group(2)),
            "dataset": "MIT-BIH",
            "best_f1": round(_safe_float(summary.get("best_f1")), 6),
            "test_accuracy": round(_safe_float(summary.get("test_accuracy")), 6),
            "path": str(log_file),
            "source_type": summary.get("source_type", "train_log"),
            "status": summary.get("status", "unknown"),
            "epoch_count": _safe_int(summary.get("epoch_count")),
            "best_epoch": _safe_int(summary.get("best_epoch")),
            "best_auc": round(_safe_float(summary.get("best_auc")), 6),
            "best_threshold": round(_safe_float(summary.get("best_threshold")), 6),
        })

    results.sort(key=lambda x: (x["dataset"], x["number"], x["round"]))
    return results


def list_history_rounds() -> list[dict]:
    """Return round_N entries for backward-compatible assistant diagnostics."""
    rounds = []
    if not ECGFOUNDER_OUTPUTS.exists():
        return rounds
    for item in ECGFOUNDER_OUTPUTS.iterdir():
        if item.is_dir() and item.name.startswith("round_"):
            try:
                num = int(item.name.split("_")[1])
                rounds.append({"name": item.name, "number": num, "path": str(item)})
            except ValueError:
                pass
    rounds.sort(key=lambda x: x["number"])
    return rounds
