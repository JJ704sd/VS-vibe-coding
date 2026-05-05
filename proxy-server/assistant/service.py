from typing import Any

from .memory_store import MemoryStore
from .rag_store import RAGStore

MEMORY_KEYWORDS = ["当前记录", "标注记忆", "病例记忆", "历史标注", "这个病例"]
KNOWLEDGE_KEYWORDS = ["WFDB", "导入", "README", "SPEC", "平台", "文件", "如何"]


class AssistantService:
    def __init__(self, memory_store: MemoryStore, rag_store: RAGStore):
        self.memory_store = memory_store
        self.rag_store = rag_store

    def record_case_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        return self.memory_store.add_case_snapshot(snapshot)

    def rebuild_knowledge(self) -> dict[str, int]:
        return self.rag_store.rebuild()

    def ask(self, question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        question_lower = question.lower()
        is_memory_question = any(kw in question_lower for kw in MEMORY_KEYWORDS)
        is_knowledge_question = any(kw in question_lower for kw in KNOWLEDGE_KEYWORDS)

        memory_matches = self.memory_store.search(question, context=context, limit=5)
        knowledge_matches = self.rag_store.search(question, limit=5)

        sources = []
        mode = "knowledge"

        if is_memory_question or (memory_matches and (not is_knowledge_question or not knowledge_matches)):
            mode = "memory"
            sources = memory_matches
        else:
            sources = knowledge_matches

        match_count = len(sources)
        if match_count == 0:
            answer = "辅助参考：未找到相关上下文。请尝试重建知识库或记录当前病例。"
        else:
            answer = f"辅助参考：找到 {match_count} 条相关" + (
                "病例记忆" if mode == "memory" else "知识引用"
            )
            if sources:
                best = sources[0]
                answer += f"，最相关：{best.get('title', '')}"

        return {
            "mode": mode,
            "answer": answer,
            "sources": sources,
        }
