"""Structured note generation endpoint.

``POST /api/sources/{source_id}/notes`` runs the note pipeline for the
authenticated user's source. A source with no chunks is a ``400``, a foreign
or unknown id is a ``404`` (never ``403``), and two invalid JSON attempts are
reported as ``422`` together with the truncated raw text.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession
from app.services.notes import (
    FAILURE_MESSAGE,
    NoteGenerationError,
    NoteSourceNotFound,
    generate_notes,
)

router = APIRouter(prefix="/api/sources", tags=["notes"])

_NOT_FOUND = "资源不存在"
_NO_CHUNKS = "该资料没有可用的文本片段，请先完成解析"


class NotesRequest(BaseModel):
    agent_id: str | None = None


class NotesResponse(BaseModel):
    source_id: str
    knowledge_points_created: int
    root_ids: list[str]
    model: str


@router.post(
    "/{source_id}/notes",
    status_code=status.HTTP_201_CREATED,
    response_model=NotesResponse,
)
def create_notes(
    source_id: str,
    db: DbSession,
    user: CurrentUser,
    payload: NotesRequest | None = None,
) -> NotesResponse:
    body = payload or NotesRequest()
    try:
        result = generate_notes(
            db,
            user_id=user.id,
            source_id=source_id,
            agent_id=body.agent_id,
        )
    except NoteSourceNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND
        ) from None
    except ValueError as exc:
        if str(exc) == "no chunks":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_CHUNKS
            ) from None
        raise
    except NoteGenerationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"message": FAILURE_MESSAGE, "raw": exc.raw},
        ) from None

    return NotesResponse(
        source_id=result.source_id,
        knowledge_points_created=result.knowledge_points_created,
        root_ids=result.root_ids,
        model=result.model,
    )
