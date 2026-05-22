from typing import Any

from .memory_store import MemoryStore
from .rag_store import RAGStore

CASE_KEYWORDS = [
    "当前",
    "病例",
    "记录",
    "标注",
    "解释",
    "信号质量",
    "ai 结果",
    "ai结果",
    "annotation",
    "case",
    "record",
]
MEMORY_KEYWORDS = ["当前记录", "标注记忆", "病例记忆", "历史标注", "这个病例"]
KNOWLEDGE_KEYWORDS = ["wfdb", "导入", "readme", "spec", "平台", "文件", "如何", "知识库"]


class AssistantService:
    def __init__(self, memory_store: MemoryStore, rag_store: RAGStore):
        self.memory_store = memory_store
        self.rag_store = rag_store

    def record_case_snapshot(self, snapshot: dict[str, Any]) -> dict[str, Any]:
        return self.memory_store.add_case_snapshot(snapshot)

    def rebuild_knowledge(self) -> dict[str, Any]:
        return self.rag_store.rebuild()

    def ask(self, question: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        question_lower = question.lower()
        context = context or {}
        is_case_question = any(kw in question_lower for kw in CASE_KEYWORDS)
        is_memory_question = any(kw in question_lower for kw in MEMORY_KEYWORDS)
        is_knowledge_question = any(kw in question_lower for kw in KNOWLEDGE_KEYWORDS)

        memory_matches = self.memory_store.search(question, context=context, limit=5)
        knowledge_matches = self.rag_store.search(question, limit=5)

        case_answer = (
            self._build_case_answer(context)
            if is_case_question and not is_memory_question and self._has_case_context(context)
            else ""
        )
        if case_answer:
            sources = [self._build_case_source(context)] + knowledge_matches[:3]
            answer = case_answer
            if knowledge_matches and is_knowledge_question:
                best = knowledge_matches[0]
                answer += f"\n\n相关知识库引用：{best.get('title', '')}"
            return {
                "mode": "case",
                "answer": answer,
                "sources": sources,
            }

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
            best = sources[0]
            answer += f"，最相关：{best.get('title', '')}"

        return {
            "mode": mode,
            "answer": answer,
            "sources": sources,
        }

    def _has_case_context(self, context: dict[str, Any]) -> bool:
        return any(
            key in context and context.get(key) not in (None, "", [])
            for key in ["recordId", "leadCount", "annotationCount", "annotations", "aiResults", "signalQuality"]
        )

    def _build_case_source(self, context: dict[str, Any]) -> dict[str, Any]:
        record_id = context.get("recordId") or "当前记录"
        return {
            "type": "case",
            "title": str(record_id),
            "path": "current-case-snapshot",
            "score": 1.0,
            "snippet": f"导联 {context.get('leadCount', 0)}，标注 {context.get('annotationCount', 0)}",
        }

    def _build_case_answer(self, context: dict[str, Any]) -> str:
        record_id = context.get("recordId") or "当前记录"
        primary_lead = context.get("primaryLead") or "未选择"
        lead_count = context.get("leadCount", 0)
        signal_quality = context.get("signalQuality", "未知")
        annotations = context.get("annotations") or []
        annotation_count = int(context.get("annotationCount") or len(annotations))
        ai_results = context.get("aiResults") or []

        type_counts: dict[str, int] = {}
        manual_count = 0
        for annotation in annotations:
            annotation_type = str(annotation.get("type") or "未知")
            type_counts[annotation_type] = type_counts.get(annotation_type, 0) + 1
            if annotation.get("manual"):
                manual_count += 1
        automatic_count = max(len(annotations) - manual_count, 0)

        if type_counts:
            type_summary = "，".join(f"{name} {count} 个" for name, count in sorted(type_counts.items()))
        else:
            type_summary = "暂无具体标注类型"

        answer_parts = [
            f"当前记录 {record_id}：主分析导联为 {primary_lead}，共 {lead_count} 条导联。",
            f"信号质量 {signal_quality}%，当前共有 {annotation_count} 个标注。",
            f"标注类型分布：{type_summary}。",
        ]

        if annotations:
            answer_parts.append(f"标注来源：手工 {manual_count} 个，自动 {automatic_count} 个。")

        if ai_results:
            top_results = sorted(
                ai_results,
                key=lambda item: float(item.get("probability") or 0),
                reverse=True,
            )[:3]
            formatted_results = []
            for result in top_results:
                probability = float(result.get("probability") or 0)
                display_probability = probability * 100 if probability <= 1 else probability
                formatted_results.append(f"{result.get('className', '未知')} {display_probability:.1f}%")
            answer_parts.append("AI 结果参考：" + "，".join(formatted_results) + "。")

        answer_parts.append("这些内容仅用于标注工作流参考，不能替代临床诊断。")
        return "\n".join(answer_parts)
