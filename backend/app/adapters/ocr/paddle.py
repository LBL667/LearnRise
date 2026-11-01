"""Paddle/RapidOCR service adapter.

The heavy OCR engine lives in the standalone ``ocr-service`` container; this
adapter is a thin HTTP client.  It never imports Pillow or PaddleOCR and never
propagates upstream response bodies (they can contain the uploaded image
text) in exception messages.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.ports import OCRBlock, OCRResult
from app.ports.errors import ProviderError, UpstreamTimeoutError

REVIEW_THRESHOLD = 0.6


def _suffix(content_type: str) -> str:
    subtype = (content_type or "image/jpeg").split("/")[-1].lower()
    return {"jpeg": "jpg", "jpg": "jpg", "png": "png", "bmp": "bmp", "tiff": "tiff"}.get(
        subtype, "bin"
    )


def _parse_blocks(payload: Any) -> list[OCRBlock]:
    if not isinstance(payload, dict):
        raise ProviderError("ocr service returned invalid payload")
    raw_blocks = payload.get("blocks")
    if not isinstance(raw_blocks, list):
        raise ProviderError("ocr service returned invalid payload")
    blocks: list[OCRBlock] = []
    for item in raw_blocks:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        try:
            confidence = float(item.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        needs_review = item.get("needs_review")
        if needs_review is None:
            needs_review = confidence < REVIEW_THRESHOLD
        box = item.get("box")
        blocks.append(
            OCRBlock(
                text=text,
                confidence=confidence,
                box=box if isinstance(box, list) else None,
                needs_review=bool(needs_review),
            )
        )
    return blocks


class PaddleOCRProvider:
    """Recognise text through the local ``POST /ocr`` service."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not base_url:
            raise ProviderError("ocr service url not configured")
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client = client

    def recognize(self, image: bytes, *, content_type: str = "image/jpeg") -> OCRResult:
        if not image:
            raise ProviderError("empty image")
        url = f"{self._base_url}/ocr"
        files = {"file": (f"upload.{_suffix(content_type)}", image, content_type)}
        try:
            if self._client is not None:
                response = self._client.post(url, files=files, timeout=self._timeout)
            else:
                with httpx.Client(timeout=self._timeout) as client:
                    response = client.post(url, files=files)
        except httpx.TimeoutException:
            raise UpstreamTimeoutError("ocr service timeout") from None
        except httpx.HTTPError as exc:
            raise ProviderError(f"ocr service request failed: {type(exc).__name__}") from None

        if response.status_code in {413, 415, 422}:
            raise ProviderError("unsupported image format")
        if response.status_code >= 400:
            raise ProviderError(f"ocr service error: {response.status_code}")
        try:
            payload = response.json()
        except ValueError:
            raise ProviderError("ocr service returned invalid json") from None
        return OCRResult(blocks=_parse_blocks(payload), raw=payload)
