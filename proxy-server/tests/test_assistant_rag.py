import logging
from pathlib import Path

import pytest

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
    """C-07: errors surfaced to the API caller only carry filename + the
    exception class name, never the absolute path or the raw message."""
    root = tmp_path / "repo"
    root.mkdir()
    # Replace README.md with a directory to deterministically force a read
    # failure (IsADirectoryError) on every platform — chmod semantics are
    # not portable to Windows or to a root user.
    (root / "README.md").mkdir()

    store = RAGStore(root)
    summary = store.rebuild()

    assert summary["indexedDocuments"] == 0
    assert summary["chunks"] == 0
    assert summary["skippedDocuments"] == 1
    assert summary["errors"]

    error = summary["errors"][0]
    assert set(error.keys()) == {"filename", "code"}
    assert error["filename"] == "README.md"
    # The response must not leak the operator-facing detail: the absolute
    # path is the most sensitive piece, the raw exception message is next.
    # The exception class name (`code`) is allowed because it's already a
    # coarse signal the frontend can switch on.
    serialized = repr(summary["errors"])
    assert str(root) not in serialized, (
        f"error response leaked absolute path: {serialized!r}"
    )


def test_rebuild_logs_full_path_for_operators_but_response_is_sanitized(tmp_path, caplog):
    """C-07: the full path stays in the sidecar log for operators, but the
    JSON response stays sanitized. The two surfaces must remain decoupled
    so a frontend caller can never enumerate the repo layout from an
    error message."""
    root = tmp_path / "repo"
    root.mkdir()
    readme = root / "README.md"
    readme.mkdir()  # forces read_text() to raise IsADirectoryError

    store = RAGStore(root)
    with caplog.at_level(logging.WARNING, logger="assistant.rag_store"):
        summary = store.rebuild()

    error = summary["errors"][0]
    assert error["filename"] == "README.md"
    # The full absolute path must appear in the operator log …
    assert any(
        str(readme) in record.getMessage() for record in caplog.records
    ), f"expected full path in operator log, got: {[r.getMessage() for r in caplog.records]}"
    # … and must NOT appear in the response payload.
    assert str(readme) not in repr(summary["errors"])


def test_rebuild_fallback_writes_to_sidecar_data_dir_not_repo(tmp_path):
    """C-06: when no docs are present the fallback knowledge base used to
    land in `<repo>/docs/assistant/knowledge-base.md`, which is inside the
    working tree. It now lands in the sidecar data directory which lives
    next to the proxy-server (not under the checkout)."""
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    fallback_dir = tmp_path / "sidecar-data" / "assistant"

    store = RAGStore(repo_root, fallback_dir=fallback_dir)
    summary = store.rebuild()

    assert summary["indexedDocuments"] == 1
    assert (fallback_dir / "knowledge-base.md").exists()
    # The repo working tree must stay clean.
    assert not (repo_root / "docs").exists()
    assert not (repo_root / "docs" / "assistant").exists()
    assert not (repo_root / "docs" / "assistant" / "knowledge-base.md").exists()


def test_rebuild_fallback_default_dir_does_not_touch_repo_tree(tmp_path, monkeypatch):
    """C-06: the default fallback directory is computed relative to the
    rag_store module file, not the repo_root. We patch DEFAULT_FALLBACK_DIR
    to a tmp_path to keep this test hermetic, then assert the repo stays
    clean and the fallback file lands where DEFAULT_FALLBACK_DIR points.
    """
    from assistant import rag_store

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    fallback_dir = tmp_path / "default-sidecar"
    fallback_dir.mkdir()
    monkeypatch.setattr(rag_store, "DEFAULT_FALLBACK_DIR", fallback_dir)

    store = RAGStore(repo_root)
    summary = store.rebuild()

    assert summary["indexedDocuments"] == 1
    assert (fallback_dir / "knowledge-base.md").exists()
    assert not (repo_root / "docs").exists()


def test_rebuild_does_not_create_repo_files_when_fallback_write_fails(tmp_path, monkeypatch):
    """C-06 + C-07: if writing the fallback file itself fails (read-only
    sidecar data dir, full disk, …) the rebuild must report a sanitized
    error and must NOT create any file under repo_root."""
    from assistant import rag_store

    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    fallback_dir = tmp_path / "sidecar-data"
    fallback_dir.mkdir()

    def boom(self, *args, **kwargs):  # noqa: ANN001,ANN002,ANN003
        raise OSError("disk full")

    monkeypatch.setattr(rag_store.Path, "write_text", boom)

    store = RAGStore(repo_root, fallback_dir=fallback_dir)
    summary = store.rebuild()

    assert summary["indexedDocuments"] == 0
    assert summary["skippedDocuments"] == 1
    assert summary["errors"][0]["filename"] == "knowledge-base.md"
    assert summary["errors"][0]["code"] == "OSError"
    assert not (repo_root / "docs").exists()
