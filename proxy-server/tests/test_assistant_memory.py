from assistant.memory_store import MemoryStore


def test_add_and_search_case_memory_by_record(tmp_path):
    store = MemoryStore(tmp_path / "assistant_memory.json")
    result = store.add_case_snapshot({
        "patientId": "p1",
        "recordId": "r1",
        "leadCount": 12,
        "primaryLead": "II",
        "annotationCount": 3,
        "signalQuality": 91,
        "annotations": [{"id": "a1", "type": "R", "position": 120, "confidence": 0.9, "manual": True}],
        "aiResults": [{"className": "Normal", "probability": 0.8}],
    })

    assert result["ok"] is True
    matches = store.search("当前记录有什么标注记忆", {"patientId": "p1", "recordId": "r1"})
    assert len(matches) == 1
    assert matches[0]["type"] == "memory"
    assert matches[0]["title"] == "r1"


def test_forget_case_memory_by_record(tmp_path):
    store = MemoryStore(tmp_path / "assistant_memory.json")
    store.add_case_snapshot({"patientId": "p1", "recordId": "r1", "annotationCount": 1})
    removed = store.forget(patient_id="p1", record_id="r1")

    assert removed == 1
    assert store.search("标注记忆", {"patientId": "p1", "recordId": "r1"}) == []


def test_store_initialization_does_not_create_runtime_file(tmp_path):
    memory_path = tmp_path / "assistant_memory.json"

    MemoryStore(memory_path)

    assert not memory_path.exists()


def test_forget_with_patient_and_record_only_removes_exact_case(tmp_path):
    store = MemoryStore(tmp_path / "assistant_memory.json")
    store.add_case_snapshot({"patientId": "p1", "recordId": "r1", "annotationCount": 1})
    store.add_case_snapshot({"patientId": "p1", "recordId": "r2", "annotationCount": 2})
    store.add_case_snapshot({"patientId": "p2", "recordId": "r1", "annotationCount": 3})

    removed = store.forget(patient_id="p1", record_id="r1")

    assert removed == 1
    assert store.search("记忆", {"patientId": "p1", "recordId": "r1"}) == []
    assert store.search("记忆", {"patientId": "p1", "recordId": "r2"})
    assert store.search("记忆", {"patientId": "p2", "recordId": "r1"})
