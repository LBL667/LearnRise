"""Agent resolution port.

Maps a logical task type to a concrete ``LLMProvider`` instance, allowing per
user / per agent overrides without the caller knowing which vendor backs it.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.ports.llm import LLMProvider


@runtime_checkable
class AgentResolver(Protocol):
    """Resolve the provider that should serve a given task type."""

    def resolve(
        self,
        task_type: str,
        *,
        user_id: str,
        agent_id: str | None = None,
    ) -> LLMProvider:
        """Return the provider configured for ``task_type`` / ``user_id``."""
        ...
