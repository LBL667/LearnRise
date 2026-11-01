"""Select an OCR backend from ``OCR_PROVIDER``."""

from __future__ import annotations

from app.adapters.ocr.huawei import HuaweiOCRProvider
from app.adapters.ocr.paddle import PaddleOCRProvider
from app.config import Settings, get_settings
from app.ports import OCRProvider
from app.ports.errors import ProviderError


def build_ocr(settings: Settings | None = None) -> OCRProvider:
    """Return the OCR adapter configured by ``settings`` (default ``paddle``)."""
    cfg = settings or get_settings()
    provider = (cfg.ocr_provider or "paddle").strip().lower()
    if provider == "paddle":
        return PaddleOCRProvider(cfg.ocr_service_url)
    if provider == "huawei":
        return HuaweiOCRProvider(
            cfg.huawei_ak,
            cfg.huawei_sk,
            cfg.huawei_project_id,
            cfg.huawei_region,
            service_url=cfg.ocr_service_url,
        )
    raise ProviderError(f"unsupported ocr provider: {provider}")
