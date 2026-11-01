"""Build the LLM chain from application settings."""

from __future__ import annotations

from app.adapters.llm.fallback import FallbackLLM
from app.adapters.llm.maas import MaasLLM
from app.adapters.llm.mock import MODEL_NAME as MOCK_DEFAULT_MODEL
from app.adapters.llm.mock import MockLLM
from app.adapters.llm.openai_compatible import OpenAICompatibleLLM
from app.config import Settings, get_settings
from app.ports import LLMProvider

MAAS_PROVIDERS = frozenset({"maas", "modelarts", "modelarts_maas", "huawei", "huawei_maas"})
MOCK_PROVIDERS = frozenset({"mock", "offline"})


def _resolve_provider(settings: Settings) -> str:
    provider = (settings.llm_provider or "").strip().lower()
    if provider:
        return provider
    if (settings.provider_profile or "").strip().lower() == "huawei":
        return "maas"
    return "openai_compatible"


def _build_primary(settings: Settings) -> OpenAICompatibleLLM:
    if _resolve_provider(settings) in MAAS_PROVIDERS:
        return MaasLLM(
            api_key=settings.llm_api_key,
            model=settings.llm_model or None,
            base_url=settings.llm_base_url or None,
            timeout=settings.llm_timeout_seconds,
            temperature=settings.llm_temperature,
            max_tokens=settings.llm_max_tokens,
        )
    return OpenAICompatibleLLM(
        settings.llm_base_url,
        settings.llm_api_key,
        settings.llm_model,
        timeout=settings.llm_timeout_seconds,
        temperature=settings.llm_temperature,
        max_tokens=settings.llm_max_tokens,
    )


def build_llm(settings: Settings | None = None) -> LLMProvider:
    """Return the primary provider, wrapped in :class:`FallbackLLM` when configured.

    The ``llm_provider`` field wins; when it is blank the provider profile picks
    the default (``huawei`` -> ModelArts MaaS, anything else ->
    OpenAI-compatible).
    """
    cfg = settings if settings is not None else get_settings()
    if _resolve_provider(cfg) in MOCK_PROVIDERS:
        # The offline demo provider is a terminal choice: no network, no fallback.
        return MockLLM(model=cfg.llm_model or MOCK_DEFAULT_MODEL)
    primary = _build_primary(cfg)
    if not cfg.llm_fallback_base_url:
        return primary
    fallback = OpenAICompatibleLLM(
        cfg.llm_fallback_base_url,
        cfg.llm_fallback_api_key,
        cfg.llm_fallback_model or primary.model,
        timeout=cfg.llm_timeout_seconds,
        temperature=cfg.llm_temperature,
        max_tokens=cfg.llm_max_tokens,
    )
    return FallbackLLM(primary, fallback)
