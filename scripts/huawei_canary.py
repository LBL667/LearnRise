#!/usr/bin/env python3
"""Huawei Cloud canary spike CLI (plan task 5).

Runs five independent probes against Huawei Cloud managed services and prints
exactly one JSON line per probe::

    {"canary": ..., "status": "PASS|FAIL|BLOCKED", "latency_ms": ...,
     "region": ..., "detail": {...}}

Exit codes:
    0  every requested canary PASSed
    1  at least one canary FAILed (real service/contract error)
    2  at least one canary was BLOCKED (env vars or optional SDK missing)

Nothing here is mocked. A canary is only ``PASS`` when a real HTTP response,
database query, object round-trip or OCR result satisfied the assertion.
Missing prerequisites produce ``BLOCKED`` plus the exact env var / package
names that would unblock it.

Secrets are never printed: credential values from the environment and the RDS
password embedded in ``RDS_URL`` are replaced by ``***`` in every detail
string (including request URLs and exception messages).

Optional SDKs (``esdk-obs-python`` / ``huaweicloudsdkocr``) are imported
lazily inside the canaries, so this module imports cleanly with the default
install. Install them with::

    pip install ".[huawei]"

Runbook: ``docs/huawei-canary.md``.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import random
import re
import struct
import sys
import tempfile
import threading
import time
import zlib
from pathlib import Path
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parents[1]

STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_BLOCKED = "BLOCKED"

DEFAULT_MAAS_BASE_URL = "https://api.modelarts-maas.com/openai/v1"
DEFAULT_MAAS_REGION = "cn-southwest-2"
DEFAULT_HUAWEI_REGION = "cn-north-4"
MAAS_CHAT_MODEL = "deepseek-v4.1-flash"
MAAS_EMBED_MODEL = "bge-m3"
MAAS_EMBED_DIM = 1024
OCR_MODEL = "RecognizeHandwriting"
OCR_REGION_DEFAULT = "cn-north-4"
OCR_MAX_BYTES = 10 * 1024 * 1024
OCR_DEFAULT_IMAGE = REPO_ROOT / "fixtures" / "board.jpg"

_SECRET_ENV_VARS = (
    "MAAS_API_KEY",
    "HUAWEI_AK",
    "HUAWEI_SK",
    "OBS_ACCESS_KEY_ID",
    "OBS_SECRET_ACCESS_KEY",
)
_URL_USERINFO = re.compile(r"(?<=://)[^/@\s]+(?=@)")



def env(name: str, default: str | None = None) -> str | None:
    raw = os.environ.get(name)
    if raw is None:
        return default
    raw = raw.strip()
    return raw or default


def _rds_dsn(raw: str) -> str:
    return raw.replace("postgresql+psycopg://", "postgresql://").replace(
        "postgresql+asyncpg://", "postgresql://"
    )


def _rds_password(raw: str | None) -> str | None:
    if not raw:
        return None
    try:
        return urlsplit(_rds_dsn(raw)).password
    except ValueError:
        return None


def _secret_values() -> list[str]:
    values: list[str] = []
    for name in _SECRET_ENV_VARS:
        value = env(name)
        if value and len(value) >= 4:
            values.append(value)
    password = _rds_password(env("RDS_URL"))
    if password and len(password) >= 2:
        values.append(password)
    return sorted(set(values), key=len, reverse=True)


def _scrub(text: str, secrets: list[str]) -> str:
    for secret in secrets:
        text = text.replace(secret, "***")
    return _URL_USERINFO.sub("***", text)


def _redact_value(value: object, secrets: list[str]) -> object:
    if isinstance(value, str):
        return _scrub(value, secrets)
    if isinstance(value, dict):
        return {key: _redact_value(item, secrets) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_value(item, secrets) for item in value]
    return value



def _ms(started: float) -> int:
    return int(round((time.perf_counter() - started) * 1000))


def _blocked(
    region: str,
    *,
    reason: str,
    missing_env: list[str] | None = None,
    missing_sdk: str | None = None,
    extra: dict[str, object] | None = None,
) -> dict[str, object]:
    detail: dict[str, object] = {"reason": reason}
    if missing_env:
        detail["missing_env"] = sorted(missing_env)
    if missing_sdk:
        detail["missing_sdk"] = missing_sdk
    if extra:
        detail.update(extra)
    return {"status": STATUS_BLOCKED, "region": region, "latency_ms": 0, "detail": detail}


def _fail(region: str, latency_ms: int, reason: str, **extra: object) -> dict[str, object]:
    detail: dict[str, object] = {"reason": reason}
    detail.update({key: value for key, value in extra.items() if value is not None})
    return {"status": STATUS_FAIL, "region": region, "latency_ms": latency_ms, "detail": detail}


def _pass(region: str, latency_ms: int, detail: dict[str, object]) -> dict[str, object]:
    return {"status": STATUS_PASS, "region": region, "latency_ms": latency_ms, "detail": detail}


def _body_preview(text: str | None, limit: int = 400) -> str:
    if not text:
        return ""
    compact = " ".join(text.split())
    return compact[:limit]


def _vec_literal(values: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in values) + "]"


def _strip_query(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}{parts.path}"



def canary_maas_chat(timeout: float, _ctx: dict[str, object]) -> dict[str, object]:
    region = env("MAAS_REGION", DEFAULT_MAAS_REGION) or DEFAULT_MAAS_REGION
    base = (env("MAAS_BASE_URL", DEFAULT_MAAS_BASE_URL) or DEFAULT_MAAS_BASE_URL).rstrip("/")
    endpoint = f"{base}/chat/completions"
    api_key = env("MAAS_API_KEY")
    if not api_key:
        return _blocked(
            region,
            reason="MAAS_API_KEY is not set (MaaS is only offered in cn-southwest-2)",
            missing_env=["MAAS_API_KEY"],
            extra={"endpoint": endpoint, "model": MAAS_CHAT_MODEL},
        )

    try:
        import httpx
    except ImportError:
        return _blocked(region, reason="httpx is not installed", missing_sdk="httpx")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    chat_payload = {
        "model": MAAS_CHAT_MODEL,
        "messages": [{"role": "user", "content": "ping: reply with one short word"}],
        "temperature": 0,
        "max_tokens": 16,
        "stream": False,
    }
    stream_payload = {**chat_payload, "stream": True}

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint, headers=headers, json=chat_payload)
    except httpx.HTTPError as exc:
        return _fail(
            region,
            _ms(started),
            f"chat request failed: {type(exc).__name__}: {exc}",
            endpoint=endpoint,
        )

    if response.status_code != 200:
        return _fail(
            region,
            _ms(started),
            f"chat HTTP {response.status_code}",
            endpoint=endpoint,
            model=MAAS_CHAT_MODEL,
            body=_body_preview(response.text),
        )
    try:
        payload = response.json()
    except ValueError:
        return _fail(region, _ms(started), "chat response is not JSON", endpoint=endpoint)

    choices = payload.get("choices") or []
    content = ""
    if choices and isinstance(choices[0], dict):
        message = choices[0].get("message") or {}
        content = str(message.get("content") or "").strip()
    if not content:
        return _fail(
            region,
            _ms(started),
            "chat responded 200 but the first choice has empty content",
            endpoint=endpoint,
            model=MAAS_CHAT_MODEL,
        )
    chat_ms = _ms(started)

    stream_started = time.perf_counter()
    first_token_ms: int | None = None
    streamed_chars = 0
    try:
        with httpx.Client(timeout=timeout) as client:
            with client.stream("POST", endpoint, headers=headers, json=stream_payload) as stream:
                if stream.status_code != 200:
                    return _fail(
                        region,
                        _ms(started),
                        f"stream chat HTTP {stream.status_code}",
                        endpoint=endpoint,
                        body=_body_preview(stream.read().decode("utf-8", "replace")),
                    )
                for line in stream.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    chunk_choices = chunk.get("choices") or []
                    if not chunk_choices or not isinstance(chunk_choices[0], dict):
                        continue
                    delta = chunk_choices[0].get("delta") or {}
                    piece = delta.get("content") or ""
                    if piece:
                        if first_token_ms is None:
                            first_token_ms = _ms(stream_started)
                        streamed_chars += len(piece)
    except httpx.HTTPError as exc:
        return _fail(
            region,
            _ms(started),
            f"stream chat failed: {type(exc).__name__}: {exc}",
            endpoint=endpoint,
            first_token_ms=first_token_ms,
        )

    if streamed_chars == 0:
        return _fail(
            region,
            _ms(started),
            "streaming returned no content deltas (is stream=true supported?)",
            endpoint=endpoint,
            model=MAAS_CHAT_MODEL,
        )

    stream_ms = _ms(stream_started)
    detail: dict[str, object] = {
        "endpoint": endpoint,
        "model": MAAS_CHAT_MODEL,
        "chat_ms": chat_ms,
        "stream_ms": stream_ms,
        "first_token_ms": first_token_ms,
        "streamed_chars": streamed_chars,
        "content_preview": content[:60],
    }
    usage = payload.get("usage")
    if isinstance(usage, dict):
        detail["usage"] = usage
    return _pass(region, _ms(started), detail)



def canary_maas_embed(timeout: float, _ctx: dict[str, object]) -> dict[str, object]:
    region = env("MAAS_REGION", DEFAULT_MAAS_REGION) or DEFAULT_MAAS_REGION
    base = (env("MAAS_BASE_URL", DEFAULT_MAAS_BASE_URL) or DEFAULT_MAAS_BASE_URL).rstrip("/")
    endpoint = f"{base}/embeddings"
    api_key = env("MAAS_API_KEY")
    if not api_key:
        return _blocked(
            region,
            reason="MAAS_API_KEY is not set (MaaS is only offered in cn-southwest-2)",
            missing_env=["MAAS_API_KEY"],
            extra={"endpoint": endpoint, "model": MAAS_EMBED_MODEL},
        )

    try:
        import httpx
    except ImportError:
        return _blocked(region, reason="httpx is not installed", missing_sdk="httpx")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": MAAS_EMBED_MODEL, "input": ["华为云 MaaS canary 向量维度检查"]}

    started = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(endpoint, headers=headers, json=payload)
    except httpx.HTTPError as exc:
        return _fail(
            region,
            _ms(started),
            f"embeddings request failed: {type(exc).__name__}: {exc}",
            endpoint=endpoint,
        )

    if response.status_code != 200:
        return _fail(
            region,
            _ms(started),
            f"embeddings HTTP {response.status_code}",
            endpoint=endpoint,
            model=MAAS_EMBED_MODEL,
            body=_body_preview(response.text),
        )
    try:
        body = response.json()
    except ValueError:
        return _fail(region, _ms(started), "embeddings response is not JSON", endpoint=endpoint)

    data = body.get("data") or []
    embedding = []
    if data and isinstance(data[0], dict):
        embedding = data[0].get("embedding") or []
    dim = len(embedding)
    if dim != MAAS_EMBED_DIM:
        return _fail(
            region,
            _ms(started),
            f"embedding dim is {dim}, expected {MAAS_EMBED_DIM}",
            endpoint=endpoint,
            model=MAAS_EMBED_MODEL,
            dim=dim,
            expected_dim=MAAS_EMBED_DIM,
        )

    detail: dict[str, object] = {
        "endpoint": endpoint,
        "model": MAAS_EMBED_MODEL,
        "dim": dim,
        "expected_dim": MAAS_EMBED_DIM,
    }
    usage = body.get("usage")
    if isinstance(usage, dict):
        detail["usage"] = usage
    return _pass(region, _ms(started), detail)



def canary_rds_vector(timeout: float, _ctx: dict[str, object]) -> dict[str, object]:
    region = env("HUAWEI_REGION", DEFAULT_HUAWEI_REGION) or DEFAULT_HUAWEI_REGION
    raw_dsn = env("RDS_URL")
    if not raw_dsn:
        return _blocked(
            region,
            reason=(
                "RDS_URL is not set; expected postgresql://user:password@host:5432/dbname "
                "(RDS PostgreSQL 15 + pgvector)"
            ),
            missing_env=["RDS_URL"],
        )

    try:
        import psycopg
    except ImportError:
        return _blocked(
            region,
            reason="psycopg is not installed",
            missing_sdk="psycopg[binary]",
        )

    started = time.perf_counter()
    dsn = _rds_dsn(raw_dsn)
    try:
        conn = psycopg.connect(dsn, connect_timeout=min(15, max(5, int(timeout))))
    except Exception as exc:  # noqa: BLE001 - driver raises many subclasses
        return _fail(region, _ms(started), f"RDS connect failed: {type(exc).__name__}: {exc}")

    index_kind: str | None = None
    index_errors: list[str] = []
    try:
        with conn.cursor() as cur:
            extension_method: str
            control_extension_error: str | None = None
            try:
                cur.execute("SELECT control_extension('create','vector')")
                extension_method = "control_extension('create','vector')"
            except Exception as exc:  # noqa: BLE001 - local PG has no control_extension
                conn.rollback()
                control_extension_error = f"{type(exc).__name__}: {exc}"
                try:
                    cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
                    extension_method = "CREATE EXTENSION IF NOT EXISTS vector"
                except Exception as local_exc:  # noqa: BLE001
                    conn.rollback()
                    return _fail(
                        region,
                        _ms(started),
                        "could not create the pgvector extension",
                        control_extension_error=control_extension_error,
                        create_extension_error=f"{type(local_exc).__name__}: {local_exc}",
                    )
            conn.commit()

            cur.execute("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
            row = cur.fetchone()
            extension_version = row[0] if row else None
            if not extension_version:
                return _fail(
                    region,
                    _ms(started),
                    "pgvector extension is missing after creation attempt",
                    extension_method=extension_method,
                )

            cur.execute(
                f"CREATE TEMP TABLE canary_vec (id integer PRIMARY KEY, "
                f"embedding vector({MAAS_EMBED_DIM}))"
            )
            randomizer = random.Random(20261031)
            rows = [
                (idx, _vec_literal([randomizer.uniform(-1.0, 1.0) for _ in range(MAAS_EMBED_DIM)]))
                for idx in range(100)
            ]
            cur.executemany(
                "INSERT INTO canary_vec (id, embedding) VALUES (%s, %s::vector)", rows
            )
            conn.commit()

            for kind, statement in (
                (
                    "hnsw",
                    "CREATE INDEX canary_vec_hnsw ON canary_vec "
                    "USING hnsw (embedding vector_cosine_ops)",
                ),
                (
                    "ivfflat",
                    "CREATE INDEX canary_vec_ivfflat ON canary_vec "
                    "USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)",
                ),
            ):
                savepoint = f"canary_idx_{kind}"
                try:
                    cur.execute(f"SAVEPOINT {savepoint}")
                    cur.execute(statement)
                    cur.execute(f"RELEASE SAVEPOINT {savepoint}")
                    index_kind = kind
                    break
                except Exception as exc:  # noqa: BLE001 - capability probe
                    cur.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                    cur.execute(f"RELEASE SAVEPOINT {savepoint}")
                    index_errors.append(f"{kind}: {type(exc).__name__}: {exc}")

            if index_kind is None:
                return _fail(
                    region,
                    _ms(started),
                    "neither HNSW nor ivfflat index could be created",
                    index_errors=index_errors,
                )
            conn.commit()

            query_vector = _vec_literal(
                [randomizer.uniform(-1.0, 1.0) for _ in range(MAAS_EMBED_DIM)]
            )
            cur.execute(
                "SELECT id FROM canary_vec ORDER BY embedding <=> %s::vector LIMIT 3",
                (query_vector,),
            )
            top_rows = cur.fetchall()
            if len(top_rows) != 3:
                return _fail(
                    region,
                    _ms(started),
                    f"top-3 query returned {len(top_rows)} rows",
                    index=index_kind,
                    rows=len(top_rows),
                )

            cur.execute("SET LOCAL enable_seqscan = off")
            cur.execute(
                "EXPLAIN SELECT id FROM canary_vec ORDER BY embedding <=> %s::vector LIMIT 3",
                (query_vector,),
            )
            plan_lines = [str(item[0]) for item in cur.fetchall()]
            index_used = any(index_kind in line.lower() for line in plan_lines)
            conn.rollback()

        detail: dict[str, object] = {
            "extension_version": extension_version,
            "extension_method": extension_method,
            "index": index_kind,
            "rows_inserted": 100,
            "top3_ids": [item[0] for item in top_rows],
            "index_used_in_plan": index_used,
            "plan_head": [line[:160] for line in plan_lines[:3]],
        }
        if control_extension_error:
            detail["control_extension_error"] = control_extension_error
        if index_errors:
            detail["index_errors"] = index_errors
        return _pass(region, _ms(started), detail)
    finally:
        try:
            conn.close()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass



def canary_obs(timeout: float, _ctx: dict[str, object]) -> dict[str, object]:
    _ = timeout
    region = env("HUAWEI_REGION", DEFAULT_HUAWEI_REGION) or DEFAULT_HUAWEI_REGION
    missing = [
        name
        for name in ("OBS_ENDPOINT", "OBS_BUCKET", "OBS_ACCESS_KEY_ID", "OBS_SECRET_ACCESS_KEY")
        if not env(name)
    ]
    if missing:
        return _blocked(
            region,
            reason="OBS is not configured",
            missing_env=missing,
            extra={
                "hint": "OBS_ENDPOINT is the bare host, e.g. obs.cn-north-4.myhuaweicloud.com"
            },
        )

    try:
        from obs import ObsClient
    except ImportError:
        return _blocked(
            region,
            reason='the OBS SDK (esdk-obs-python) is not installed; pip install ".[huawei]"',
            missing_sdk="esdk-obs-python",
        )

    endpoint = env("OBS_ENDPOINT") or ""
    server = endpoint if endpoint.startswith("http") else f"https://{endpoint}"
    bucket = env("OBS_BUCKET") or ""
    key = f"canary/learnrise-canary-{os.urandom(8).hex()}.bin"
    payload = os.urandom(1024)

    started = time.perf_counter()
    try:
        client = ObsClient(
            access_key_id=env("OBS_ACCESS_KEY_ID"),
            secret_access_key=env("OBS_SECRET_ACCESS_KEY"),
            server=server,
        )
    except Exception as exc:  # noqa: BLE001 - SDK validates inputs eagerly
        return _fail(region, _ms(started), f"OBS client init failed: {type(exc).__name__}: {exc}")

    try:
        put = client.putObject(bucket, key, content=payload)
        if getattr(put, "status", 500) >= 300 or getattr(put, "errorCode", None):
            return _fail(
                region,
                _ms(started),
                "putObject failed",
                status=getattr(put, "status", None),
                error_code=getattr(put, "errorCode", None),
                error_message=getattr(put, "errorMessage", None),
            )

        got = client.getObject(bucket, key, loadStreamInMemory=True)
        if getattr(got, "status", 500) >= 300 or getattr(got, "errorCode", None):
            return _fail(
                region,
                _ms(started),
                "getObject failed",
                status=getattr(got, "status", None),
                error_code=getattr(got, "errorCode", None),
            )
        body = got.body.buffer if getattr(got, "body", None) is not None else None
        if body != payload:
            return _fail(
                region,
                _ms(started),
                "OBS round-trip mismatch",
                expected_sha256=hashlib.sha256(payload).hexdigest(),
                got_sha256=hashlib.sha256(body or b"").hexdigest(),
                got_bytes=len(body or b""),
            )

        signed = client.createSignedUrl("GET", bucket, key, expires=300)
        signed_url = getattr(signed, "signedUrl", None) or getattr(signed, "signed_url", None)
        if not signed_url:
            return _fail(region, _ms(started), "createSignedUrl returned no URL")
        scheme = urlsplit(str(signed_url)).scheme
        if scheme != "https":
            return _fail(
                region,
                _ms(started),
                f"presigned URL scheme is {scheme!r}, expected 'https'",
                signed_url_host=urlsplit(str(signed_url)).netloc,
            )

        return _pass(
            region,
            _ms(started),
            {
                "endpoint": server,
                "bucket": bucket,
                "key": key,
                "bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "signed_url_scheme": scheme,
                "signed_url_path": _strip_query(str(signed_url)),
                "signed_url_expires_seconds": 300,
            },
        )
    except Exception as exc:  # noqa: BLE001 - SDK raises broad exception types
        return _fail(region, _ms(started), f"OBS call failed: {type(exc).__name__}: {exc}")
    finally:
        try:
            client.deleteObject(bucket, key)
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass



_FONT: dict[str, tuple[str, ...]] = {
    " ": ("00000",) * 7,
    "0": ("01110", "10001", "10011", "10101", "11001", "10001", "01110"),
    "2": ("01110", "10001", "00001", "00010", "00100", "01000", "11111"),
    "6": ("01110", "10001", "10000", "11110", "10001", "10001", "01110"),
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "C": ("01110", "10001", "10000", "10000", "10000", "10001", "01110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "N": ("10001", "11001", "10101", "10011", "10001", "10001", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "U": ("10001", "10001", "10001", "10001", "10001", "10001", "01110"),
    "X": ("10001", "10001", "01010", "00100", "01010", "10001", "10001"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
}


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _synthetic_text_png(text: str, scale: int = 6, margin: int = 24) -> bytes:
    text = text.upper()
    width = margin * 2 + max(1, len(text)) * 6 * scale
    height = margin * 2 + 7 * scale
    canvas = [bytearray(b"\xff" * (width * 3)) for _ in range(height)]

    for index, char in enumerate(text):
        glyph = _FONT.get(char)
        if not glyph:
            continue
        origin_x = margin + index * 6 * scale
        for row_index, bits in enumerate(glyph):
            for column_index, bit in enumerate(bits):
                if bit != "1":
                    continue
                pixel_x = origin_x + column_index * scale
                pixel_y = margin + row_index * scale
                for dy in range(scale):
                    row = canvas[pixel_y + dy]
                    base = pixel_x * 3
                    for dx in range(scale):
                        offset = base + dx * 3
                        row[offset : offset + 3] = b"\x00\x00\x00"

    raw = bytearray()
    for row in canvas:
        raw.append(0)  # PNG filter type 0 (None)
        raw.extend(row)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + _png_chunk(b"IEND", b"")
    )


def _resolve_ocr_image(image_ref: str | None) -> tuple[Path | None, str, str | None]:
    allowed = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
    if image_ref:
        candidate = Path(image_ref)
        if not candidate.is_absolute() and not candidate.exists():
            candidate = REPO_ROOT / candidate
        if candidate.is_file():
            if candidate.suffix.lower() not in allowed:
                return None, "unsupported", f"unsupported image type {candidate.suffix!r}"
            return candidate, "fixture", None
        if Path(image_ref).name != OCR_DEFAULT_IMAGE.name:
            return None, "missing", f"image not found: {image_ref}"

    if OCR_DEFAULT_IMAGE.is_file():
        return OCR_DEFAULT_IMAGE, "fixture", None

    try:
        png = _synthetic_text_png("LEARNRISE OCR CANARY 2026")
    except Exception as exc:  # noqa: BLE001 - pure stdlib path, but never crash the report
        return None, "none", f"synthetic image generation failed: {type(exc).__name__}: {exc}"
    target = Path(tempfile.gettempdir()) / "learnrise-ocr-canary.png"
    target.write_bytes(png)
    return (
        target,
        "synthetic",
        "fixtures/board.jpg is absent; generated a stdlib-only white PNG with black text",
    )


def canary_ocr(timeout: float, ctx: dict[str, object]) -> dict[str, object]:
    region = env("OCR_REGION", OCR_REGION_DEFAULT) or OCR_REGION_DEFAULT
    image_ref = ctx.get("image")
    image_path, image_source, image_note = _resolve_ocr_image(
        str(image_ref) if image_ref else None
    )
    if image_path is None:
        if image_source == "missing":
            return _fail(region, 0, image_note or "image not found")
        return _blocked(
            region,
            reason=image_note or "no usable OCR image",
            extra={"image_source": image_source},
        )

    missing = [name for name in ("HUAWEI_AK", "HUAWEI_SK") if not env(name)]
    image_meta = {
        "image_source": image_source,
        "image_path": str(image_path),
        "image_bytes": image_path.stat().st_size,
    }
    if image_note:
        image_meta["image_note"] = image_note
    if missing:
        return _blocked(
            region,
            reason="Huawei OCR requires AK/SK (RecognizeHandwriting, cn-north-4 only)",
            missing_env=missing,
            extra=image_meta,
        )

    try:
        from huaweicloudsdkcore.auth.credentials import BasicCredentials
        from huaweicloudsdkcore.http.http_config import HttpConfig
        from huaweicloudsdkocr.v1 import (
            OcrClient,
            RecognizeHandwritingRequest,
            RecognizeHandwritingRequestBody,
        )
        from huaweicloudsdkocr.v1.region.ocr_region import OcrRegion
    except ImportError as exc:
        return _blocked(
            region,
            reason=f'{exc}; install the optional OCR SDK with pip install ".[huawei]"',
            missing_sdk="huaweicloudsdkocr",
            extra=image_meta,
        )

    data = image_path.read_bytes()
    if not data:
        return _fail(region, 0, "image file is empty", **image_meta)
    if len(data) > OCR_MAX_BYTES:
        return _fail(
            region,
            0,
            f"image is {len(data)} bytes, base64 limit is {OCR_MAX_BYTES}",
            **image_meta,
        )

    started = time.perf_counter()
    try:
        credentials = BasicCredentials(
            env("HUAWEI_AK"), env("HUAWEI_SK"), env("HUAWEI_PROJECT_ID")
        )
        http_config = HttpConfig(connection_timeout=min(15, max(5, int(timeout))), timeout=timeout)
        client = (
            OcrClient.new_builder()
            .with_credentials(credentials)
            .with_region(OcrRegion.value_of(region))
            .with_http_config(http_config)
            .build()
        )
        request = RecognizeHandwritingRequest()
        request.body = RecognizeHandwritingRequestBody(
            image=base64.b64encode(data).decode("ascii")
        )
        response = client.recognize_handwriting(request)
    except Exception as exc:  # noqa: BLE001 - SDK exceptions are broad
        return _fail(
            region,
            _ms(started),
            f"RecognizeHandwriting failed: {type(exc).__name__}: {exc}",
            model=OCR_MODEL,
            **image_meta,
        )

    result = getattr(response, "result", None)
    blocks = list(getattr(result, "words_block_list", None) or [])
    block_count = getattr(result, "words_block_count", len(blocks))
    if not blocks:
        return _fail(
            region,
            _ms(started),
            "RecognizeHandwriting returned zero words_block entries",
            model=OCR_MODEL,
            words_block_count=block_count,
            **image_meta,
        )

    previews = []
    for block in blocks[:3]:
        words = str(getattr(block, "words", "") or "").strip()
        if words:
            previews.append(words[:40])

    return _pass(
        region,
        _ms(started),
        {
            "model": OCR_MODEL,
            "words_block_count": block_count,
            "words_block_returned": len(blocks),
            "first_words": previews,
            **image_meta,
        },
    )


CANARIES = {
    "maas_chat": canary_maas_chat,
    "maas_embed": canary_maas_embed,
    "rds_vector": canary_rds_vector,
    "obs": canary_obs,
    "ocr": canary_ocr,
}


def _default_region(name: str) -> str:
    if name.startswith("maas_"):
        return env("MAAS_REGION", DEFAULT_MAAS_REGION) or DEFAULT_MAAS_REGION
    if name == "ocr":
        return env("OCR_REGION", OCR_REGION_DEFAULT) or OCR_REGION_DEFAULT
    return env("HUAWEI_REGION", DEFAULT_HUAWEI_REGION) or DEFAULT_HUAWEI_REGION


def _run_canary(name: str, timeout: float, ctx: dict[str, object]) -> dict[str, object]:
    box: dict[str, object] = {}

    def target() -> None:
        try:
            box["result"] = CANARIES[name](timeout, ctx)
        except BaseException as exc:  # noqa: BLE001 - last-resort guard, reported as FAIL
            box["error"] = exc

    thread = threading.Thread(target=target, name=f"canary-{name}", daemon=True)
    started = time.perf_counter()
    thread.start()
    thread.join(timeout)

    if thread.is_alive():
        return {
            "status": STATUS_FAIL,
            "region": _default_region(name),
            "latency_ms": _ms(started),
            "detail": {"reason": f"canary exceeded the {timeout:.0f}s timeout"},
        }
    if "error" in box:
        exc = box["error"]
        return {
            "status": STATUS_FAIL,
            "region": _default_region(name),
            "latency_ms": _ms(started),
            "detail": {"reason": f"unexpected error: {type(exc).__name__}: {exc}"},
        }
    return box["result"]  # type: ignore[return-value]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Huawei Cloud canary spike: one JSON line per canary.",
    )
    parser.add_argument(
        "--canary",
        choices=[*CANARIES, "all"],
        default="all",
        help="which canary to run (default: all)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=60.0,
        help="per-canary timeout in seconds (default: 60)",
    )
    parser.add_argument(
        "--image",
        default=None,
        help="OCR image path; defaults to fixtures/board.jpg, synthetic PNG if absent",
    )
    args = parser.parse_args(argv)

    names = list(CANARIES) if args.canary == "all" else [args.canary]
    ctx: dict[str, object] = {"image": args.image}
    secrets = _secret_values()

    statuses: list[str] = []
    missing_env: set[str] = set()
    missing_sdk: set[str] = set()

    for name in names:
        result = _run_canary(name, args.timeout, ctx)
        detail = result.get("detail")
        line = {
            "canary": name,
            "status": result["status"],
            "latency_ms": result["latency_ms"],
            "region": result["region"],
            "detail": _redact_value(detail, secrets),
        }
        print(json.dumps(line, ensure_ascii=False), flush=True)
        statuses.append(str(result["status"]))
        if isinstance(detail, dict):
            missing_env.update(str(item) for item in detail.get("missing_env") or [])
            if detail.get("missing_sdk"):
                missing_sdk.add(str(detail["missing_sdk"]))

    counts = {
        status: statuses.count(status)
        for status in (STATUS_PASS, STATUS_FAIL, STATUS_BLOCKED)
    }
    summary = ", ".join(f"{status}={count}" for status, count in counts.items() if count)
    print(f"summary: {summary} (canaries: {', '.join(names)})", file=sys.stderr)

    if STATUS_FAIL in statuses:
        print(
            "canary FAIL: at least one real service assertion failed; see JSON lines above",
            file=sys.stderr,
        )
        return 1

    if STATUS_BLOCKED in statuses:
        parts = []
        if missing_env:
            parts.append("env: " + ", ".join(sorted(missing_env)))
        if missing_sdk:
            parts.append("sdk: " + ", ".join(sorted(missing_sdk)))
        suffix = f" ({'; '.join(parts)})" if parts else ""
        print(
            f"missing prerequisites{suffix}: no Huawei Cloud credentials/SDK in this "
            'environment. Export the vars in docs/huawei-canary.md and, for OCR/OBS, '
            'run pip install ".[huawei]". Nothing was faked: every unrun canary is '
            "reported as BLOCKED.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
