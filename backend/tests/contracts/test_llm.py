from __future__ import annotations

import json

import httpx
import pytest
import respx

from app.adapters.llm import FallbackLLM, MaasLLM, OpenAICompatibleLLM, build_llm
from app.config import Settings
from app.ports import ChatMessage, LLMProvider
from app.ports.errors import ProviderAuthError, UpstreamTimeoutError

BASE_URL = "https://llm.primary.test/v1"
FALLBACK_URL = "https://llm.fallback.test/v1"
API_KEY = "sk-test-secret-key-0123456789"
ENDPOINT = f"{BASE_URL}/chat/completions"
FALLBACK_ENDPOINT = f"{FALLBACK_URL}/chat/completions"
MAAS_ENDPOINT = "https://api.modelarts-maas.com/openai/v1/chat/completions"

MESSAGES = [
    ChatMessage(role="system", content="be brief"),
    ChatMessage(role="user", content="hi"),
]


def make_llm(base_url: str = BASE_URL, api_key: str = API_KEY) -> OpenAICompatibleLLM:
    return OpenAICompatibleLLM(base_url, api_key, "test-model", timeout=3.0)


def chat_payload(content: str, *, model: str = "test-model-2024") -> dict:
    return {
        "id": "chatcmpl-1",
        "object": "chat.completion",
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                    "reasoning_content": "想一想",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8},
    }


def sse_body(lines: list[str]) -> str:
    return "".join(f"{line}\n\n" for line in lines)


@respx.mock
def test_chat_ok() -> None:
    route = respx.post(ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("你好"))
    )

    result = make_llm().chat(MESSAGES)

    assert result.content == "你好"
    assert result.reasoning == "想一想"
    assert result.model == "test-model-2024"
    assert result.usage == {"prompt_tokens": 3, "completion_tokens": 5, "total_tokens": 8}
    request = route.calls.last.request
    body = json.loads(request.content)
    assert body["model"] == "test-model"
    assert body["stream"] is False
    assert body["temperature"] == 0.7
    assert body["max_tokens"] == 2048
    assert body["messages"] == [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi"},
    ]
    assert request.headers["authorization"] == f"Bearer {API_KEY}"


@respx.mock
def test_chat_overrides_are_forwarded() -> None:
    route = respx.post(ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("ok"))
    )

    make_llm().chat(MESSAGES, model="other-model", temperature=0.1, max_tokens=16)

    body = json.loads(route.calls.last.request.content)
    assert body["model"] == "other-model"
    assert body["temperature"] == 0.1
    assert body["max_tokens"] == 16


@respx.mock
def test_stream_frames() -> None:
    body = sse_body(
        [
            'data: {"choices":[{"delta":{"reasoning_content":"暗想"}}]}',
            'data: {"choices":[{"delta":{"content":"你"}}]}',
            'data: {"choices":[{"delta":{"content":"好"}}]}',
            ": keepalive",
            'data: {"choices":[{"delta":{"content":"！"}}]}',
            "data: [DONE]",
            'data: {"choices":[{"delta":{"content":"should-not-appear"}}]}',
        ]
    )
    route = respx.post(ENDPOINT).mock(return_value=httpx.Response(200, text=body))
    llm = make_llm()

    deltas = list(llm.stream(MESSAGES))

    assert len(deltas) >= 3
    assert "".join(deltas) == "你好！"
    assert llm.last_reasoning == "暗想"
    assert json.loads(route.calls.last.request.content)["stream"] is True


@respx.mock
def test_stream_reasoning_split() -> None:
    body = sse_body(
        [
            'data: {"choices":[{"delta":{"reasoning_content":"secret-thought"}}]}',
            'data: {"choices":[{"delta":{"content":"an"}}]}',
            'data: {"choices":[{"delta":{"content":"swer"}}]}',
            "data: [DONE]",
        ]
    )
    respx.post(ENDPOINT).mock(return_value=httpx.Response(200, text=body))
    llm = make_llm()

    deltas = list(llm.stream(MESSAGES))

    assert deltas == ["an", "swer"]
    assert all("secret-thought" not in delta for delta in deltas)
    assert llm.last_reasoning == "secret-thought"


@respx.mock
def test_fallback_on_429() -> None:
    primary_route = respx.post(ENDPOINT).mock(
        side_effect=[
            httpx.Response(429),
            httpx.Response(429),
            httpx.Response(500, text="upstream exploded"),
        ]
    )
    fallback_route = respx.post(FALLBACK_ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("fallback answer"))
    )
    llm = FallbackLLM(make_llm(), make_llm(FALLBACK_URL), backoff_base=0.0)

    result = llm.chat(MESSAGES)

    assert result.content == "fallback answer"
    assert primary_route.call_count == 3
    assert fallback_route.call_count == 1


