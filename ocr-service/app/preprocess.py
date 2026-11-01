"""Image normalisation shared by ``/ocr`` and ``/convert``.

Everything here is Pillow-only so the service can validate and normalise an
upload before it reaches the OCR engine.  The backend never imports Pillow:
image conversion for Huawei OCR happens through ``POST /convert``.
"""

from __future__ import annotations

import io

from PIL import Image, ImageOps

__all__ = [
    "MAX_BYTES",
    "MAX_SIDE",
    "MIN_SIDE",
    "LONG_EDGE",
    "InvalidImage",
    "open_image",
    "to_bytes",
    "to_jpeg",
]

MAX_BYTES = 10 * 1024 * 1024
MIN_SIDE = 15
MAX_SIDE = 8192
LONG_EDGE = 4000
JPEG_QUALITY = 85

_ALLOWED_FORMATS = frozenset({"png", "jpeg", "jpg", "bmp", "tiff"})
_OUTPUT_FORMATS = {"png": "PNG", "jpeg": "JPEG"}


class InvalidImage(ValueError):
    """Raised when an upload is not a supported image."""


def open_image(data: bytes) -> Image.Image:
    """Validate, orient and downscale an image.

    Raises :class:`InvalidImage` for anything the service does not accept:

    * empty payload / > 10 MB
    * format outside png / jpg / jpeg / bmp / tiff
    * either side outside 15..8192 px (checked before the long-edge resize)
    """

    if not data:
        raise InvalidImage("empty file")
    if len(data) > MAX_BYTES:
        raise InvalidImage("image exceeds 10MB")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001 - Pillow raises many concrete types
        raise InvalidImage("unsupported image format") from None
    if (image.format or "").lower() not in _ALLOWED_FORMATS:
        raise InvalidImage("unsupported image format")

    image = ImageOps.exif_transpose(image)
    width, height = image.size
    if min(width, height) < MIN_SIDE:
        raise InvalidImage("image too small")
    if max(width, height) > MAX_SIDE:
        raise InvalidImage("image too large")
    if max(width, height) > LONG_EDGE:
        ratio = LONG_EDGE / max(width, height)
        image = image.resize(
            (max(1, round(width * ratio)), max(1, round(height * ratio))),
            Image.LANCZOS,
        )
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def to_bytes(image: Image.Image, target: str) -> bytes:
    """Encode ``image`` as ``target`` (``png`` or ``jpeg``)."""
    fmt = _OUTPUT_FORMATS.get(target.lower())
    if fmt is None:
        raise InvalidImage(f"unsupported target format: {target}")
    buffer = io.BytesIO()
    if fmt == "JPEG":
        image.convert("RGB").save(buffer, format=fmt, quality=JPEG_QUALITY)
    else:
        image.save(buffer, format=fmt)
    return buffer.getvalue()


def to_jpeg(image: Image.Image) -> bytes:
    """Encode the engine input as JPEG q85 (the documented preprocessing)."""
    return to_bytes(image, "jpeg")
