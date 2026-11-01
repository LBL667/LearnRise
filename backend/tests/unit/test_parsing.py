import io

import pymupdf as fitz
import pytest
from docx import Document as DocxDocument

from app.ports.types import OCRBlock, OCRResult
from app.services.parsing import ParsedDocument, ParsedPage, parse_document


def _pdf(pages: list[list[str]]) -> bytes:
    document = fitz.open()
    try:
        for lines in pages:
            page = document.new_page()
            y = 72
            for line in lines:
                page.insert_text((72, y), line, fontname="china-s", fontsize=12)
                y += 20
        return document.tobytes()
    finally:
        document.close()


def _docx() -> bytes:
    document = DocxDocument()
    document.add_heading("第一章 总论", level=1)
    document.add_paragraph("第一段正文内容。")
    document.add_heading("1.1 背景", level=2)
    document.add_paragraph("第二段正文内容。")
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


class FakeOCR:
    def __init__(self, blocks: list[OCRBlock]) -> None:
        self.blocks = blocks
        self.calls: list[tuple[bytes, str]] = []

    def recognize(self, image: bytes, *, content_type: str = "image/jpeg") -> OCRResult:
        self.calls.append((image, content_type))
        return OCRResult(blocks=self.blocks)


def test_pdf_parses_each_page_with_page_numbers() -> None:
    data = _pdf([["第一页的正文内容。"], ["第二页的正文内容。"]])
    parsed = parse_document(data, content_type="application/pdf")

    assert isinstance(parsed, ParsedDocument)
    assert parsed.empty is False
    assert [page.page for page in parsed.pages] == [1, 2]
    assert "第一页的正文内容" in parsed.pages[0].text
    assert "第二页的正文内容" in parsed.pages[1].text


def test_pdf_dispatched_by_extension_when_content_type_is_generic() -> None:
    data = _pdf([["按文件名解析的正文。"]])
    parsed = parse_document(data, content_type="application/octet-stream", filename="notes.pdf")

    assert parsed.empty is False
    assert "按文件名解析的正文" in parsed.pages[0].text


def test_pdf_detects_chinese_and_numeric_headings() -> None:
    data = _pdf([["第一章 总论", "引言正文内容。", "1.1 背景", "背景正文内容。"]])
    parsed = parse_document(data, content_type="application/pdf")

    headings = parsed.pages[0].headings
    assert "第一章 总论" in headings
    assert "1.1 背景" in headings


def test_pdf_strips_repeated_headers_across_pages() -> None:
    data = _pdf(
        [
            ["课程讲义", "第一页正文内容。"],
            ["课程讲义", "第二页正文内容。"],
            ["课程讲义", "第三页正文内容。"],
        ]
    )
    parsed = parse_document(data, content_type="application/pdf")

    assert parsed.empty is False
    assert len(parsed.pages) == 3
    assert all("课程讲义" not in page.text for page in parsed.pages)
    for index, page in enumerate(parsed.pages, start=1):
        assert f"第{'一二三'[index - 1]}页正文内容" in page.text


def test_pdf_without_text_is_empty_document() -> None:
    document = fitz.open()
    try:
        document.new_page()
        data = document.tobytes()
    finally:
        document.close()

    parsed = parse_document(data, content_type="application/pdf")

    assert parsed.pages == []
    assert parsed.empty is True


def test_docx_heading_styles_become_headings_on_page_one() -> None:
    parsed = parse_document(
        _docx(),
        content_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
    )

    assert parsed.empty is False
    assert len(parsed.pages) == 1
    page = parsed.pages[0]
    assert page.page == 1
    assert page.headings == ["第一章 总论", "1.1 背景"]
    assert "第一段正文内容" in page.text
    assert "第二段正文内容" in page.text


def test_plain_text_is_single_page() -> None:
    parsed = parse_document(b"First line.\nSecond line.", content_type="text/plain")

    assert parsed.empty is False
    assert len(parsed.pages) == 1
    assert parsed.pages[0].page == 1
    assert "First line." in parsed.pages[0].text


def test_utf8_replacement_on_invalid_bytes() -> None:
    parsed = parse_document(b"valid \xff bytes", content_type="text/plain")

    assert parsed.empty is False
    assert "valid" in parsed.pages[0].text
    assert "\ufffd" in parsed.pages[0].text


def test_markdown_detected_by_extension_and_heading() -> None:
    parsed = parse_document(
        "# 学习笔记\n这是正文内容。".encode(),
        content_type="application/octet-stream",
        filename="notes.md",
    )

    assert parsed.pages[0].headings == ["# 学习笔记"]


def test_whitespace_only_text_is_empty_document() -> None:
    parsed = parse_document(b"   \n\t\n  ", content_type="text/plain")

    assert parsed.pages == []
    assert parsed.empty is True


def test_image_uses_ocr_provider() -> None:
    ocr = FakeOCR(
        [
            OCRBlock(text="第一行识别文字", confidence=0.9),
            OCRBlock(text="第二行识别文字", confidence=0.8),
        ]
    )
    payload = b"\x89PNG fake image bytes"

    parsed = parse_document(payload, content_type="image/png", ocr=ocr)

    assert parsed.empty is False
    assert parsed.pages[0].page == 1
    assert parsed.pages[0].text == "第一行识别文字\n第二行识别文字"
    assert parsed.pages[0].headings == []
    assert ocr.calls == [(payload, "image/png")]


def test_image_without_ocr_raises() -> None:
    with pytest.raises(ValueError, match="OCR provider required for image input"):
        parse_document(b"\x89PNG fake", content_type="image/png")


def test_image_with_no_recognised_blocks_is_empty() -> None:
    parsed = parse_document(b"\xff\xd8 fake", content_type="image/jpeg", ocr=FakeOCR([]))

    assert parsed.pages == []
    assert parsed.empty is True


def test_unsupported_content_type_raises() -> None:
    with pytest.raises(ValueError, match="unsupported content type: application/zip"):
        parse_document(b"PK\x03\x04", content_type="application/zip", filename="a.zip")


@pytest.mark.parametrize("content_type", ["application/pdf", "text/plain", "image/png"])
def test_zero_byte_input_raises_empty_document(content_type: str) -> None:
    with pytest.raises(ValueError, match="empty document"):
        parse_document(b"", content_type=content_type)


def test_content_type_parameters_are_ignored() -> None:
    parsed = parse_document(b"hello", content_type="text/plain; charset=utf-8")

    assert parsed.pages[0].text == "hello"


def test_parsed_page_dataclass_shape() -> None:
    page = ParsedPage(page=3, text="正文", headings=["标题"])

    assert page.page == 3
    assert page.text == "正文"
    assert page.headings == ["标题"]
