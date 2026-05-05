import re
from dataclasses import dataclass


@dataclass
class TextChunk:
    id: str
    title: str
    path: str
    text: str


def tokenize(text: str) -> list[str]:
    text_lower = text.lower()
    tokens = []
    i = 0
    while i < len(text_lower):
        ch = text_lower[i]
        if '\u4e00' <= ch <= '\u9fff':
            tokens.append(ch)
            i += 1
        elif ch.isalnum() or ch == '_':
            j = i
            while j < len(text_lower) and (text_lower[j].isalnum() or text_lower[j] == '_'):
                j += 1
            tokens.append(text_lower[i:j])
            i = j
        else:
            i += 1
    return tokens


def chunk_markdown(path: str, content: str, max_chars: int = 900) -> list[TextChunk]:
    chunks = []
    section_pattern = re.compile(r'^#{1,6}\s+(.+)$', re.MULTILINE)
    lines = content.split('\n')
    current_section = ""
    current_text_lines = []
    chunk_id = 0

    def flush():
        nonlocal chunk_id, current_text_lines, current_section
        if current_text_lines:
            text = '\n'.join(current_text_lines).strip()
            if text:
                chunks.append(TextChunk(
                    id=f"{path}:{chunk_id}",
                    title=current_section or path,
                    path=path,
                    text=text
                ))
                chunk_id += 1
            current_text_lines = []

    for line in lines:
        m = section_pattern.match(line)
        if m:
            flush()
            current_section = m.group(1).strip()
            current_text_lines = [line]
        else:
            current_text_lines.append(line)
            if len('\n'.join(current_text_lines)) > max_chars:
                flush()
                current_text_lines = [line]

    flush()
    return chunks


def score_text(query: str, text: str) -> float:
    query_tokens = tokenize(query)
    text_tokens = tokenize(text)
    if not query_tokens:
        return 0.0
    text_token_set = set(text_tokens)
    matches = sum(1 for t in query_tokens if t in text_token_set)
    score = matches / len(query_tokens)
    return score


def rank_chunks(query: str, chunks: list[TextChunk], limit: int = 5) -> list[dict]:
    scored = []
    for chunk in chunks:
        score = score_text(query, chunk.text)
        if score > 0:
            query_tokens = set(tokenize(query))
            matched_tokens = [t for t in tokenize(chunk.text) if t in query_tokens]
            snippet = ' '.join(matched_tokens[:10])
            scored.append({
                "title": chunk.title,
                "path": chunk.path,
                "score": score,
                "snippet": snippet
            })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:limit]
