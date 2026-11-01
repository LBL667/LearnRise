"""SQLAlchemy models. Importing this package registers all tables on ``Base``."""

from app.models.agent_config import AgentConfig
from app.models.assistant import AssistantConversation, AssistantMessage
from app.models.chunk import EMBEDDING_DIM, Chunk
from app.models.common import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin, new_uuid
from app.models.competition import Competition, CompetitionInvite, CompetitionMember
from app.models.diagnostics import WrongQuestionDismissal
from app.models.email_reminder import EmailReminder
from app.models.exam_plan import ExamPlan
from app.models.explanation_log import ExplanationLog
from app.models.ingestion_job import IngestionJob
from app.models.knowledge_point import KnowledgePoint
from app.models.knowledge_source import KnowledgeSource
from app.models.practice import PracticeItem, PracticeSession
from app.models.quiz_attempt import QuizAttempt
from app.models.quiz_question import QuizQuestion
from app.models.review_card import ReviewCard
from app.models.review_log import ReviewLog
from app.models.trial import TrialAnswer, TrialExam
from app.models.user import User

__all__ = [
    "EMBEDDING_DIM",
    "AgentConfig",
    "AssistantConversation",
    "AssistantMessage",
    "Chunk",
    "Competition",
    "CompetitionInvite",
    "CompetitionMember",
    "CreatedAtMixin",
    "EmailReminder",
    "ExamPlan",
    "ExplanationLog",
    "IngestionJob",
    "KnowledgePoint",
    "KnowledgeSource",
    "PracticeItem",
    "PracticeSession",
    "QuizAttempt",
    "QuizQuestion",
    "ReviewCard",
    "ReviewLog",
    "TrialAnswer",
    "TrialExam",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "WrongQuestionDismissal",
    "User",
    "new_uuid",
]
