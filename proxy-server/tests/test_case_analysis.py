from assistant.case_analysis import analyze_case_snapshot


def test_case_analysis_returns_critical_when_no_leads():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 0,
        "primaryLead": "II",
        "annotationCount": 0,
        "signalQuality": 88,
        "annotations": [],
        "aiResults": [],
    })

    assert result["status"] == "insufficient"
    assert result["severity"] == "critical"
    assert any(item["code"] == "no_leads" for item in result["warnings"])


def test_case_analysis_warns_on_low_signal_quality():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 2,
        "signalQuality": 62,
        "annotations": [
            {"id": "a1", "type": "R", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "R", "position": 240, "confidence": 0.88, "manual": False},
        ],
        "aiResults": [{"className": "Normal", "probability": 0.78}],
    })

    assert result["status"] == "attention"
    assert result["severity"] == "warning"
    assert any(item["code"] == "medium_signal_quality" for item in result["warnings"])


def test_case_analysis_warns_on_annotation_type_imbalance():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 3,
        "signalQuality": 90,
        "annotations": [
            {"id": "a1", "type": "P", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "P", "position": 240, "confidence": 0.88, "manual": False},
            {"id": "a3", "type": "T", "position": 360, "confidence": 0.84, "manual": False},
        ],
        "aiResults": [{"className": "Normal", "probability": 0.81}],
    })

    assert any(item["code"] == "missing_r_anchor" for item in result["warnings"])


def test_case_analysis_warns_on_ambiguous_ai_results():
    result = analyze_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 2,
        "primaryLead": "II",
        "annotationCount": 3,
        "signalQuality": 90,
        "annotations": [
            {"id": "a1", "type": "P", "position": 100, "confidence": 0.9, "manual": True},
            {"id": "a2", "type": "R", "position": 240, "confidence": 0.88, "manual": False},
            {"id": "a3", "type": "T", "position": 360, "confidence": 0.84, "manual": False},
        ],
        "aiResults": [
            {"className": "Normal", "probability": 0.48},
            {"className": "AF", "probability": 0.45},
        ],
    })

    assert any(item["code"] == "ambiguous_ai_result" for item in result["warnings"])
