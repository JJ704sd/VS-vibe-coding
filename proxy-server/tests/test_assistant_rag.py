from assistant.rag_store import RAGStore


def test_rebuild_indexes_markdown_and_returns_sources(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "README.md").write_text("# ECG Platform\nWFDB files can be imported as paired HEA and DAT files.", encoding="utf-8")
    (root / "SPEC.md").write_text("# Spec\nAnnotations include P Q R S T ST U markers.", encoding="utf-8")

    store = RAGStore(root)
    summary = store.rebuild()
    matches = store.search("WFDB 文件如何导入")

    assert summary["indexedDocuments"] == 2
    assert summary["chunks"] >= 2
    assert matches
    assert matches[0]["type"] == "knowledge"
    assert "README.md" in matches[0]["path"]


def test_rebuild_reports_unreadable_markdown_sources(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / "README.md").mkdir()

    store = RAGStore(root)
    summary = store.rebuild()

    assert summary["indexedDocuments"] == 0
    assert summary["chunks"] == 0
    assert summary["skippedDocuments"] == 1
    assert summary["errors"]
    assert "README.md" in summary["errors"][0]["path"]
