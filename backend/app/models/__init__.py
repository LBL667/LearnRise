"""SQLAlchemy models. Importing this package registers all tables on ``Base``."""

from app.models.agent_config import AgentConfig
from app.models.chunk import EMBEDDING_DIM, Chunk
from app.models.common import CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin, new_uuid
from app.models.email_reminder import EmailReminder
from app.models.explanation_log import ExplanationLog
from app.models.ingestion_job import IngestionJob
from app.models.knowledge_point import KnowledgePoint
from app.models.knowledge_source import KnowledgeSource
from app.models.quiz_attempt import QuizAttempt
from app.models.quiz_question import QuizQuestion
from app.models.review_card import ReviewCard
from app.models.review_log import ReviewLog
from app.models.user import User

__all__ = [
    "EMBEDDING_DIM",
    "AgentConfig",
    "Chunk",
    "CreatedAtMixin",
    "EmailReminder",
    "ExplanationLog",
    "IngestionJob",
    "KnowledgePoint",
    "KnowledgeSource",
    "QuizAttempt",
    "QuizQuestion",
    "ReviewCard",
    "ReviewLog",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    "User",
    "new_uuid",
]
