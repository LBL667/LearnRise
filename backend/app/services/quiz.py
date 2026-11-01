"""RAG-based quiz generation with strict per-type validation.

Each requested knowledge point is embedded (title + content) and searched in
the vector store for its own top chunks; the retrieved text is what the prompt
shows the model, so no question is invented without grounding. The LLM answer
is parsed, stripped of Markdown fences and validated with a pydantic model per
question type. One retry with a stricter instruction is allowed; a second
failure raises :class:`QuizGenerationError` carrying the truncated raw text.

Only validated rows are written, in a single transaction. Prompts are never
logged: only chunk counts, character counts and the model name.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy.orm import Session

from app.adapters.embedding import build_embedding
from app.adapters.vector import build_vector_store
from app.models import AgentConfig, KnowledgePoint, QuizQuestion
from app.ports import ChatMessage, EmbeddingProvider, LLMProvider, VectorStore
from app.services.agent_resolver import resolve_agent

logger = logging.getLogger(__name__)

TASK_TYPE = "quiz"
MAX_NUM = 20
TOP_K = 3
RAW_LIMIT = 2000
FAILURE_MESSAGE = "出题失败：JSON 校验未通过"

DIFFICULTIES = ("easy", "medium", "hard")
TYPE_LABELS = {"choice": "选择题", "judge": "判断题", "short_answer": "简答题"}

SYSTEM_PROMPT = (
    "你是出题助手。基于提供的资料片段为知识点出题。"
    "只输出 JSON 数组，每项 {question, options, answer, explanation, "
    "difficulty, knowledge_point_id}。"
    "选择题必须有 4 个选项且 answer 为 A/B/C/D；判断题 answer 为 true 或 false；"
    "简答题的 answer 与 explanation 都不能为空。difficulty 取 easy/medium/hard。"
    "题目必须来自资料片段，不要编造偏题怪题。"
)
STRICT_INSTRUCTION = (
    "只输出合法 JSON 数组，不要任何解释或代码块围栏；"
    "选择题必须恰好 4 个选项且 answer 为 A/B/C/D；"
    "判断题 answer 只能是 \"true\" 或 \"false\"；简答题必须有 answer 和 explanation"
)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_OPTION_PREFIX_RE = re.compile(r"^\s*([A-Da-d])\s*[.、:：)．]\s*(.+)$", re.DOTALL)
_ANSWER_RE = re.compile(r"^\s*(?:选项\s*)?([A-Da-d])\s*[.、:：)．]?\s*$")
_KEYS = ("A", "B", "C", "D")
_TRUE_VALUES = {"true", "t", "yes", "y", "正确", "对", "是", "√"}
_FALSE_VALUES = {"false", "f", "no", "n", "错误", "错", "否", "×"}


class QuizKPNotFound(Exception):
    """A knowledge point is missing, foreign or not a valid UUID (mapped to 404)."""


class QuizGenerationError(Exception):
    """Both LLM attempts produced invalid payloads (mapped to 422)."""

    def __init__(self, raw: str) -> None:
        super().__init__(FAILURE_MESSAGE)
        self.raw = (raw or "")[:RAW_LIMIT]


@dataclass(frozen=True, slots=True)
class QuizDraft:
    type: str
    question: str
    options: list[str] | None
    answer: str
    explanation: str
    difficulty: str
    knowledge_point_id: str | None


Resolver = Callable[..., tuple[LLMProvider, AgentConfig | None]]


def _clean_text(value: Any, *, required: bool = False) -> str:
    if not isinstance(value, str):
        if required:
            raise ValueError("text field missing")
        return ""
    text = value.strip()
    if required and not text:
        raise ValueError("text field empty")
    return text


def _normalize_options(raw: Any) -> tuple[list[str], dict[str, str] | None]:
    if not isinstance(raw, list) or len(raw) != 4:
        raise ValueError("options must contain exactly 4 entries")
    pairs: list[tuple[str | None, str]] = []
    for item in raw:
        if isinstance(item, dict):
            key = str(item.get("key", "")).strip().upper()
            text = item.get("text", item.get("content", ""))
            if key not in _KEYS:
                raise ValueError("option key must be A-D")
            pairs.append((key, str(text).strip()))
        elif isinstance(item, str):
            match = _OPTION_PREFIX_RE.match(item)
            if match is not None:
                pairs.append((match.group(1).upper(), match.group(2).strip()))
            else:
                pairs.append((None, item.strip()))
        else:
            raise ValueError("option must be a string or object")

    if any(key is not None for key, _ in pairs):
        keys = [key for key, _ in pairs]
        if any(key is None for key in keys) or set(keys) != set(_KEYS):
            raise ValueError("labelled options must use A/B/C/D exactly once")
        mapping = {key: text for key, text in pairs if key is not None}
        ordered = [mapping[key] for key in _KEYS]
    else:
        ordered = [text for _, text in pairs]
        mapping = None

    if any(not text for text in ordered):
        raise ValueError("options must not be empty")
    if len(set(ordered)) != 4:
        raise ValueError("options must be distinct")
    return ordered, mapping


def _normalize_choice_answer(value: Any) -> str:
    if isinstance(value, str):
        match = _ANSWER_RE.match(value)
        if match is not None:
            return match.group(1).upper()
    raise ValueError("choice answer must be A/B/C/D")


def _normalize_judge_answer(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        token = value.strip().lower()
        if token in _TRUE_VALUES:
            return "true"
        if token in _FALSE_VALUES:
            return "false"
    raise ValueError("judge answer must be true/false")


def _normalize_difficulty(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        token = value.strip().lower()
        if token in DIFFICULTIES:
            return token
    return fallback


class _ItemBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question: str = Field(min_length=1)
    explanation: str = ""
    difficulty: str | None = None
    knowledge_point_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _clean_base(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("item must be an object")
        payload = dict(data)
        payload["question"] = _clean_text(payload.get("question"), required=True)
        payload["explanation"] = _clean_text(payload.get("explanation"))
        raw_kp = payload.get("knowledge_point_id")
        payload["knowledge_point_id"] = _clean_text(raw_kp) or None
        return payload


class ChoiceItem(_ItemBase):
    options: list[str] = Field(min_length=4, max_length=4)
    answer: Literal["A", "B", "C", "D"]

    @model_validator(mode="before")
    @classmethod
    def _normalize_choice(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("item must be an object")
        options, mapping = _normalize_options(data.get("options"))
        answer = _normalize_choice_answer(data.get("answer"))
        if mapping is not None and answer not in mapping:
            raise ValueError("answer does not match any option key")
        payload = dict(data)
        payload["options"] = options
        payload["answer"] = answer
        return payload


class JudgeItem(_ItemBase):
    answer: Literal["true", "false"]
    options: None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_judge(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("item must be an object")
        payload = dict(data)
        payload["answer"] = _normalize_judge_answer(data.get("answer"))
        payload["options"] = None
        return payload


class ShortAnswerItem(_ItemBase):
    answer: str = Field(min_length=1)
    options: None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_short_answer(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("item must be an object")
        payload = dict(data)
        payload["answer"] = _clean_text(data.get("answer"), required=True)
        payload["options"] = None
        explanation = _clean_text(data.get("explanation"), required=True)
        payload["explanation"] = explanation
        return payload


_ITEM_MODEL: dict[str, type[BaseModel]] = {
    "choice": ChoiceItem,
    "judge": JudgeItem,
    "short_answer": ShortAnswerItem,
}


def _to_draft(item: BaseModel, qtype: str, fallback_difficulty: str) -> QuizDraft:
    return QuizDraft(
        type=qtype,
        question=item.question,  # type: ignore[attr-defined]
        options=item.options,  # type: ignore[attr-defined]
        answer=item.answer,  # type: ignore[attr-defined]
        explanation=item.explanation,  # type: ignore[attr-defined]
        difficulty=_normalize_difficulty(
            item.difficulty, fallback_difficulty  # type: ignore[attr-defined]
        ),
        knowledge_point_id=item.knowledge_point_id,  # type: ignore[attr-defined]
    )


def _strip_fences(text: str) -> str:
    match = _FENCE_RE.search(text)
    if match is not None:
        return match.group(1).strip()
    return text.strip()


def _extract_payload(text: str) -> Any | None:
    candidate = _strip_fences(text or "")
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except (json.JSONDecodeError, TypeError):
        pass

    decoder = json.JSONDecoder()
    starts = [index for index in (candidate.find("["), candidate.find("{")) if index >= 0]
    if not starts:
        return None
    for start in sorted(starts):
        try:
            payload, _end = decoder.raw_decode(candidate[start:])
            return payload
        except json.JSONDecodeError:
            continue
    return None


def _as_item_list(payload: Any) -> list[Any] | None:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("questions", "items", "data"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                return candidate
        return [payload]
    return None


def _validate_payload(
    payload: Any, qtype: str, fallback_difficulty: str
) -> list[QuizDraft] | None:
    items = _as_item_list(payload)
    if not items:
        return None
    model = _ITEM_MODEL[qtype]
    drafts: list[QuizDraft] = []
    try:
        for raw in items:
            drafts.append(
                _to_draft(model.model_validate(raw), qtype, fallback_difficulty)
            )
    except (ValidationError, ValueError):
        return None
    return drafts


def _chat(llm: LLMProvider, messages: list[ChatMessage]) -> str:
    result = llm.chat(messages)
    return result.content or ""


def _generate_drafts(
    llm: LLMProvider,
    messages: list[ChatMessage],
    *,
    qtype: str,
    difficulty: str,
) -> list[QuizDraft]:
    raw = _chat(llm, messages)
    drafts = _validate_payload(_extract_payload(raw), qtype, difficulty)
    if drafts is not None:
        return drafts

    retry_messages = [*messages, ChatMessage(role="user", content=STRICT_INSTRUCTION)]
    raw = _chat(llm, retry_messages)
    drafts = _validate_payload(_extract_payload(raw), qtype, difficulty)
    if drafts is not None:
        return drafts
    raise QuizGenerationError(raw)


def _load_kps(db: Session, *, user_id: str, kp_ids: Sequence[str]) -> list[KnowledgePoint]:
    loaded: list[KnowledgePoint] = []
    for kp_id in kp_ids:
        try:
            UUID(kp_id)
        except (ValueError, TypeError, AttributeError):
            raise QuizKPNotFound(kp_id) from None
        point = db.get(KnowledgePoint, kp_id)
        if point is None or str(point.user_id) != str(user_id):
            raise QuizKPNotFound(kp_id)
        loaded.append(point)
    return loaded


def _retrieve_context(
    point: KnowledgePoint,
    *,
    embedder: EmbeddingProvider,
    store: VectorStore,
) -> str:
    query = f"{point.title}\n{point.content}".strip()
    if not query:
        return ""
    vector = embedder.embed([query]).vectors[0]
    source_ids = [point.source_id] if point.source_id else None
    hits = store.search(vector, top_k=TOP_K, source_ids=source_ids)
    return "\n\n".join(hit.content.strip() for hit in hits if hit.content.strip())


def _per_kp_counts(kp_count: int, num: int) -> list[int]:
    base, remainder = divmod(num, kp_count)
    return [base + (1 if index < remainder else 0) for index in range(kp_count)]


def _round_robin_slots(kp_ids: Sequence[str], num: int) -> list[str]:
    return [kp_ids[index % len(kp_ids)] for index in range(num)]


def _build_messages(
    points: Sequence[KnowledgePoint],
    contexts: Sequence[str],
    *,
    qtype: str,
    num: int,
    difficulty: str,
) -> list[ChatMessage]:
    counts = _per_kp_counts(len(points), num)
    blocks = [
        f"共 {len(points)} 个知识点，请一共出 {num} 道{TYPE_LABELS[qtype]}，难度 {difficulty}。"
    ]
    for point, context, count in zip(points, contexts, counts, strict=True):
        body = context or "（无检索片段，请依据知识点内容出题）"
        blocks.append(
            f"知识点（id={point.id}，目标 {count} 题）\n"
            f"标题：{point.title}\n"
            f"内容：{point.content}\n"
            f"资料片段：\n{body}"
        )
    blocks.append(
        "只输出 JSON 数组，每项包含 question、options、answer、explanation、"
        "difficulty 和 knowledge_point_id。"
    )
    return [
        ChatMessage(role="system", content=SYSTEM_PROMPT),
        ChatMessage(role="user", content="\n\n".join(blocks)),
    ]


def _assign_points(
    drafts: Sequence[QuizDraft], kp_ids: Sequence[str], num: int
) -> list[QuizDraft] | None:
    allowed = set(kp_ids)
    slots = _round_robin_slots(kp_ids, num)
    assigned: list[QuizDraft] = []
    for index, draft in enumerate(drafts[:num]):
        if draft.knowledge_point_id is not None:
            if draft.knowledge_point_id not in allowed:
                return None
            kp_id = draft.knowledge_point_id
        else:
            kp_id = slots[index] if index < len(slots) else kp_ids[0]
        assigned.append(
            QuizDraft(
                type=draft.type,
                question=draft.question,
                options=draft.options,
                answer=draft.answer,
                explanation=draft.explanation,
                difficulty=draft.difficulty,
                knowledge_point_id=kp_id,
            )
        )
    return assigned or None


def _persist(db: Session, *, user_id: str, drafts: Sequence[QuizDraft]) -> list[QuizQuestion]:
    rows: list[QuizQuestion] = []
    try:
        for draft in drafts:
            if draft.knowledge_point_id is None:
                raise ValueError("draft without knowledge point")
            row = QuizQuestion(
                user_id=user_id,
                knowledge_point_id=draft.knowledge_point_id,
                type=draft.type,
                question=draft.question,
                options=draft.options,
                answer=draft.answer,
                explanation=draft.explanation,
                difficulty=draft.difficulty,
            )
            db.add(row)
            rows.append(row)
        db.flush()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return rows


def _default_embedder() -> EmbeddingProvider:
    return build_embedding()


def _default_store() -> VectorStore:
    return build_vector_store()


def generate_questions(
    db: Session,
    *,
    user_id: str,
    kp_ids: Sequence[str],
    qtype: str,
    num: int,
    difficulty: str = "medium",
    resolver: Resolver | None = None,
    embedder: EmbeddingProvider | None = None,
    store: VectorStore | None = None,
) -> tuple[list[QuizQuestion], str]:
    """Generate, validate and persist ``num`` questions for ``kp_ids``.

    Returns the persisted rows and the model name. Raises
    :class:`QuizKPNotFound` for a missing/foreign id and
    :class:`QuizGenerationError` when both attempts fail validation.
    """
    points = _load_kps(db, user_id=user_id, kp_ids=kp_ids)
    if not points:
        raise ValueError("no knowledge points")

    resolve = resolver if resolver is not None else resolve_agent
    llm, _agent = resolve(db, user_id=user_id, agent_id=None, task_type=TASK_TYPE)

    embedding = embedder if embedder is not None else _default_embedder()
    vector_store = store if store is not None else _default_store()
    contexts = [
        _retrieve_context(point, embedder=embedding, store=vector_store)
        for point in points
    ]

    messages = _build_messages(
        points, contexts, qtype=qtype, num=num, difficulty=difficulty
    )
    logger.info(
        "quiz: kps=%d type=%s num=%d chunks=%d prompt_chars=%d model=%s",
        len(points),
        qtype,
        num,
        sum(1 for context in contexts if context),
        sum(len(message.content) for message in messages),
        getattr(llm, "model", ""),
    )

    drafts = _generate_drafts(
        llm, messages, qtype=qtype, difficulty=difficulty
    )
    assigned = _assign_points(drafts, [point.id for point in points], num)
    if assigned is None:
        raise QuizGenerationError(json.dumps(drafts, default=str, ensure_ascii=False))

    rows = _persist(db, user_id=user_id, drafts=assigned)
    return rows, str(getattr(llm, "model", "") or "")
