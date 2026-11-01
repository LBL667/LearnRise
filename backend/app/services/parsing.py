"""Document parsing for the ingestion pipeline.

The parser turns an uploaded byte blob into a small, provider-free structure
(:class:`ParsedDocument`) that the chunker can consume.  Supported formats are
PDF, DOCX, plain text / markdown and images (through the ``OCRProvider`` port).

Design notes
------------
* PDF pages keep their 1-based page number, DOCX and plain text are treated as a
  single page (``page=1``) because the formats do not carry a pagination that is
  stable across viewers.
* Heading detection is heuristic: a short line (``< 40`` chars) that either
  starts with a Chinese chapter marker (``第一章``/``第2节``), a numeric outline
  marker (``1.2.3 ``) or a markdown ``#`` run.
* Repeated headers/footers are removed when the same short line occupies the
  same relative position (top 2 / bottom 2 lines) on at least three pages.
* OCR is never implemented here; callers must pass an ``OCRProvider``.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf as fitz
from docx import Document as DocxDocument

from app.ports.ocr import OCRProvider

__all__ = ["ParsedDocument", "ParsedPage", "parse_document"]

_HEADING_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千]+[章节]|[0-9]+(?:\.[0-9]+)*\s|#{1,6}\s)"
)
_HEADER_MAX_LEN = 80
_HEADING_MAX_LEN = 40
_HEADER_SAMPLE = 2
_REPEAT_PAGES = 3

_PDF_CONTENT_TYPES = {"application/pdf"}
_DOCX_CONTENT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_TEXT_CONTENT_TYPES = {"text/plain", "text/markdown"}
_IMAGE_CONTENT_TYPES = {"image/png", "image/jpeg", "image/jpg"}

_EXTENSION_KINDS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".txt": "text",
    ".md": "text",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
}


@dataclass(frozen=True, slots=True)
class ParsedPage:
    """Text extracted from a single page together with its headings."""

    page: int
    text: str
    headings: list[str]


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    """Whole-document parse result."""

    pages: list[ParsedPage]
    empty: bool


def _normalise_content_type(content_type: str) -> str:
    return content_type.split(";", 1)[0].strip().lower()


def _classify(content_type: str, extension: str) -> str | None:
    if content_type in _PDF_CONTENT_TYPES:
        return "pdf"
    if content_type in _DOCX_CONTENT_TYPES:
        return "docx"
    if content_type in _TEXT_CONTENT_TYPES:
        return "text"
    if content_type in _IMAGE_CONTENT_TYPES:
        return "image"
    return _EXTENSION_KINDS.get(extension)


def _is_heading(line: str) -> bool:
    candidate = line.strip()
    if not candidate or len(candidate) >= _HEADING_MAX_LEN:
        return False
    return _HEADING_RE.match(candidate) is not None


def _detect_headings(lines: list[str]) -> list[str]:
    return [line.strip() for line in lines if _is_heading(line)]


def _strip_repeated_headers(pages: list[list[str]]) -> list[list[str]]:
    """Drop short lines repeated in the same position on >=3 pages.

    Relative positions are the first two and the last two lines of each page,
    which is where running headers/footers live in practice.
    """

    if len(pages) < _REPEAT_PAGES:
        return pages

    occurrences: dict[tuple[str, str, int], list[tuple[int, int]]] = {}
    for page_index, lines in enumerate(pages):
        seen: set[tuple[str, str, int]] = set()
        count = len(lines)
        for offset in range(min(_HEADER_SAMPLE, count)):
            for label, line_index in (
                ("top", offset),
                ("bottom", count - 1 - offset),
            ):
                normalised = lines[line_index].strip()
                if not normalised or len(normalised) >= _HEADER_MAX_LEN:
                    continue
                key = (normalised, label, offset)
                if key in seen:
                    continue
                seen.add(key)
                occurrences.setdefault(key, []).append((page_index, line_index))

    dropped: set[tuple[int, int]] = set()
    for entries in occurrences.values():
        pages_affected = {page_index for page_index, _ in entries}
        if len(pages_affected) >= _REPEAT_PAGES:
            dropped.update(entries)

    if not dropped:
        return pages

    cleaned: list[list[str]] = []
    for page_index, lines in enumerate(pages):
        kept = [
            line
            for line_index, line in enumerate(lines)
            if (page_index, line_index) not in dropped
        ]
        cleaned.append(kept)
    return cleaned


def _parse_pdf(data: bytes) -> list[ParsedPage]:
    try:
        document = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:  # pragma: no cover - depends on pymupdf internals
        raise ValueError("empty document") from exc

    try:
        raw_pages = [
            document.load_page(index).get_text("text").splitlines()
            for index in range(document.page_count)
        ]
    finally:
        document.close()

    cleaned_pages = _strip_repeated_headers(raw_pages)
    parsed: list[ParsedPage] = []
    for index, lines in enumerate(cleaned_pages, start=1):
        parsed.append(
            ParsedPage(
                page=index,
                text="\n".join(lines).strip(),
                headings=_detect_headings(lines),
            )
        )
    return parsed


def _parse_docx(data: bytes) -> list[ParsedPage]:
    try:
        document = DocxDocument(io.BytesIO(data))
    except Exception as exc:  # pragma: no cover - depends on python-docx internals
        raise ValueError("empty document") from exc

    lines: list[str] = []
    headings: list[str] = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style_name = paragraph.style.name if paragraph.style is not None else ""
        if style_name.startswith("Heading"):
            headings.append(text)
        lines.append(text)

    # DOCX has no reliable pagination; everything is reported as page 1.
    return [ParsedPage(page=1, text="\n".join(lines).strip(), headings=headings)]


def _parse_text(data: bytes) -> list[ParsedPage]:
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    return [ParsedPage(page=1, text=text.strip(), headings=_detect_headings(lines))]


def _parse_image(data: bytes, content_type: str, ocr: OCRProvider | None) -> list[ParsedPage]:
    if ocr is None:
        raise ValueError("OCR provider required for image input")

    result = ocr.recognize(data, content_type=content_type or "image/jpeg")
    lines = [block.text.strip() for block in result.blocks if block.text.strip()]
    return [ParsedPage(page=1, text="\n".join(lines), headings=[])]


def parse_document(
    data: bytes,
    *,
    content_type: str,
    filename: str = "",
    ocr: OCRProvider | None = None,
) -> ParsedDocument:
    """Parse ``data`` into pages of text.

    Raises:
        ValueError: for empty/corrupt input, unsupported content types and
            images when no OCR provider is supplied.
    """

    if not data:
        raise ValueError("empty document")

    normalised_type = _normalise_content_type(content_type)
    extension = Path(filename).suffix.lower()
    kind = _classify(normalised_type, extension)

    if kind is None:
        raise ValueError(f"unsupported content type: {content_type}")

    if kind == "pdf":
        pages = _parse_pdf(data)
    elif kind == "docx":
        pages = _parse_docx(data)
    elif kind == "text":
        pages = _parse_text(data)
    else:
        pages = _parse_image(data, normalised_type or "image/jpeg", ocr)

    if not any(page.text.strip() for page in pages):
        return ParsedDocument(pages=[], empty=True)
    return ParsedDocument(pages=pages, empty=False)
