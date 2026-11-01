"""Chinese-aware chunking for retrieval-augmented generation.

Token accounting
----------------
``tiktoken`` is intentionally not a dependency.  :func:`count_tokens` uses a
deterministic CJK-aware proxy: one token per CJK ideograph plus one token per
ASCII alphanumeric word.  It is stable and monotonic, which is all the chunk
budget needs; it is *not* a byte-perfect model of any vendor tokenizer.

Splitting strategy
------------------
1. A page is split into sections at detected headings.
2. Sections are split at sentence boundaries (``。！？；!?;`` and newlines).
3. Sentences are greedily packed up to ``max_tokens``; when a chunk closes the
   trailing sentences worth up to ``overlap_tokens`` are carried into the next
   chunk (unless that would break the token budget).
4. A single sentence larger than ``max_tokens`` is hard-split by characters as
   a documented fallback; sentences are never hard-split otherwise.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.services.parsing import ParsedDocument, ParsedPage

__all__ = ["TextChunk", "chunk_document", "count_tokens"]

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_WORD_RE = re.compile(r"[A-Za-z0-9_]+")
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[。！？；!?;\n])")


@dataclass(frozen=True, slots=True)
class TextChunk:
    """A retrievable slice of a parsed document."""

    chunk_index: int
    content: str
    page: int | None = None
    heading: str | None = None
    token_count: int = 0


def count_tokens(text: str) -> int:
    """Return the deterministic CJK-aware token proxy for ``text``."""

    return len(_CJK_RE.findall(text)) + len(_WORD_RE.findall(text))


def _split_sentences(text: str) -> list[str]:
    sentences = [piece for piece in _SENTENCE_BOUNDARY_RE.split(text) if piece.strip()]
    return sentences


def _hard_split(sentence: str, budget: int) -> list[str]:
    """Fallback split for a single over-budget sentence.

    Because one token is never more than one character under the proxy, slicing
    at ``budget`` characters guarantees every piece stays within the budget.
    """

    budget = max(1, budget)
    return [sentence[start : start + budget] for start in range(0, len(sentence), budget)]


def _pack_sentences(
    sentences: list[str], max_tokens: int, overlap_tokens: int
) -> list[list[str]]:
    chunks: list[list[str]] = []
    window: list[str] = []
    window_tokens = 0
    has_new_content = False

    def flush() -> None:
        if window and has_new_content:
            chunks.append(list(window))

    def carry(trigger_tokens: int) -> None:
        nonlocal window, window_tokens
        selected: list[str] = []
        total = 0
        for sentence in reversed(window):
            sentence_tokens = count_tokens(sentence)
            if total + sentence_tokens > overlap_tokens:
                break
            if total + sentence_tokens + trigger_tokens > max_tokens:
                break
            selected.append(sentence)
            total += sentence_tokens
        selected.reverse()
        window = selected
        window_tokens = total

    for sentence in sentences:
        sentence_tokens = count_tokens(sentence)

        if sentence_tokens > max_tokens:
            flush()
            pieces = _hard_split(sentence, max_tokens)
            for piece in pieces:
                chunks.append([piece])
            window = [pieces[-1]]
            window_tokens = count_tokens(pieces[-1])
            has_new_content = False
            continue

        if window_tokens + sentence_tokens > max_tokens:
            flush()
            carry(sentence_tokens)

        window.append(sentence)
        window_tokens += sentence_tokens
        has_new_content = True

    flush()
    return chunks


def _heading_budget(headings: list[str]) -> dict[str, int]:
    budget: dict[str, int] = {}
    for heading in headings:
        budget[heading] = budget.get(heading, 0) + 1
    return budget


def _split_sections(page: ParsedPage) -> list[tuple[str | None, str]]:
    heading_budget = _heading_budget(page.headings)
    sections: list[tuple[str | None, str]] = []
    current_heading: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        text = "\n".join(current_lines).strip()
        if text:
            sections.append((current_heading, text))

    for line in page.text.splitlines():
        candidate = line.strip()
        if heading_budget.get(candidate, 0) > 0:
            flush()
            heading_budget[candidate] -= 1
            current_heading = candidate
            current_lines = [line]
        else:
            current_lines.append(line)
    flush()
    return sections


def chunk_document(
    doc: ParsedDocument,
    *,
    max_tokens: int = 500,
    overlap_tokens: int = 50,
) -> list[TextChunk]:
    """Split ``doc`` into sentence-aware, token-budgeted chunks."""

    if max_tokens <= 0:
        raise ValueError("max_tokens must be positive")
    if overlap_tokens < 0:
        raise ValueError("overlap_tokens must be non-negative")
    if doc.empty or not doc.pages:
        return []

    chunks: list[TextChunk] = []
    for page in doc.pages:
        if not page.text.strip():
            continue
        for heading, section_text in _split_sections(page):
            sentences = _split_sentences(section_text)
            if not sentences:
                continue
            for piece in _pack_sentences(sentences, max_tokens, overlap_tokens):
                content = "".join(piece).strip()
                if not content:
                    continue
                token_count = count_tokens(content)
                if token_count == 0:
                    continue
                chunks.append(
                    TextChunk(
                        chunk_index=len(chunks),
                        content=content,
                        page=page.page,
                        heading=heading,
                        token_count=token_count,
                    )
                )
    return chunks
