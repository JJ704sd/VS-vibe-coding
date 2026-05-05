import re
from pathlib import Path
from typing import Any

from assistant.text_index import TextChunk, chunk_markdown, rank_chunks


class RAGStore:
    def __init__(self, repo_root: Path | str):
        self.repo_root = Path(repo_root)
        self.chunks: list[TextChunk] = []
        self._indexed = False

    def rebuild(self) -> dict[str, int]:
        self.chunks = []
        doc_count = 0

        for name in ["README.md", "SPEC.md"]:
            file_path = self.repo_root / name
            if file_path.exists():
                try:
                    content = file_path.read_text(encoding="utf-8")
                    self.chunks.extend(chunk_markdown(str(file_path), content))
                    doc_count += 1
                except Exception:
                    pass

        docs_dir = self.repo_root / "docs"
        if docs_dir.exists() and docs_dir.is_dir():
            for md_file in docs_dir.rglob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    self.chunks.extend(chunk_markdown(str(md_file), content))
                    doc_count += 1
                except Exception:
                    pass

        self._indexed = True
        return {"indexedDocuments": doc_count, "chunks": len(self.chunks)}

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        if not self._indexed:
            self.rebuild()
        if not self.chunks:
            return []
        results = rank_chunks(query, self.chunks, limit)
        for r in results:
            r["type"] = "knowledge"
        return results
