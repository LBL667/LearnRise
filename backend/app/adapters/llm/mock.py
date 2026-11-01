"""Deterministic offline LLM provider used by the demo profile.

``LLM_PROVIDER=mock`` selects :class:`MockLLM`. It never touches the network
and returns schema-valid payloads for the three AI paths of the learning cycle:

* note generation  -> a note document JSON (prompt talks about 笔记)
* quiz generation  -> a JSON array of questions (prompt talks about 出题)
* anything else    -> a short deterministic Chinese answer

Every response is derived from a SHA-256 digest of the prompt, so the same
prompt always yields byte-identical output. That keeps contract tests and the
three-minute demo reproducible on a machine without any API key. This is a
documented provider (not a test stub): the production profile swaps it for a
real OpenAI-compatible endpoint via ``LLM_PROVIDER``.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator
from typing import Any

from app.ports import ChatMessage, ChatResult

MODEL_NAME = "mock-local"

_KP_BLOCK_RE = re.compile(r"id=([0-9a-fA-F-]{36})，目标\s*(\d+)\s*题")
_KP_ID_RE = re.compile(r"id=([0-9a-fA-F-]{36})")
_TOTAL_RE = re.compile(r"一共出\s*(\d+)\s*道")
_TYPE_RE = re.compile(r"道\s*(选择题|判断题|简答题)")
_DIFFICULTY_RE = re.compile(r"难度\s*(easy|medium|hard)")
_TITLE_RE = re.compile(r"资料标题：([^\n]+)")
_TASK_TYPE_LABELS = {"选择题": "choice", "判断题": "judge", "简答题": "short_answer"}

#: The five sections every generated lecture note is built from.
_NOTE_SECTIONS: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    (
        "三次握手",
        "TCP 通过 SYN、SYN+ACK、ACK 三个报文同步序号并建立连接，确保双方收发能力正常。",
        (
            ("SYN 报文", "客户端发送 SYN，携带初始序号并进入 SYN-SENT 状态。"),
            ("SYN+ACK 报文", "服务器回复 SYN+ACK，同意连接并给出自己的初始序号。"),
            ("ACK 报文", "客户端发送 ACK 确认，双方进入 ESTABLISHED 状态。"),
        ),
    ),
    (
        "四次挥手",
        "断开连接需要四次挥手，因为 TCP 连接是全双工的，两个方向要分别关闭。",
        (
            ("FIN 与 ACK", "主动关闭方发送 FIN，被动方先回复 ACK 表示收到。"),
            ("被动方 FIN", "被动方处理完剩余数据后再发送 FIN，请求关闭另一方向。"),
            ("最终 ACK", "主动方回复 ACK 并等待 2MSL，确认报文不会误伤新连接。"),
        ),
    ),
    (
        "拥塞控制",
        "拥塞控制通过慢启动、拥塞避免、快重传和快恢复调节发送速率，避免网络过载。",
        (
            ("慢启动", "拥塞窗口从 1 个 MSS 开始指数增长，直到达到慢启动门限。"),
            ("拥塞避免", "窗口超过门限后改为线性增长，谨慎探测网络容量。"),
            ("快重传与快恢复", "收到三个重复 ACK 立即重传，并把窗口减半后继续线性增长。"),
        ),
    ),
    (
        "可靠传输",
        "序号、确认、重传和校验和共同保证数据可靠、有序、无重复地到达对端。",
        (
            ("序号与确认", "每个字节都有序号，接收方用累积确认告知已收到的位置。"),
            ("超时重传", "发送方为报文设置定时器，超时未确认就重传该报文。"),
            ("校验和", "接收方校验报文头与数据的校验和，损坏的报文直接丢弃。"),
        ),
    ),
    (
        "流量控制",
        "滑动窗口让接收方通过窗口字段告知可用缓冲，防止发送方压垮接收方。",
        (
            ("滑动窗口", "发送窗口随接收窗口变化滑动，未确认的数据不能超出窗口。"),
            ("零窗口", "接收缓冲满时通告零窗口，发送方暂停并定期探测窗口。"),
            ("窗口更新", "接收方腾出空间后发送窗口更新，发送方恢复发送。"),
        ),
    ),
)

_STREAM_BODIES = (
    (
        "三次握手的核心是同步双方的初始序号并确认彼此的收发能力。"
        "客户端先发送 SYN 报文并携带初始序号，此时进入 SYN-SENT 状态。"
        "服务器收到后回复 SYN+ACK，既确认了客户端，也给出自己的初始序号。"
        "客户端再发送 ACK 完成确认，连接进入 ESTABLISHED 状态。"
        "三次而不是两次，是为了避免历史连接请求在网络中滞留后造成错误建连。"
        "掌握这个过程，可以帮助我们分析连接超时、半开连接等常见故障。"
        "希望这个讲解对你有帮助。"
    ),
    (
        "四次挥手用于安全地断开一条全双工连接。"
        "主动关闭方发送 FIN，说明自己不再发送数据，但仍可以接收。"
        "被动方先回复 ACK，等剩余数据处理完再发送自己的 FIN。"
        "主动方最后回复 ACK，并等待 2MSL 才真正关闭，确保最后的确认能够到达。"
        "之所以需要四次，是因为两个方向的数据流要分别关闭，不能合并成两次。"
        "理解挥手过程，有助于定位连接泄漏和端口耗尽问题。"
        "希望这个讲解对你有帮助。"
    ),
    (
        "拥塞控制决定发送方在不确定的网络中能发多快。"
        "慢启动阶段拥塞窗口从 1 个 MSS 开始指数增长，快速探测可用带宽。"
        "达到慢启动门限后进入拥塞避免，窗口改为线性增长，避免过冲。"
        "一旦出现超时或重复确认，就通过快重传和快恢复收缩窗口。"
        "这套机制把丢包视为拥塞信号，在吞吐和稳定之间取得平衡。"
        "理解它，能解释为什么长距离高带宽链路需要更大的窗口。"
        "希望这个讲解对你有帮助。"
    ),
)


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _plain_answer(seed: str) -> str:
    """A short deterministic reply for prompts that are neither notes nor quiz."""
    variant = int(seed[:2], 16) % 3
    return (
        f"这是本地 Mock 模型（{MODEL_NAME}）的确定性回答，编号 {seed[:6]}。",
        "本地 Mock 模型已收到请求，当前为离线演示模式，未调用任何外部接口。",
        "收到。当前由本地 Mock 模型作答，输出稳定可复现，便于离线演示与测试。",
    )[variant]


class MockLLM:
    """Offline, deterministic :class:`~app.ports.llm.LLMProvider` implementation."""

    def __init__(self, *, model: str = MODEL_NAME) -> None:
        self._model = model or MODEL_NAME

    @property
    def model(self) -> str:
        """Model id reported to logs, API responses and the UI."""
        return self._model

    # -- LLMProvider protocol ------------------------------------------------
    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> ChatResult:
        prompt = _prompt_text(messages)
        seed = _digest(prompt)
        if "笔记" in prompt:
            content = _note_document(prompt, seed)
        elif "出题" in prompt:
            content = _quiz_array(prompt, seed)
        else:
            content = _plain_answer(seed)
        return ChatResult(
            content=content,
            model=model or self._model,
            usage={
                "prompt_tokens": max(1, len(prompt) // 4),
                "completion_tokens": max(1, len(content) // 4),
                "total_tokens": max(2, (len(prompt) + len(content)) // 4),
            },
        )

    def stream(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> Iterator[str]:
        body = _STREAM_BODIES[int(_digest(_prompt_text(messages))[:2], 16) % len(_STREAM_BODIES)]
        # 14-character slices keep the token cadence close to a real provider
        # (~14 SSE frames for a 190-character explanation).
        yield from re.findall(r".{1,14}", body)


def _prompt_text(messages: list[ChatMessage]) -> str:
    return "\n".join(message.content for message in messages)


def _note_document(prompt: str, seed: str) -> str:
    match = _TITLE_RE.search(prompt)
    title = (match.group(1).strip() if match else "").strip() or "计算机网络学习笔记"
    offset = int(seed[:2], 16) % len(_NOTE_SECTIONS)
    sections = _NOTE_SECTIONS[offset:] + _NOTE_SECTIONS[:offset]
    nodes: list[dict[str, Any]] = []
    for section_title, summary, children in sections:
        nodes.append(
            {
                "title": section_title,
                "content": summary,
                "level": 0,
                "children": [
                    {"title": child_title, "content": body, "level": 1, "children": []}
                    for child_title, body in children
                ],
            }
        )
    return json.dumps(
        {"title": f"{title} - 结构化笔记", "nodes": nodes}, ensure_ascii=False
    )


def _quiz_array(prompt: str, seed: str) -> str:
    qtype = "choice"
    type_match = _TYPE_RE.search(prompt)
    if type_match is not None:
        qtype = _TASK_TYPE_LABELS[type_match.group(1)]
    difficulty = "medium"
    difficulty_match = _DIFFICULTY_RE.search(prompt)
    if difficulty_match is not None:
        difficulty = difficulty_match.group(1)

    blocks = [(kp_id, int(count)) for kp_id, count in _KP_BLOCK_RE.findall(prompt)]
    if not blocks:
        ids = _KP_ID_RE.findall(prompt)
        blocks = [(kp_id, 1) for kp_id in ids]
    if not blocks:
        blocks = [("", 1)]

    total_match = _TOTAL_RE.search(prompt)
    num = int(total_match.group(1)) if total_match else sum(count for _, count in blocks)
    num = max(1, min(num, 20))

    slots = [kp_id for kp_id, count in blocks for _ in range(count)]
    items: list[dict[str, Any]] = []
    for index in range(num):
        item_seed = int(_digest(f"{seed}:{index}")[:4], 16)
        topic_index = item_seed % len(_NOTE_SECTIONS)
        topic, summary, _children = _NOTE_SECTIONS[topic_index]
        item: dict[str, Any] = {
            "explanation": f"{topic}的要点见资料片段：{summary}",
            "difficulty": difficulty,
            "knowledge_point_id": slots[index % len(slots)] if slots else None,
        }
        if qtype == "choice":
            options, answer = _choice_options(summary, topic_index, item_seed)
            item["question"] = f"以下哪一项最符合「{topic}」的描述（第 {index + 1} 题）？"
            item["options"] = options
            item["answer"] = answer
        elif qtype == "judge":
            if item_seed % 2 == 0:
                item["question"] = f"判断：{summary}（第 {index + 1} 题）"
                item["answer"] = "true"
            else:
                item["question"] = f"判断：{topic}不需要任何报文交互即可完成（第 {index + 1} 题）"
                item["answer"] = "false"
        else:
            item["question"] = f"简述「{topic}」的主要作用（第 {index + 1} 题）。"
            item["answer"] = summary
        items.append(item)
    return json.dumps(items, ensure_ascii=False)


def _choice_options(summary: str, topic_index: int, item_seed: int) -> tuple[list[str], str]:
    others = [
        candidate
        for index, (_title, candidate, _children) in enumerate(_NOTE_SECTIONS)
        if index != topic_index
    ][:3]
    pool = [summary, *others]
    shift = item_seed % len(pool)
    rotated = pool[shift:] + pool[:shift]
    answer = "ABCD"[rotated.index(summary)]
    return rotated, answer
