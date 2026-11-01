import pytest

from app.services.chunking import TextChunk, chunk_document, count_tokens
from app.services.parsing import ParsedDocument, ParsedPage, parse_document


def _page(text: str, *, page: int = 1, headings: list[str] | None = None) -> ParsedPage:
    return ParsedPage(page=page, text=text, headings=headings or [])


def _document(*pages: ParsedPage) -> ParsedDocument:
    return ParsedDocument(pages=list(pages), empty=False)


def test_count_tokens_counts_cjk_and_ascii_words() -> None:
    assert count_tokens("") == 0
    assert count_tokens("你好世界") == 4
    assert count_tokens("hello world") == 2
    assert count_tokens("你好 hello 世界") == 5


def test_count_tokens_is_monotonic() -> None:
    assert count_tokens("你好") <= count_tokens("你好世界")
    assert count_tokens("a b") <= count_tokens("a b c")
    assert count_tokens("abc") <= count_tokens("abc def")


def test_count_tokens_ignores_punctuation() -> None:
    assert count_tokens("甲甲甲甲。") == 4


def test_empty_document_returns_no_chunks() -> None:
    assert chunk_document(ParsedDocument(pages=[], empty=True)) == []


def test_blank_parsed_document_returns_no_chunks() -> None:
    parsed = parse_document(b"   \n", content_type="text/plain")

    assert chunk_document(parsed) == []


def test_short_document_produces_one_chunk_with_metadata() -> None:
    chunks = chunk_document(_document(_page("这是第一句。这是第二句。")))

    assert len(chunks) == 1
    chunk = chunks[0]
    assert isinstance(chunk, TextChunk)
    assert chunk.chunk_index == 0
    assert chunk.page == 1
    assert chunk.heading is None
    assert "这是第一句。" in chunk.content
    assert "这是第二句。" in chunk.content
    assert chunk.token_count == count_tokens(chunk.content)


def test_chunks_never_exceed_budget_over_long_text() -> None:
    text = "".join(f"这是第{index}句测试内容，包含标点。" for index in range(1000))

    chunks = chunk_document(_document(_page(text)))

    assert len(chunks) > 1
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert all(chunk.token_count <= 600 for chunk in chunks)
    assert all(chunk.content.endswith("。") for chunk in chunks)


def test_chinese_punctuation_is_respected() -> None:
    sentences = [f"{'甲乙丙丁戊己'}{index}。" for index in range(6)]
    text = "".join(sentences)

    chunks = chunk_document(_document(_page(text)), max_tokens=20, overlap_tokens=5)

    assert len(chunks) > 1
    assert all(chunk.content.endswith("。") for chunk in chunks)


def test_overlap_repeats_trailing_sentences() -> None:
    text = "甲甲甲甲。乙乙乙乙。丙丙丙丙。丁丁丁丁。"

    chunks = chunk_document(_document(_page(text)), max_tokens=8, overlap_tokens=4)

    assert [chunk.content for chunk in chunks] == [
        "甲甲甲甲。乙乙乙乙。",
        "乙乙乙乙。丙丙丙丙。",
        "丙丙丙丙。丁丁丁丁。",
    ]
    assert all(chunk.token_count <= 8 for chunk in chunks)


def test_oversized_sentence_is_hard_split() -> None:
    text = "超" * 1500

    chunks = chunk_document(_document(_page(text)), max_tokens=100, overlap_tokens=10)

    assert len(chunks) == 15
    assert all(chunk.token_count <= 100 for chunk in chunks)
    assert "".join(chunk.content for chunk in chunks) == text


def test_page_attribution() -> None:
    document = _document(
        _page("第一页的内容。", page=1),
        _page("第二页的内容。", page=2),
    )

    chunks = chunk_document(document)

    assert [chunk.page for chunk in chunks] == [1, 2]
    assert [chunk.chunk_index for chunk in chunks] == [0, 1]


def test_heading_attribution_and_section_split() -> None:
    document = _document(
        _page(
            "第一章 总论\n第一章正文。\n1.1 背景\n背景正文。",
            headings=["第一章 总论", "1.1 背景"],
        )
    )

    chunks = chunk_document(document)

    assert [chunk.heading for chunk in chunks] == ["第一章 总论", "1.1 背景"]
    assert "第一章正文" in chunks[0].content
    assert "背景正文" in chunks[1].content
    assert chunks[0].content.startswith("第一章 总论")
    assert chunks[1].content.startswith("1.1 背景")


def test_blank_pages_are_skipped() -> None:
    document = _document(_page(""), _page("真实内容。", page=2))

    chunks = chunk_document(document)

    assert len(chunks) == 1
    assert chunks[0].page == 2
    assert chunks[0].chunk_index == 0


def test_custom_budgets_are_honoured() -> None:
    text = "".join(f"句子{index}。" for index in range(50))

    chunks = chunk_document(_document(_page(text)), max_tokens=10, overlap_tokens=2)

    assert all(chunk.token_count <= 10 for chunk in chunks)
    assert all(chunk.token_count > 0 for chunk in chunks)


def test_zero_length_sentence_content_is_dropped() -> None:
    chunks = chunk_document(_document(_page("。。。")))

    assert chunks == []


def test_token_count_never_exceeds_600_with_defaults() -> None:
    paragraph = "知识闭环系统需要文档解析与中文切片。"
    text = paragraph * 500
    chunks = chunk_document(_document(_page(text)))

    assert chunks
    assert all(chunk.token_count <= 600 for chunk in chunks)
    assert max(chunk.token_count for chunk in chunks) <= 550


def test_invalid_budget_raises() -> None:
    with pytest.raises(ValueError):
        chunk_document(_document(_page("内容。")), max_tokens=0)
