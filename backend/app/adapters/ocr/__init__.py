"""OCR adapters: local Paddle/RapidOCR service and Huawei Cloud handwriting."""

from __future__ import annotations

from app.adapters.ocr.factory import build_ocr
from app.adapters.ocr.huawei import HuaweiOCRProvider
from app.adapters.ocr.paddle import PaddleOCRProvider

__all__ = ["HuaweiOCRProvider", "PaddleOCRProvider", "build_ocr"]
