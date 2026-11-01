"""Huawei Cloud handwritten OCR adapter (``RecognizeHandwriting``).

``huaweicloudsdkocr`` is an optional extra and imported lazily so the default
backend image (which deliberately does not install it) imports cleanly; calls
then raise :class:`ProviderError`.  WEBP / HEIC / PDF inputs are converted to
PNG by the OCR service first, because Huawei only accepts
JPEG/JPG/PNG/BMP/TIFF.  Credentials never appear in messages or logs.
"""

from __future__ import annotations

import base64
from typing import Any

import httpx

from app.config import Settings
from app.config import settings as default_settings
from app.ports import OCRBlock, OCRResult
from app.ports.errors import ProviderError, UpstreamTimeoutError

REVIEW_THRESHOLD = 0.6
OCR_REGION = "cn-north-4"

_CONVERT_TYPES = frozenset(
    {"image/webp", "image/heic", "image/heif", "application/pdf", "application/octet-stream"}
)


def _magic_needs_convert(data: bytes) -> bool:
    if data[:4] == b"%PDF":
        return True
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return True
    if data[4:8] == b"ftyp" and data[8:12] in {b"heic", b"heix", b"heif", b"mif1"}:
        return True
    return False


def _load_sdk() -> Any:
    try:
        from huaweicloudsdkcore.auth.credentials import BasicCredentials
        from huaweicloudsdkocr.v1 import (
            HandwritingRequestBody,
            OcrClient,
            RecognizeHandwritingRequest,
        )
        from huaweicloudsdkocr.v1.region.ocr_region import OcrRegion
    except ImportError:
        raise ProviderError("huawei ocr sdk not installed") from None
    return {
        "BasicCredentials": BasicCredentials,
        "HandwritingRequestBody": HandwritingRequestBody,
        "OcrClient": OcrClient,
        "RecognizeHandwritingRequest": RecognizeHandwritingRequest,
        "OcrRegion": OcrRegion,
    }


class HuaweiOCRProvider:
    """Recognise handwriting with Huawei Cloud OCR (cn-north-4)."""

    def __init__(
        self,
        ak: str,
        sk: str,
        project_id: str = "",
        region: str = OCR_REGION,
        *,
        service_url: str = "",
        timeout: float = 30.0,
        client: Any | None = None,
        sdk: Any | None = None,
    ) -> None:
        self._ak = ak
        self._sk = sk
        self._project_id = project_id
        self._region = region or OCR_REGION
        self._service_url = service_url.rstrip("/")
        self._timeout = timeout
        self._client = client
        self._sdk = sdk

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> HuaweiOCRProvider:
        cfg = settings or default_settings
        return cls(
            cfg.huawei_ak,
            cfg.huawei_sk,
            cfg.huawei_project_id,
            cfg.huawei_region,
            service_url=cfg.ocr_service_url,
        )

    def recognize(self, image: bytes, *, content_type: str = "image/jpeg") -> OCRResult:
        if not image:
            raise ProviderError("empty image")
        sdk = self._sdk or _load_sdk()
        client = self._client or self._build_client(sdk)

        payload = image
        if self._needs_convert(image, content_type):
            payload = self._convert(image, content_type)
        encoded = base64.b64encode(payload).decode("ascii")

        body = sdk["HandwritingRequestBody"](image=encoded, detect_direction=True)
        request = sdk["RecognizeHandwritingRequest"](body=body)
        try:
            response = client.recognize_handwriting(request)
        except ProviderError:
            raise
        except Exception as exc:  # noqa: BLE001 - SDK raises vendor exceptions
            raise ProviderError(f"huawei ocr failed: {type(exc).__name__}") from None
        return OCRResult(blocks=self._parse(response))

    def _build_client(self, sdk: Any) -> Any:
        if not self._ak or not self._sk:
            raise ProviderError("huawei ak/sk not configured")
        credentials = sdk["BasicCredentials"](self._ak, self._sk)
        if self._project_id:
            credentials = credentials.with_project_id(self._project_id)
        return sdk["OcrClient"].new_builder().with_credentials(credentials).with_region(
            sdk["OcrRegion"].value_of(self._region)
        ).build()

    def _needs_convert(self, image: bytes, content_type: str) -> bool:
        return (content_type or "").lower() in _CONVERT_TYPES or _magic_needs_convert(image)

    def _convert(self, image: bytes, content_type: str) -> bytes:
        if not self._service_url:
            raise ProviderError("ocr convert service not configured")
        url = f"{self._service_url}/convert"
        files = {"file": ("upload.bin", image, content_type or "application/octet-stream")}
        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(url, params={"to": "png"}, files=files)
        except httpx.TimeoutException:
            raise UpstreamTimeoutError("ocr convert service timeout") from None
        except httpx.HTTPError as exc:
            raise ProviderError(f"ocr convert failed: {type(exc).__name__}") from None
        if response.status_code >= 400:
            raise ProviderError(f"ocr convert service error: {response.status_code}")
        if not response.content:
            raise ProviderError("ocr convert service returned empty image")
        return response.content

    @staticmethod
    def _parse(response: Any) -> list[OCRBlock]:
        result = getattr(response, "result", None)
        if result is None:
            raise ProviderError("huawei ocr returned no result")
        blocks: list[OCRBlock] = []
        for item in getattr(result, "words_block_list", None) or []:
            text = str(getattr(item, "words", "") or "").strip()
            if not text:
                continue
            try:
                confidence = float(getattr(item, "confidence", 0.0) or 0.0)
            except (TypeError, ValueError):
                confidence = 0.0
            location = getattr(item, "location", None)
            box = None
            if isinstance(location, list) and location:
                box = [[float(point[0]), float(point[1])] for point in location]
            blocks.append(
                OCRBlock(
                    text=text,
                    confidence=confidence,
                    box=box,
                    needs_review=confidence < REVIEW_THRESHOLD,
                )
            )
        return blocks
