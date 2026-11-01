"""Contract tests for the OCR adapters (no network, no vendor SDK)."""

from __future__ import annotations

import base64
import builtins
from types import SimpleNamespace

import httpx
import pytest
import respx

from app.adapters.ocr import HuaweiOCRProvider, PaddleOCRProvider, build_ocr
from app.config import Settings
from app.ports import OCRProvider
from app.ports.errors import ProviderError

SERVICE = "http://ocr.test:8001"
OCR_URL = f"{SERVICE}/ocr"
CONVERT_URL = f"{SERVICE}/convert"

PNG_BYTES = b"\x89PNG\r\n\x1a\n-converted-png-body"
WEBP_BYTES = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


def _box(x: int) -> list[list[float]]:
    return [[x, 0.0], [x + 40.0, 0.0], [x + 40.0, 18.0], [x, 18.0]]


def ocr_payload(*blocks: dict) -> dict:
    return {"blocks": list(blocks), "engine": "rapidocr-onnxruntime", "elapsed_ms": 12.5}


def block(text: str, confidence: float, needs_review: bool) -> dict:
    return {
        "text": text,
        "confidence": confidence,
        "box": _box(0),
        "needs_review": needs_review,
    }


@respx.mock
def test_paddle_happy_path() -> None:
    route = respx.post(OCR_URL).mock(
        return_value=httpx.Response(
            200,
            json=ocr_payload(block("第一行", 0.9, False), block("第二行", 0.42, True)),
        )
    )
    provider = PaddleOCRProvider(SERVICE)

    result = provider.recognize(b"fake-png", content_type="image/png")

    assert isinstance(provider, OCRProvider)
    assert [item.text for item in result.blocks] == ["第一行", "第二行"]
    assert result.blocks[0].confidence == pytest.approx(0.9)
    assert result.blocks[1].confidence == pytest.approx(0.42)
    assert result.blocks[1].needs_review is True
    assert result.blocks[1].box == _box(0)
    request = route.calls.last.request
    assert request.headers["content-type"].startswith("multipart/form-data")


@respx.mock
def test_low_confidence_is_flagged_when_server_omits_flag() -> None:
    payload = ocr_payload(
        {"text": "高置信", "confidence": 0.93, "box": _box(0)},
        {"text": "低置信", "confidence": 0.42, "box": _box(0)},
    )
    respx.post(OCR_URL).mock(return_value=httpx.Response(200, json=payload))

    result = PaddleOCRProvider(SERVICE).recognize(b"fake-png")

    assert result.blocks[0].needs_review is False
    assert result.blocks[1].needs_review is True


@respx.mock
def test_unsupported_format_maps_415_to_provider_error() -> None:
    respx.post(OCR_URL).mock(
        return_value=httpx.Response(415, json={"detail": "unsupported image format"})
    )

    with pytest.raises(ProviderError, match="unsupported image format"):
        PaddleOCRProvider(SERVICE).recognize(WEBP_BYTES, content_type="image/webp")


@respx.mock
def test_service_500_is_generic_provider_error() -> None:
    respx.post(OCR_URL).mock(return_value=httpx.Response(500, text="internal secret dump"))

    with pytest.raises(ProviderError) as excinfo:
        PaddleOCRProvider(SERVICE).recognize(b"fake-png")

    message = str(excinfo.value)
    assert "500" in message
    assert "secret" not in message


@respx.mock
def test_service_timeout_is_provider_error() -> None:
    respx.post(OCR_URL).mock(side_effect=httpx.ConnectTimeout("boom"))

    with pytest.raises(ProviderError):
        PaddleOCRProvider(SERVICE, timeout=0.01).recognize(b"fake-png")


def test_huawei_missing_sdk(monkeypatch: pytest.MonkeyPatch) -> None:
    real_import = builtins.__import__

    def fake_import(name: str, *args, **kwargs):
        if name.startswith("huaweicloudsdk"):
            raise ImportError(name)
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    provider = HuaweiOCRProvider("ak-test", "sk-test", "project-test")

    with pytest.raises(ProviderError, match="huawei ocr sdk not installed"):
        provider.recognize(b"\x89PNG\r\n\x1a\nimage")


def _fake_sdk() -> dict:
    class Body:
        def __init__(self, **kwargs) -> None:
            self.__dict__.update(kwargs)

    class Request:
        def __init__(self, body) -> None:
            self.body = body

    return {"HandwritingRequestBody": Body, "RecognizeHandwritingRequest": Request}


class FakeOcrClient:
    def __init__(self) -> None:
        self.requests: list = []

    def recognize_handwriting(self, request):
        self.requests.append(request)
        word = SimpleNamespace(
            words="板书内容",
            confidence=0.55,
            location=[[10, 20], [110, 20], [110, 40], [10, 40]],
        )
        return SimpleNamespace(result=SimpleNamespace(words_block_list=[word]))


@respx.mock
def test_huawei_webp_converted_then_recognized() -> None:
    convert = respx.post(CONVERT_URL).mock(
        return_value=httpx.Response(200, content=PNG_BYTES, headers={"content-type": "image/png"})
    )
    client = FakeOcrClient()
    provider = HuaweiOCRProvider(
        "ak-test",
        "sk-test",
        "project-test",
        service_url=SERVICE,
        client=client,
        sdk=_fake_sdk(),
    )

    result = provider.recognize(WEBP_BYTES, content_type="image/webp")

    assert convert.called
    assert convert.calls.last.request.url.params["to"] == "png"
    assert len(client.requests) == 1
    body = client.requests[0].body
    assert base64.b64decode(body.image) == PNG_BYTES
    assert body.detect_direction is True
    assert [item.text for item in result.blocks] == ["板书内容"]
    assert result.blocks[0].needs_review is True
    assert result.blocks[0].box == [[10.0, 20.0], [110.0, 20.0], [110.0, 40.0], [10.0, 40.0]]


@respx.mock
def test_huawei_jpeg_skips_conversion() -> None:
    convert = respx.post(CONVERT_URL).mock(return_value=httpx.Response(200, content=b"x"))
    client = FakeOcrClient()
    provider = HuaweiOCRProvider(
        "ak-test", "sk-test", service_url=SERVICE, client=client, sdk=_fake_sdk()
    )

    provider.recognize(b"\xff\xd8\xff\xe0jpeg-body", content_type="image/jpeg")

    assert not convert.called
    body = client.requests[0].body
    assert base64.b64decode(body.image) == b"\xff\xd8\xff\xe0jpeg-body"


def test_factory_selects_paddle_by_default() -> None:
    provider = build_ocr(Settings(ocr_provider="paddle", ocr_service_url=SERVICE))

    assert isinstance(provider, PaddleOCRProvider)


def test_factory_selects_huawei() -> None:
    provider = build_ocr(
        Settings(
            ocr_provider="huawei",
            ocr_service_url=SERVICE,
            huawei_ak="ak-test",
            huawei_sk="sk-test",
            huawei_region="cn-north-4",
        )
    )

    assert isinstance(provider, HuaweiOCRProvider)


def test_factory_blank_defaults_to_paddle() -> None:
    provider = build_ocr(Settings(ocr_provider="", ocr_service_url=SERVICE))

    assert isinstance(provider, PaddleOCRProvider)


def test_factory_rejects_unknown_provider() -> None:
    with pytest.raises(ProviderError, match="unsupported ocr provider"):
        build_ocr(Settings(ocr_provider="tesseract", ocr_service_url=SERVICE))
