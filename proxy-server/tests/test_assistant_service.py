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
