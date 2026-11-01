"""Machine-readable error codes for the new API surface.

The 33 legacy endpoints keep their original error contract: the body stays
exactly ``{"detail": ...}`` with the same status codes. Only the endpoints
introduced by the platform work carry the additive ``code`` field, so clients
can branch on a stable identifier instead of parsing ``detail`` text.

Scope is decided by request path prefix, never by a global middleware: a global
injection would rewrite the legacy bodies and break the whole-body equality
assertions in ``tests/api/test_auth.py`` and ``tests/api/test_internal.py``.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

NEW_API_PREFIXES: tuple[str, ...] = (
    "/api/auth/register",
    "/api/competitions",
    "/api/invite",
    "/api/assistant",
    "/api/trial",
    "/api/profile",
    "/api/leaderboard",
)

STATUS_CODES: dict[int, str] = {
    status.HTTP_400_BAD_REQUEST: "BAD_REQUEST",
    status.HTTP_401_UNAUTHORIZED: "AUTH_REQUIRED",
    status.HTTP_403_FORBIDDEN: "FORBIDDEN",
    status.HTTP_404_NOT_FOUND: "NOT_FOUND",
    status.HTTP_409_CONFLICT: "CONFLICT",
    422: "VALIDATION_ERROR",
    status.HTTP_429_TOO_MANY_REQUESTS: "RATE_LIMITED",
}


class CodedHTTPException(HTTPException):
    """An ``HTTPException`` carrying an explicit machine-readable ``code``."""

    def __init__(self, status_code: int, detail: str, code: str) -> None:
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


def is_new_api(path: str) -> bool:
    return any(path == prefix or path.startswith(f"{prefix}/") for prefix in NEW_API_PREFIXES)


def code_for(exc: StarletteHTTPException) -> str:
    explicit = getattr(exc, "code", None)
    if isinstance(explicit, str) and explicit:
        return explicit
    return STATUS_CODES.get(exc.status_code, "ERROR")


def _legacy_body(detail: Any) -> dict[str, Any]:
    return {"detail": detail}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        if not is_new_api(request.url.path):
            return JSONResponse(
                _legacy_body(exc.detail),
                status_code=exc.status_code,
                headers=getattr(exc, "headers", None),
            )
        return JSONResponse(
            {"detail": exc.detail, "code": code_for(exc)},
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        detail = jsonable_encoder(exc.errors())
        if not is_new_api(request.url.path):
            return JSONResponse(_legacy_body(detail), status_code=422)
        return JSONResponse(
            {"detail": detail, "code": STATUS_CODES[422]},
            status_code=422,
        )
