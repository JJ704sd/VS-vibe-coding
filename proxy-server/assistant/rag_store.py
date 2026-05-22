from pathlib import Path
from typing import Any

from assistant.text_index import TextChunk, chunk_markdown, rank_chunks


FALLBACK_KNOWLEDGE = """# ECG Assistant Knowledge Base

## Lightweight Assistant Scope

The assistant can answer questions about the current ECG case snapshot, retrieve project knowledge, and explain current annotations. It is read-only and does not modify annotations, run inference, or export files automatically.

## Case Context

Current-case answers can reference patient id, record id, lead count, primary lead, signal quality, annotation count, annotation types, manual versus automatic annotations, and AI result probabilities.

## WFDB Import

WFDB records are imported as paired `.hea` and `.dat` files. Keep both files from the same record together, then import them from the annotation studio so the parser can build ECG leads for review.

## Clinical Safety

Assistant responses are workflow references only. They cannot replace clinician review or formal diagnosis.
"""


class RAGStore:
    def __init__(self, repo_root: Path | str):
        self.repo_root = Path(repo_root)
        self.chunks: list[TextChunk] = []
        self._indexed = False

    def rebuild(self) -> dict[str, Any]:
        self.chunks = []
        doc_count = 0
        errors: list[dict[str, str]] = []

        for name in ["README.md", "SPEC.md"]:
            file_path = self.repo_root / name
            if file_path.exists():
                try:
                    content = file_path.read_text(encoding="utf-8")
                    self.chunks.extend(chunk_markdown(str(file_path), content))
                    doc_count += 1
                except Exception as exc:
                    errors.append({"path": str(file_path), "error": str(exc)})

        docs_dir = self.repo_root / "docs"
        if docs_dir.exists() and docs_dir.is_dir():
            for md_file in docs_dir.rglob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    self.chunks.extend(chunk_markdown(str(md_file), content))
                    doc_count += 1
                except Exception as exc:
                    errors.append({"path": str(md_file), "error": str(exc)})

        if doc_count == 0 and not errors:
            fallback_file = docs_dir / "assistant" / "knowledge-base.md"
            fallback_file.parent.mkdir(parents=True, exist_ok=True)
            if not fallback_file.exists():
                fallback_file.write_text(FALLBACK_KNOWLEDGE, encoding="utf-8")
            content = fallback_file.read_text(encoding="utf-8")
            self.chunks.extend(chunk_markdown(str(fallback_file), content))
            doc_count += 1

        self._indexed = True
        return {
            "ok": len(errors) == 0,
            "indexedDocuments": doc_count,
            "chunks": len(self.chunks),
            "skippedDocuments": len(errors),
            "errors": errors,
        }

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        if not self._indexed:
            self.rebuild()
        if not self.chunks:
            return []
        results = rank_chunks(query, self.chunks, limit)
        for r in results:
            r["type"] = "knowledge"
        return results
