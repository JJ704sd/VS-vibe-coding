from collections import Counter
from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    return float(value) if isinstance(value, (int, float)) else default


def _count_by_type(annotations: list[dict[str, Any]]) -> Counter:
    return Counter(str(item.get("type") or "").upper() for item in annotations if item.get("type"))


def _set_attention(severity: str, status: str) -> tuple[str, str]:
    if severity == "critical":
        return severity, status
    return "warning", "attention"


def analyze_case_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    lead_count = int(_number(snapshot.get("leadCount"), 0))
    annotation_count = int(_number(snapshot.get("annotationCount"), 0))
    signal_quality = _number(snapshot.get("signalQuality"), 0)
    annotations = snapshot.get("annotations") if isinstance(snapshot.get("annotations"), list) else []
    ai_results = snapshot.get("aiResults") if isinstance(snapshot.get("aiResults"), list) else []
    type_counts = _count_by_type(annotations)

    warnings: list[dict[str, str]] = []
    recommendations: list[dict[str, str]] = []
    severity = "info"
    status = "ready"

    if lead_count <= 0:
        warnings.append({"code": "no_leads", "message": "当前病例没有可分析导联。"})
        recommendations.append({"priority": "high", "text": "请先导入 ECG 数据或切换到包含导联的记录。"})
        severity = "critical"
        status = "insufficient"

    if signal_quality < 50:
        warnings.append({"code": "low_signal_quality", "message": "当前信号质量偏低。"})
        recommendations.append({"priority": "high", "text": "建议重新导入数据，或先检查噪声与基线漂移。"})
        severity = "critical"
        status = "insufficient"
    elif signal_quality < 75:
        warnings.append({"code": "medium_signal_quality", "message": "当前信号质量需要人工复核。"})
        recommendations.append({"priority": "medium", "text": "参考 AI 结果前，请先检查主导联波形质量。"})
        severity, status = _set_attention(severity, status)

    if annotation_count == 0:
        warnings.append({"code": "no_annotations", "message": "当前记录还没有标注。"})
        recommendations.append({"priority": "medium", "text": "建议先添加或导入 P/R/T 标注。"})
        severity, status = _set_attention(severity, status)
    elif len(type_counts) == 1:
        only_type = next(iter(type_counts))
        warnings.append({"code": "single_annotation_type", "message": f"当前标注集中在 {only_type} 类型。"})
        recommendations.append({"priority": "medium", "text": "建议检查 P/R/T 标注是否缺失。"})
        severity, status = _set_attention(severity, status)

    if annotation_count > 0 and "R" not in type_counts and ("P" in type_counts or "T" in type_counts):
        warnings.append({"code": "missing_r_anchor", "message": "存在 P/T 标注但缺少 R 峰锚点。"})
        recommendations.append({"priority": "high", "text": "建议先核对 R 峰，再判断 P/T 标注完整性。"})
        severity, status = _set_attention(severity, status)

    probabilities = sorted(
        [_number(item.get("probability"), 0) for item in ai_results if isinstance(item, dict)],
        reverse=True,
    )
    if len(probabilities) >= 2 and probabilities[0] - probabilities[1] <= 0.08:
        warnings.append({"code": "ambiguous_ai_result", "message": "AI 前两名概率接近，结果存在歧义。"})
        recommendations.append({"priority": "medium", "text": "建议人工复核 AI 最高概率类别。"})
        severity, status = _set_attention(severity, status)
    elif probabilities and probabilities[0] < 0.6:
        warnings.append({"code": "low_ai_confidence", "message": "AI 最高概率偏低。"})
        recommendations.append({"priority": "medium", "text": "建议不要单独依赖该 AI 结果。"})
        severity, status = _set_attention(severity, status)

    summary = (
        f"当前记录 {snapshot.get('recordId') or '-'}：{lead_count} 个导联，"
        f"主导联 {snapshot.get('primaryLead') or '-'}，信号质量 {signal_quality:.0f}%，"
        f"标注 {annotation_count} 个。"
    )
    summary += " 存在需要复核的风险项。" if warnings else " 暂未发现明显病例质量风险。"

    return {
        "status": status,
        "severity": severity,
        "summary": summary,
        "metrics": [
            {"label": "导联数", "value": str(lead_count)},
            {"label": "主导联", "value": str(snapshot.get("primaryLead") or "-")},
            {"label": "信号质量", "value": f"{signal_quality:.0f}%"},
            {"label": "标注数量", "value": str(annotation_count)},
        ],
        "warnings": warnings,
        "recommendations": recommendations,
        "sources": [{
            "type": "case",
            "title": "当前病例快照",
            "path": "request.context",
            "score": 1,
            "snippet": summary,
        }],
    }
