from typing import Any


def _fmt_metric(value: Any, digits: int = 4) -> str:
    if isinstance(value, (int, float)):
        return f"{value:.{digits}f}"
    return "-"


def _metric_value(round_info: dict[str, Any], key: str) -> float:
    value = round_info.get(key)
    return float(value) if isinstance(value, (int, float)) else 0.0


def _best_round(history_rounds: list[dict[str, Any]]) -> dict[str, Any] | None:
    candidates = [r for r in history_rounds if isinstance(r.get("best_f1"), (int, float))]
    if not candidates:
        return None
    return max(candidates, key=lambda r: _metric_value(r, "best_f1"))


def diagnose_training(
    state: dict[str, Any],
    param_stats: dict[str, Any] | None,
    history_rounds: list[dict[str, Any]],
) -> dict[str, Any]:
    status = str(state.get("status") or "idle")
    recommendations: list[str] = []
    evidence: list[dict[str, str]] = []
    severity = "info"
    summary = "当前训练状态正常。"
    best = _best_round(history_rounds)

    if best:
        evidence.append({
            "label": "历史最佳轮次",
            "value": f"{best.get('round')} / F1 {_fmt_metric(best.get('best_f1'))}",
        })

    if status not in {"training", "running"}:
        summary = "当前没有训练任务在运行。"
        if best:
            recommendations.append(
                f"优先查看历史最佳轮次 {best.get('round')}，best F1 为 {_fmt_metric(best.get('best_f1'))}。"
            )
        else:
            recommendations.append("暂无历史最佳轮次，可先提交一次小规模训练任务建立基线。")
        return {
            "status": status,
            "severity": severity,
            "summary": summary,
            "recommendations": recommendations,
            "evidence": evidence,
            "recommendedRound": best,
        }

    current_epoch = state.get("current_epoch")
    total_epochs = state.get("total_epochs")
    train_acc = state.get("train_acc")
    val_macro_f1 = state.get("val_macro_f1")
    train_loss = state.get("train_loss")
    lr = state.get("lr")

    evidence.extend([
        {"label": "Epoch", "value": f"{current_epoch or '-'} / {total_epochs or '-'}"},
        {"label": "Train Loss", "value": _fmt_metric(train_loss)},
        {"label": "Train Acc", "value": _fmt_metric(train_acc)},
        {"label": "Val Macro F1", "value": _fmt_metric(val_macro_f1)},
        {"label": "Learning Rate", "value": _fmt_metric(lr, 6)},
    ])

    issues: list[str] = []
    if isinstance(train_acc, (int, float)) and isinstance(val_macro_f1, (int, float)):
        if train_acc >= 0.9 and val_macro_f1 <= 0.55:
            issues.append("可能过拟合")
            recommendations.append("训练准确率高但验证 Macro F1 偏低，建议检查类别不平衡、降低学习率或增强正则化。")
        elif current_epoch and current_epoch <= 2 and val_macro_f1 <= 0.45:
            recommendations.append("训练仍处于早期，建议继续观察 2-3 个 epoch 后再判断趋势。")

    if isinstance(lr, (int, float)) and lr >= 0.001:
        recommendations.append("当前学习率偏高，如指标震荡明显，可尝试降低学习率。")

    if param_stats:
        global_norm = param_stats.get("global_norm")
        evidence.append({"label": "Global Norm", "value": _fmt_metric(global_norm)})
        if isinstance(global_norm, (int, float)) and global_norm >= 100:
            issues.append("梯度可能不稳定")
            recommendations.append("Global Norm 偏大，建议降低学习率或启用梯度裁剪。")

        trainable = param_stats.get("trainable_params")
        frozen = param_stats.get("frozen_params")
        if isinstance(trainable, int) and isinstance(frozen, int):
            evidence.append({"label": "可训练 / 冻结参数", "value": f"{trainable:,} / {frozen:,}"})

    if not recommendations:
        recommendations.append("继续观察当前训练曲线，重点关注 Val Macro F1 与 Train Loss 是否同步改善。")

    if issues:
        severity = "warning"
        summary = "当前训练存在风险：" + "、".join(dict.fromkeys(issues)) + "。"
    else:
        summary = "当前训练正在运行，暂未发现明显异常。"

    return {
        "status": status,
        "severity": severity,
        "summary": summary,
        "recommendations": recommendations,
        "evidence": evidence,
        "recommendedRound": best,
    }


def diagnose_training_history(history_rounds: list[dict[str, Any]]) -> dict[str, Any]:
    ranked = sorted(history_rounds, key=lambda r: _metric_value(r, "best_f1"), reverse=True)
    best = ranked[0] if ranked else None
    anomalies: list[dict[str, str]] = []

    for round_info in history_rounds:
        round_name = str(round_info.get("round") or "unknown")
        best_f1 = _metric_value(round_info, "best_f1")
        accuracy = _metric_value(round_info, "test_accuracy")
        if best_f1 <= 0:
            anomalies.append({"round": round_name, "reason": "缺少有效 F1，可能没有评估结果或训练失败。"})
        elif accuracy >= 0.8 and best_f1 <= 0.4:
            anomalies.append({"round": round_name, "reason": "accuracy 高但 F1 低，可能存在类别不平衡或少数类表现较差。"})

    recent = sorted(history_rounds, key=lambda r: int(r.get("number") or 0))[-3:]
    direction = "stable"
    delta = 0.0
    if len(recent) >= 2:
        delta = _metric_value(recent[-1], "best_f1") - _metric_value(recent[0], "best_f1")
        if delta >= 0.05:
            direction = "improving"
        elif delta <= -0.05:
            direction = "declining"

    recommendations: list[str] = []
    if best:
        recommendations.append(
            f"优先保留或下载 {best.get('round')}，当前历史 best F1 为 {_fmt_metric(best.get('best_f1'))}。"
        )
    else:
        recommendations.append("暂无可排序历史记录，建议先完成一次训练并生成评估结果。")

    if direction == "improving":
        recommendations.append("最近轮次整体在提升，可以沿用当前训练配置继续小步试验。")
    elif direction == "declining":
        recommendations.append("最近轮次指标在下降，建议回看最佳轮次配置，避免继续扩大退化趋势。")
    else:
        recommendations.append("最近轮次变化不明显，建议比较数据切分、学习率和解冻策略。")

    if anomalies:
        recommendations.append("存在异常历史记录，建议优先检查评估文件、类别分布和训练日志完整性。")

    severity = "warning" if anomalies else "info"
    summary = (
        f"已分析 {len(history_rounds)} 个历史轮次，最佳轮次为 {best.get('round')}。"
        if best
        else "暂无历史训练记录可分析。"
    )

    return {
        "severity": severity,
        "summary": summary,
        "bestRound": best,
        "trend": {
            "direction": direction,
            "delta": round(delta, 6),
            "window": len(recent),
        },
        "anomalies": anomalies,
        "recommendations": recommendations,
        "rankedRounds": ranked[:5],
    }
