"""OpenAI-compatible chat adapter built on raw ``httpx``.

No vendor SDK is imported here on purpose: the isolation gate forbids
``openai``/``huaweicloudsdk*`` outside ``app.adapters`` and this adapter has to
serve DeepSeek, ModelArts MaaS, SiliconFlow and any other drop-in endpoint with
the same wire format.

Failure mapping (never include the upstream body or the api key):

* ``401`` / ``403`` -> :class:`ProviderAuthError`
* ``429`` -> :class:`ProviderRateLimitError`
* ``5xx`` -> :class:`ProviderError`
* timeout / connect failure -> :class:`UpstreamTimeoutError`
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

import httpx

from app.ports import ChatMessage, ChatResult
from app.ports.errors import (
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    UpstreamTimeoutError,
)

_DONE = "[DONE]"


class OpenAICompatibleLLM:
    """Chat completions over the OpenAI ``/chat/completions`` wire format.

    The instance is a thin configuration holder; every call takes an optional
    override for ``model`` / ``temperature`` / ``max_tokens`` / ``timeout`` so a
    single adapter can back several agents.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        timeout: float = 60.0,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self._timeout = timeout
        self.default_temperature = temperature
        self.default_max_tokens = max_tokens
        self._last_reasoning = ""

    @property
    def model(self) -> str:
        """Default model id used when a call does not override it."""
        return self._model

    @property
    def last_reasoning(self) -> str:
        """Reasoning text accumulated by the most recent call.

        For :meth:`stream` this is only complete once the iterator has been
        exhausted. ``stream()`` yields content deltas only (per the
        :class:`LLMProvider` protocol); reasoning is exposed here instead.
        """
        return self._last_reasoning

    def chat(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> ChatResult:
        payload = self._payload(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=False,
        )
        response = self._post(payload, timeout=timeout)
        data = self._decode(response)
        choice = _first_choice(data)
        message = choice.get("message") or {}
        if not isinstance(message, dict):
            message = {}
        content = message.get("content") or ""
        reasoning = message.get("reasoning_content") or message.get("reasoning") or ""
        self._last_reasoning = str(reasoning)
        return ChatResult(
            content=str(content),
            reasoning=str(reasoning),
            model=str(data.get("model") or payload["model"]),
            usage=_usage(data.get("usage")),
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
        """Yield content deltas; reasoning is buffered in :attr:`last_reasoning`."""
        self._last_reasoning = ""
        for content, reasoning in self.stream_with_reasoning(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=timeout,
        ):
            if reasoning:
                self._last_reasoning += reasoning
            if content:
                yield content

    def stream_with_reasoning(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        timeout: float | None = None,
    ) -> Iterator[tuple[str, str]]:
        """Yield ``(content_delta, reasoning_delta)`` pairs from the SSE stream."""
        self._last_reasoning = ""
        payload = self._payload(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )
        try:
            with httpx.stream(
                "POST",
                self._url(),
                headers=self._headers(),
                json=payload,
                timeout=timeout if timeout is not None else self._timeout,
            ) as response:
                self._raise_for_status(response)
                for line in response.iter_lines():
                    stripped = line.strip()
                    if not stripped or stripped.startswith(":"):
                        continue
                    if not stripped.startswith("data:"):
                        continue
                    payload_text = stripped[len("data:") :].strip()
                    if not payload_text:
                        continue
                    if payload_text == _DONE:
                        break
                    chunk = _loads(payload_text)
                    if chunk is None:
                        continue
                    delta = _first_choice(chunk).get("delta") or {}
                    if not isinstance(delta, dict):
                        delta = {}
                    content = delta.get("content") or ""
                    reasoning = delta.get("reasoning_content") or ""
                    if content or reasoning:
                        yield str(content), str(reasoning)
        except httpx.TimeoutException:
            raise UpstreamTimeoutError("模型服务响应超时") from None
        except httpx.HTTPError:
            raise ProviderError("模型服务连接失败") from None

    def _url(self) -> str:
        return f"{self._base_url}/chat/completions"

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _payload(
        self,
        messages: list[ChatMessage],
        *,
        model: str | None,
        temperature: float | None,
        max_tokens: int | None,
        stream: bool,
    ) -> dict[str, Any]:
        return {
            "model": model or self._model,
            "messages": [{"role": m.role, "content": m.content} for m in messages],
            "temperature": self.default_temperature if temperature is None else temperature,
            "max_tokens": self.default_max_tokens if max_tokens is None else max_tokens,
            "stream": stream,
        }

    def _post(self, payload: dict[str, Any], *, timeout: float | None) -> httpx.Response:
        try:
            return httpx.post(
                self._url(),
                headers=self._headers(),
                json=payload,
                timeout=timeout if timeout is not None else self._timeout,
            )
        except httpx.TimeoutException:
            raise UpstreamTimeoutError("模型服务响应超时") from None
        except httpx.HTTPError:
            raise ProviderError("模型服务连接失败") from None

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        status = response.status_code
        if 200 <= status < 300:
            return
        if status in (401, 403):
            raise ProviderAuthError("模型鉴权失败")
        if status == 429:
            raise ProviderRateLimitError("模型服务限流，请稍后重试")
        if 500 <= status < 600:
            raise ProviderError("模型服务暂时不可用")
        raise ProviderError(f"模型服务返回异常状态 {status}")

    def _decode(self, response: httpx.Response) -> dict[str, Any]:
        self._raise_for_status(response)
        try:
            data = response.json()
        except ValueError:
            raise ProviderError("模型服务返回了无法解析的响应") from None
        if not isinstance(data, dict):
            raise ProviderError("模型服务返回了无法解析的响应")
        return data


def _first_choice(data: dict[str, Any]) -> dict[str, Any]:
    choices = data.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        return choices[0]
    return {}


def _usage(raw: Any) -> dict[str, int] | None:
    if not isinstance(raw, dict):
        return None
    usage = {
        str(key): value
        for key, value in raw.items()
        if isinstance(value, int) and not isinstance(value, bool)
    }
    return usage or None


def _loads(payload: str) -> dict[str, Any] | None:
    try:
        chunk = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(chunk, dict):
        return None
    return chunk
