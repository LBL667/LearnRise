"""Degradation chain: primary provider, then an optional fallback provider.

Retry policy is deliberately small: the same primary is retried up to
``max_retries`` times with exponential backoff on throttle / server / timeout
failures, then the fallback is tried once. Authentication errors are never
retried and never fall back, because a second endpoint cannot fix a bad key.
"""

from __future__ import annotations

import time
from collections.abc import Iterator

from app.ports import ChatMessage, ChatResult, LLMProvider
from app.ports.errors import ProviderAuthError, ProviderError


class FallbackLLM:
    """Wrap a primary and a fallback :class:`LLMProvider` with backoff."""

    def __init__(
        self,
        primary: LLMProvider,
        fallback: LLMProvider | None = None,
        *,
        max_retries: int = 2,
        backoff_base: float = 0.2,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._max_retries = max(0, max_retries)
        self._backoff_base = backoff_base
        self._last_source: LLMProvider = primary

    @property
    def last_reasoning(self) -> str:
        """Reasoning text from the provider that actually answered."""
        return str(getattr(self._last_source, "last_reasoning", ""))

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> ChatResult:
        last_error: ProviderError | None = None
        for attempt in range(self._max_retries + 1):
            try:
                result = self._primary.chat(
                    messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                )
            except ProviderAuthError:
                raise
            except ProviderError as exc:
                last_error = exc
                if attempt < self._max_retries:
                    self._pause(attempt)
                continue
            self._last_source = self._primary
            return result
        if self._fallback is not None:
            try:
                result = self._fallback.chat(
                    messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                )
            except ProviderAuthError:
                raise
            self._last_source = self._fallback
            return result
        assert last_error is not None
        raise last_error

    def stream(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> Iterator[str]:
        last_error: ProviderError | None = None
        for attempt in range(self._max_retries + 1):
            try:
                iterator = self._primary.stream(
                    messages,
                    model=model,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=timeout,
                )
                first = next(iterator)
            except StopIteration:
                self._last_source = self._primary
                return
            except ProviderAuthError:
                raise
            except ProviderError as exc:
                last_error = exc
                if attempt < self._max_retries:
                    self._pause(attempt)
                continue
            self._last_source = self._primary
            yield first
            yield from iterator
            return
        if self._fallback is not None:
            self._last_source = self._fallback
            yield from self._fallback.stream(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
                timeout=timeout,
            )
            return
        assert last_error is not None
        raise last_error

    def _pause(self, attempt: int) -> None:
        delay = self._backoff_base * (2**attempt)
        if delay > 0:
            time.sleep(delay)
