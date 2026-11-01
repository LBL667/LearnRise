"""Spaced-repetition scheduler port.

State is expressed as a plain ``dict`` on purpose: the port must not depend on
the DSR domain model introduced later, and adapters may persist whatever
serialisable shape they need.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Protocol, runtime_checkable

from app.ports.types import CardSummary


@runtime_checkable
class Scheduler(Protocol):
    """Due-card lookup and interval calculation backend."""

    def due_cards(self, *, user_id: str, as_of: date) -> list[CardSummary]:
        """Return cards due for review on or before ``as_of``."""
        ...

    def review(self, *, state: dict, rating: int, now: datetime) -> dict:
        """Apply a review ``rating`` to ``state`` and return the new state."""
        ...

    def next_interval(self, *, state: dict, target: float = 0.9) -> int:
        """Return the next interval in days for the desired retention ``target``."""
        ...
