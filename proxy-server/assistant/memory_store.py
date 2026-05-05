import json
from pathlib import Path
from typing import Any


class MemoryStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._save({"memories": []})

    def add_case_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        data = self._load()
        memories = data.get("memories", [])
        record_id = snapshot.get("recordId", "")
        import time
        memory_id = f"case_{record_id}_{int(time.time() * 1000)}"
        from datetime import datetime, timezone
        stored_at = datetime.now(timezone.utc).isoformat()
        entry = {
            "id": memory_id,
            "storedAt": stored_at,
            "patientId": snapshot.get("patientId", ""),
            "recordId": record_id,
            "snapshot": snapshot,
            "text": self._build_text(snapshot),
        }
        memories.append(entry)
        data["memories"] = memories
        self._save(data)
        return {"ok": True, "memoryId": memory_id, "storedAt": stored_at}

    def search(self, query: str, context: dict[str, Any] | None = None, limit: int = 5) -> list[dict[str, Any]]:
        data = self._load()
        memories = data.get("memories", [])
        results = []

        for mem in memories:
            score = 0.0
            text = mem.get("text", "")
            query_lower = query.lower()
            query_tokens = [t for t in query_lower.split() if t]
            text_lower = text.lower()
            if query_lower in text_lower:
                score += 0.5
            for token in query_tokens:
                if token in text_lower:
                    score += 0.1

            if context:
                if mem.get("patientId") == context.get("patientId"):
                    score += 0.3
                if mem.get("recordId") == context.get("recordId"):
                    score += 0.3

            if score > 0:
                snippet_tokens = [t for t in query_lower.split() if t]
                snippet = " ".join(snippet_tokens[:6])
                results.append({
                    "type": "memory",
                    "title": mem.get("recordId", ""),
                    "path": "assistant_memory.json",
                    "score": min(score, 1.0),
                    "snippet": snippet,
                })

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:limit]

    def forget(self, patient_id: str | None = None, record_id: str | None = None) -> int:
        data = self._load()
        memories = data.get("memories", [])
        original_count = len(memories)
        if patient_id:
            memories = [m for m in memories if m.get("patientId") != patient_id]
        if record_id:
            memories = [m for m in memories if m.get("recordId") != record_id]
        removed = original_count - len(memories)
        data["memories"] = memories
        self._save(data)
        return removed

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"memories": []}
        with open(self.path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _save(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _build_text(self, snapshot: dict[str, Any]) -> str:
        parts = [
            snapshot.get("patientId", ""),
            snapshot.get("recordId", ""),
            snapshot.get("primaryLead", ""),
        ]
        annotations = snapshot.get("annotations", [])
        if annotations:
            parts.append(f"annotationCount {len(annotations)}")
            for ann in annotations:
                parts.append(ann.get("type", ""))
        ai_results = snapshot.get("aiResults", [])
        for r in ai_results:
            parts.append(r.get("className", ""))
        parts.append(str(snapshot.get("signalQuality", "")))
        return " ".join(filter(None, parts))
