"""Optical character recognition port."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.ports.types import OCRResult


@runtime_checkable
class OCRProvider(Protocol):
    """Image to text backend (PaddleOCR service, Huawei OCR, ...)."""

    def recognize(self, image: bytes, *, content_type: str = "image/jpeg") -> OCRResult:
        """Extract text blocks from ``image``."""
        ...
