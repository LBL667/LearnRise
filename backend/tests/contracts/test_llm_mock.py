from __future__ import annotations

import json

import pytest

from app.adapters.llm import MockLLM, build_llm
from app.config import Settings
from app.ports import ChatMessage
from app.services.notes import SYSTEM_PROMPT as NOTES_SYSTEM_PROMPT
from app.services.notes import NoteDocument
from app.services.quiz import ChoiceItem, JudgeItem, ShortAnswerItem

KP_A = "3f2b8c9e-1a4d-4f6b-9c0d-2e3f4a5b6c7d"
KP_B = "9c8b7a65-4321-4fed-8cba-9876543210fe"
CLOSING = "希望这个讲解对你有帮助。"

NOTE_MESSAGES = [
    ChatMessage(role="system", content=NOTES_SYSTEM_PROMPT),
    ChatMessage(
        role="user",
        content=(
            "资料标题：计算机网络实验讲义\n\n"
            "以下是资料片段：\n[page 1]\n三次握手：客户端发送 SYN，服务器回复 SYN+ACK。\n\n"
            "请根据以上内容生成层级结构化学习笔记，只输出 JSON。"
        ),
    ),
]


def quiz_messages(qtype: str, num: int = 3) -> list[ChatMessage]:
    labels = {"choice": "选择题", "judge": "判断题", "short_answer": "简答题"}
    return [
        ChatMessage(
            role="system",
            content=(
                "你是出题助手。基于提供的资料片段为知识点出题。只输出 JSON 数组，"
                "每项 {question, options, answer, explanation, difficulty, knowledge_point_id}。"
            ),
        ),
        ChatMessage(
            role="user",
            content=(
                f"共 2 个知识点，请一共出 {num} 道{labels[qtype]}，难度 medium。\n\n"
                f"知识点（id={KP_A}，目标 2 题）\n标题：三次握手\n内容：同步序号\n"
                "资料片段：\n客户端发送 SYN，服务器回复 SYN+ACK。\n\n"
                f"知识点（id={KP_B}，目标 1 题）\n标题：四次挥手\n内容：断开连接\n"
                "资料片段：\n主动方发送 FIN，被动方回复 ACK。\n\n"
                "只输出 JSON 数组，每项包含 question、options、answer、explanation、"
                "difficulty 和 knowledge_point_id。"
            ),
        ),
    ]


def test_chat_returns_schema_valid_note_document() -> None:
    result = MockLLM().chat(NOTE_MESSAGES)

    document = NoteDocument.model_validate(json.loads(result.content))

    assert len(document.nodes) >= 3
    assert document.title.startswith("计算机网络实验讲义")
    assert all(node.level == 0 for node in document.nodes)
    assert all(child.level == 1 for node in document.nodes for child in node.children)


@pytest.mark.parametrize(
    ("qtype", "model"),
    [("choice", ChoiceItem), ("judge", JudgeItem), ("short_answer", ShortAnswerItem)],
)
def test_chat_returns_schema_valid_quiz_array(qtype: str, model: type) -> None:
    result = MockLLM().chat(quiz_messages(qtype))

    items = json.loads(result.content)

    assert isinstance(items, list)
    assert len(items) == 3
    for item in items:
        parsed = model.model_validate(item)
        assert parsed.knowledge_point_id in {KP_A, KP_B}
        assert parsed.explanation
        if qtype == "choice":
            assert len(parsed.options) == 4  # type: ignore[attr-defined]
            assert len(set(parsed.options)) == 4  # type: ignore[attr-defined]
            assert parsed.answer in {"A", "B", "C", "D"}
        else:
            assert parsed.options is None


def test_chat_plain_prompt_returns_plain_string() -> None:
    result = MockLLM().chat([ChatMessage(role="user", content="你好，介绍一下你自己")])

    assert result.content
    assert "{" not in result.content
    assert "[" not in result.content
    assert result.model == "mock-local"
    assert result.usage is not None


def test_chat_is_deterministic() -> None:
    first = MockLLM().chat(quiz_messages("choice"))
    second = MockLLM().chat(quiz_messages("choice"))

    assert first.content == second.content


def test_stream_yields_at_least_eight_deltas_and_closes() -> None:
    deltas = list(MockLLM().stream([ChatMessage(role="user", content="讲讲三次握手")]))

    assert len(deltas) >= 8
    assert all(delta for delta in deltas)
    assert "".join(deltas).endswith(CLOSING)


def test_stream_is_deterministic() -> None:
    first = list(MockLLM().stream([ChatMessage(role="user", content="讲讲拥塞控制")]))
    second = list(MockLLM().stream([ChatMessage(role="user", content="讲讲拥塞控制")]))

    assert first == second


def test_build_llm_selects_mock_provider() -> None:
    llm = build_llm(
        Settings(
            llm_provider="mock",
            llm_model="mock-local",
            llm_fallback_base_url="https://llm.fallback.test/v1",
        )
    )

    assert isinstance(llm, MockLLM)
    assert llm.model == "mock-local"
