from assistant.memory_store import MemoryStore
from assistant.rag_store import RAGStore
from assistant.service import AssistantService


def test_memory_question_routes_to_memory(tmp_path):
    memory = MemoryStore(tmp_path / "memory.json")
    rag = RAGStore(tmp_path)
    service = AssistantService(memory, rag)
    memory.add_case_snapshot({"patientId": "p1", "recordId": "r1", "annotationCount": 2, "primaryLead": "II"})

    result = service.ask("当前记录有什么标注记忆？", {"patientId": "p1", "recordId": "r1"})

    assert result["mode"] == "memory"
    assert "辅助参考" in result["answer"]
    assert result["sources"][0]["type"] == "memory"


def test_wfdb_question_routes_to_knowledge(tmp_path):
    (tmp_path / "README.md").write_text("# Import\nWFDB files use HEA and DAT pairs.", encoding="utf-8")
    memory = MemoryStore(tmp_path / "memory.json")
    rag = RAGStore(tmp_path)
    service = AssistantService(memory, rag)

    result = service.ask("WFDB 文件如何导入？", {"patientId": "p1", "recordId": "r1"})

    assert result["mode"] == "knowledge"
    assert result["sources"]
    assert result["sources"][0]["type"] == "knowledge"


def test_annotation_question_explains_current_context_without_saved_memory(tmp_path):
    memory = MemoryStore(tmp_path / "memory.json")
    rag = RAGStore(tmp_path)
    service = AssistantService(memory, rag)

    result = service.ask(
        "解释当前标注",
        {
            "patientId": "p1",
            "recordId": "r1",
            "primaryLead": "II",
            "leadCount": 2,
            "annotationCount": 3,
            "signalQuality": 87,
            "annotations": [
                {"id": "a1", "type": "P", "position": 100, "confidence": 0.9, "manual": True},
                {"id": "a2", "type": "R", "position": 140, "confidence": 0.8, "manual": False},
                {"id": "a3", "type": "R", "position": 220, "confidence": 0.85, "manual": False},
            ],
            "aiResults": [
                {"className": "Normal sinus rhythm", "probability": 0.76},
                {"className": "AF", "probability": 0.21},
            ],
        },
    )

    assert result["mode"] == "case"
    assert "当前记录 r1" in result["answer"]
    assert "信号质量 87%" in result["answer"]
    assert "P 1 个" in result["answer"]
    assert "R 2 个" in result["answer"]
    assert "手工 1 个，自动 2 个" in result["answer"]
    assert "Normal sinus rhythm 76.0%" in result["answer"]
    assert result["sources"][0]["type"] == "case"


def test_rebuild_fallback_writes_to_sidecar_dir_not_repo(tmp_path, monkeypatch):
    """C-06: when no docs are present the fallback knowledge base used to
    land in `<repo>/docs/assistant/knowledge-base.md`, which is inside the
    working tree. After the closeout it lands in the sidecar data directory
    so a long-running process can't pollute the repo on disk.
    """
    from assistant import rag_store

    fallback_dir = tmp_path / "sidecar-data" / "assistant"
    monkeypatch.setattr(rag_store, "DEFAULT_FALLBACK_DIR", fallback_dir)

    rag = RAGStore(tmp_path)

    result = rag.rebuild()

    fallback_file = fallback_dir / "knowledge-base.md"
    assert fallback_file.exists()
    assert result["indexedDocuments"] == 1
    assert result["chunks"] > 0
    assert "WFDB" in fallback_file.read_text(encoding="utf-8")
    # The repo working tree must stay clean.
    assert not (tmp_path / "docs").exists()


def test_main_creates_assistant_service_lazily_without_writing_memory_file(tmp_path, monkeypatch):
    import main

    memory_file = tmp_path / "assistant_memory.json"
    monkeypatch.setenv("ASSISTANT_MEMORY_FILE", str(memory_file))
    main._assistant_service = None

    assert not memory_file.exists()
    service = main.get_assistant_service()

    assert isinstance(service, AssistantService)
    assert not memory_file.exists()


def test_case_analyze_endpoint_returns_structured_risk():
    import asyncio
    import main

    result = asyncio.run(main.analyze_assistant_case({
        "context": {
            "patientId": "p1",
            "recordId": "r1",
            "leadCount": 0,
            "primaryLead": "II",
            "annotationCount": 0,
            "signalQuality": 80,
            "annotations": [],
            "aiResults": [],
        }
    }))

    assert result["severity"] == "critical"
    assert any(item["code"] == "no_leads" for item in result["warnings"])
