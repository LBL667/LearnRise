"""FastAPI OCR service (PP-OCR models via RapidOCR/ONNX).

Endpoints:

* ``POST /ocr``     - multipart ``file`` -> blocks / engine / elapsed_ms
* ``GET  /health``  - readiness probe (never loads the model)
* ``POST /convert`` - multipart ``file`` + ``?to=png|jpeg`` -> image bytes
"""

from __future__ import annotations

import asyncio
import time

import anyio
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response

from app import blocks as block_utils
from app import engine, preprocess

OCR_TIMEOUT_SECONDS = 30.0

app = FastAPI(title="learnrise-ocr-service", version="0.1.0")


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=415, detail=detail)


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    if not data:
        raise _bad_request("empty file")
    if len(data) > preprocess.MAX_BYTES:
        raise _bad_request("image exceeds 10MB")
    return data


def _prepare(data: bytes) -> bytes:
    return preprocess.to_jpeg(preprocess.open_image(data))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": engine.engine_name()}


@app.post("/ocr")
async def ocr(file: UploadFile = File(...)) -> dict:
    data = await _read_upload(file)
    try:
        prepared = _prepare(data)
    except preprocess.InvalidImage as exc:
        raise _bad_request(str(exc)) from None

    started = time.perf_counter()
    try:
        raw = await asyncio.wait_for(
            anyio.to_thread.run_sync(engine.run, prepared),
            timeout=OCR_TIMEOUT_SECONDS,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="ocr engine timeout") from None
    except preprocess.InvalidImage as exc:
        raise _bad_request(str(exc)) from None
    result = block_utils.merge_lines(raw)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    return {"blocks": result, "engine": engine.engine_name(), "elapsed_ms": elapsed_ms}


@app.post("/convert")
async def convert(
    file: UploadFile = File(...),
    to: str = Query("png", pattern="^(png|jpeg)$"),
) -> Response:
    data = await _read_upload(file)
    try:
        image = preprocess.open_image(data)
        payload = preprocess.to_bytes(image, to)
    except preprocess.InvalidImage as exc:
        raise _bad_request(str(exc)) from None
    media_type = "image/png" if to == "png" else "image/jpeg"
    return Response(content=payload, media_type=media_type)
