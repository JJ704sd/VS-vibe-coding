import logging
from pathlib import Path
from typing import Any, Optional

from assistant.text_index import TextChunk, chunk_markdown, rank_chunks

log = logging.getLogger("assistant.rag_store")


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

# Default fallback directory lives next to the sidecar (proxy-server/.data/assistant/)
# so the knowledge base never has to be written into the project repo.
DEFAULT_FALLBACK_DIR = Path(__file__).resolve().parent.parent / ".data" / "assistant"


def _safe_error(file_path: Path, exc: Exception) -> dict[str, str]:
    """Build a frontend-safe error entry. C-07: never leak absolute paths.

    The full path and original message are still emitted to the sidecar log
    so operators can debug, but the JSON response only carries the basename
    and exception class name.
    """
    log.warning("RAG rebuild skipped %s: %s", file_path, exc)
    return {
        "filename": file_path.name,
        "code": exc.__class__.__name__,
    }


class RAGStore:
    def __init__(
        self,
        repo_root: Path | str,
        fallback_dir: Optional[Path | str] = None,
    ):
        self.repo_root = Path(repo_root)
        self.fallback_dir = Path(fallback_dir) if fallback_dir is not None else DEFAULT_FALLBACK_DIR
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
                    errors.append(_safe_error(file_path, exc))

        docs_dir = self.repo_root / "docs"
        if docs_dir.exists() and docs_dir.is_dir():
            for md_file in docs_dir.rglob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    self.chunks.extend(chunk_markdown(str(md_file), content))
                    doc_count += 1
                except Exception as exc:
                    errors.append(_safe_error(md_file, exc))

        if doc_count == 0 and not errors:
            # C-06: never write the fallback into the project repo. The sidecar
            # data directory lives next to the proxy-server (not under the
            # checkout) so a long-running process can't pollute `docs/`.
            fallback_file = self.fallback_dir / "knowledge-base.md"
            try:
                fallback_file.parent.mkdir(parents=True, exist_ok=True)
                if not fallback_file.exists():
                    fallback_file.write_text(FALLBACK_KNOWLEDGE, encoding="utf-8")
                content = fallback_file.read_text(encoding="utf-8")
                self.chunks.extend(chunk_markdown(str(fallback_file), content))
                doc_count += 1
            except Exception as exc:
                errors.append(_safe_error(fallback_file, exc))

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