@respx.mock
def test_fallback_recovers_on_retry() -> None:
    primary_route = respx.post(ENDPOINT).mock(
        side_effect=[httpx.Response(429), httpx.Response(200, json=chat_payload("ok"))]
    )
    fallback_route = respx.post(FALLBACK_ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("fallback"))
    )
    llm = FallbackLLM(make_llm(), make_llm(FALLBACK_URL), backoff_base=0.0)

    assert llm.chat(MESSAGES).content == "ok"
    assert primary_route.call_count == 2
    assert fallback_route.call_count == 0


@respx.mock
def test_auth_error_does_not_fall_back() -> None:
    primary_route = respx.post(ENDPOINT).mock(return_value=httpx.Response(401))
    fallback_route = respx.post(FALLBACK_ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("fallback"))
    )
    llm = FallbackLLM(make_llm(), make_llm(FALLBACK_URL), backoff_base=0.0)

    with pytest.raises(ProviderAuthError):
        llm.chat(MESSAGES)

    assert primary_route.call_count == 1
    assert fallback_route.call_count == 0


@respx.mock
def test_timeout_raises() -> None:
    respx.post(ENDPOINT).mock(side_effect=httpx.ConnectTimeout("timed out"))

    with pytest.raises(UpstreamTimeoutError):
        make_llm().chat(MESSAGES)


@respx.mock
def test_timeout_stream_raises() -> None:
    respx.post(ENDPOINT).mock(side_effect=httpx.ReadTimeout("slow"))

    with pytest.raises(UpstreamTimeoutError):
        list(make_llm().stream(MESSAGES))


@respx.mock
def test_auth_error_no_key_leak() -> None:
    respx.post(ENDPOINT).mock(
        return_value=httpx.Response(
            403, json={"error": {"message": f"bad key {API_KEY}", "code": "forbidden"}}
        )
    )

    with pytest.raises(ProviderAuthError) as excinfo:
        make_llm().chat(MESSAGES)

    message = str(excinfo.value)
    assert API_KEY not in message
    assert "模型鉴权失败" in message


@respx.mock
def test_empty_response() -> None:
    respx.post(ENDPOINT).mock(
        return_value=httpx.Response(200, json={"model": "m", "choices": []})
    )

    result = make_llm().chat(MESSAGES)

    assert result.content == ""
    assert result.reasoning == ""
    assert result.model == "m"
    assert result.usage is None


@respx.mock
def test_empty_content_no_crash() -> None:
    respx.post(ENDPOINT).mock(
        return_value=httpx.Response(
            200, json={"model": "m", "choices": [{"message": {"content": ""}}]}
        )
    )

    assert make_llm().chat(MESSAGES).content == ""


@respx.mock
def test_maas_preset_defaults() -> None:
    route = respx.post(MAAS_ENDPOINT).mock(
        return_value=httpx.Response(200, json=chat_payload("maas", model="deepseek-v4.1-flash"))
    )
    llm = MaasLLM(api_key=API_KEY)

    result = llm.chat(MESSAGES)

    assert isinstance(llm, LLMProvider)
    assert llm.model == "deepseek-v4.1-flash"
    assert result.content == "maas"
    assert json.loads(route.calls.last.request.content)["model"] == "deepseek-v4.1-flash"


def test_build_llm_plain_provider() -> None:
    settings = Settings(
        provider_profile="local",
        llm_provider="openai_compatible",
        llm_base_url=BASE_URL,
        llm_api_key=API_KEY,
        llm_model="test-model",
        llm_fallback_base_url="",
        llm_fallback_api_key="",
        llm_fallback_model="",
    )

    llm = build_llm(settings)

    assert isinstance(llm, OpenAICompatibleLLM)
    assert not isinstance(llm, FallbackLLM)
    assert llm.model == "test-model"


def test_build_llm_wraps_fallback() -> None:
    settings = Settings(
        provider_profile="local",
        llm_provider="openai_compatible",
        llm_base_url=BASE_URL,
        llm_api_key=API_KEY,
        llm_model="test-model",
        llm_fallback_base_url=FALLBACK_URL,
        llm_fallback_api_key="sk-fallback",
        llm_fallback_model="",
    )

    llm = build_llm(settings)

    assert isinstance(llm, FallbackLLM)
    assert llm._fallback is not None
    assert llm._fallback.model == "test-model"


def test_build_llm_maas_provider() -> None:
    settings = Settings(
        provider_profile="huawei",
        llm_provider="maas",
        llm_base_url="",
        llm_api_key=API_KEY,
        llm_fallback_base_url="",
    )

    llm = build_llm(settings)

    assert isinstance(llm, MaasLLM)


def test_build_llm_maas_from_profile() -> None:
    settings = Settings(
        provider_profile="huawei",
        llm_provider="",
        llm_base_url="",
        llm_api_key=API_KEY,
        llm_fallback_base_url="",
    )

    assert isinstance(build_llm(settings), MaasLLM)
