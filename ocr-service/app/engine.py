"""Lazy OCR engine singleton.

The engine is built on the first ``/ocr`` request and cached behind a lock so
container start stays fast (``/health`` never pays for model loading).
"""

from __future__ import annotations

import threading
from typing import Any

ENGINE_NAME = "rapidocr-onnxruntime"

_engine: Any | None = None
_lock = threading.Lock()


def get_engine() -> Any:
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                from rapidocr_onnxruntime import RapidOCR

                _engine = RapidOCR()
    return _engine


def run(data: bytes) -> list[tuple[Any, str, float]]:
    """Return raw ``(box, text, confidence)`` triples for ``data``."""
    engine = get_engine()
    result, _elapse = engine(data)
    triples: list[tuple[Any, str, float]] = []
    for item in result or []:
        if len(item) < 3:
            continue
        box, text, score = item[0], item[1], item[2]
        text = str(text).strip()
        if not text:
            continue
        triples.append((box, text, float(score)))
    return triples


def engine_name() -> str:
    return ENGINE_NAME
