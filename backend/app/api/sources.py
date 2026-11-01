"""Knowledge-source upload and ingestion job endpoints.

``POST /api/sources/upload`` stores the blob and enqueues a job; the heavy
pipeline runs in :func:`app.services.ingest.run_ingest` via ``BackgroundTasks``
(and can be replayed synchronously from tests). All reads are scoped to the
authenticated user; a foreign id yields ``404`` never ``403``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    BackgroundTasks,
    File,
    HTTPException,
    UploadFile,
)
from fastapi import status as http_status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.deps import CurrentUser, DbSession, require_owner
from app.models import Chunk, IngestionJob, KnowledgeSource, User, new_uuid
from app.services import ingest as ingest_service
from app.services.ingest import (
    UNSUPPORTED_TYPE_MESSAGE,
    UnsupportedFileType,
    make_storage_key,
    resolve_content_type,
    save_upload,
    title_from_filename,
)

router = APIRouter(prefix="/api", tags=["sources"])

#: Read the upload in 1 MiB slices so an oversized body is rejected early.
_READ_CHUNK = 1024 * 1024

_NOT_FOUND_DETAIL = "资源不存在"


class UploadAccepted(BaseModel):
    source_id: str
    job_id: str
    status: str = "queued"


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    filename: str
    content_type: str
    size_bytes: int
    status: str
    page_count: int | None
    created_at: datetime


class SourceDetail(SourceOut):
    error_message: str | None
    updated_at: datetime


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    source_id: str
    status: str
    progress: int
    failed_chunks: int
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None


def _not_found() -> HTTPException:
    return HTTPException(
        status_code=http_status.HTTP_404_NOT_FOUND,
        detail=_NOT_FOUND_DETAIL,
    )


def _load_source(db: Session, source_id: str, user: User) -> KnowledgeSource:
    try:
        UUID(source_id)
    except ValueError:
        raise _not_found() from None
    source = db.get(KnowledgeSource, source_id)
    if source is None:
        raise _not_found()
    require_owner(source.user_id, user)
    return source


def _load_job(db: Session, job_id: str, user: User) -> IngestionJob:
    try:
        UUID(job_id)
    except ValueError:
        raise _not_found() from None
    job = db.get(IngestionJob, job_id)
    if job is None:
        raise _not_found()
    require_owner(job.user_id, user)
    return job


async def _read_limited(file: UploadFile, limit_bytes: int, limit_mb: int) -> bytes:
    """Read ``file`` in slices, aborting as soon as ``limit_bytes`` is exceeded."""
    buffer = bytearray()
    while True:
        chunk = await file.read(_READ_CHUNK)
        if not chunk:
            break
        if len(buffer) + len(chunk) > limit_bytes:
            raise HTTPException(
                status_code=http_status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"文件大小超过 {limit_mb}MB 上限",
            )
        buffer.extend(chunk)
    return bytes(buffer)


@router.post(
    "/sources/upload",
    response_model=UploadAccepted,
    status_code=http_status.HTTP_202_ACCEPTED,
)
async def upload_source(
    file: Annotated[UploadFile, File()],
    db: DbSession,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> UploadAccepted:
    filename = file.filename or "upload"
    try:
        content_type = resolve_content_type(filename, file.content_type or "")
    except UnsupportedFileType:
        raise HTTPException(
            status_code=http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=UNSUPPORTED_TYPE_MESSAGE,
        ) from None

    limit_mb = max(1, int(settings.max_upload_mb))
    data = await _read_limited(file, limit_mb * 1024 * 1024, limit_mb)
    if not data:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="文件为空",
        )

    source_id = new_uuid()
    storage_key = make_storage_key(user.id, source_id, filename)
    try:
        save_upload(storage_key, data, content_type)
    except Exception:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="文件保存失败",
        ) from None

    source = KnowledgeSource(
        id=source_id,
        user_id=user.id,
        title=title_from_filename(filename),
        filename=filename,
        content_type=content_type,
        size_bytes=len(data),
        storage_key=storage_key,
        status="pending",
    )
    db.add(source)
    db.flush()

    job = IngestionJob(
        source_id=source.id,
        user_id=user.id,
        status="queued",
        progress=0,
        failed_chunks=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(ingest_service.run_ingest, job.id)
    return UploadAccepted(source_id=source.id, job_id=job.id, status="queued")


@router.get("/sources", response_model=list[SourceOut])
def list_sources(db: DbSession, user: CurrentUser) -> list[SourceOut]:
    rows = db.scalars(
        select(KnowledgeSource)
        .where(KnowledgeSource.user_id == user.id)
        .order_by(KnowledgeSource.created_at.desc(), KnowledgeSource.id.desc())
    ).all()
    return [SourceOut.model_validate(row) for row in rows]


@router.get("/sources/{source_id}", response_model=SourceDetail)
def read_source(source_id: str, db: DbSession, user: CurrentUser) -> SourceDetail:
    return SourceDetail.model_validate(_load_source(db, source_id, user))


@router.get("/jobs/{job_id}", response_model=JobOut)
def read_job(job_id: str, db: DbSession, user: CurrentUser) -> JobOut:
    return JobOut.model_validate(_load_job(db, job_id, user))


@router.post(
    "/sources/{source_id}/reprocess",
    response_model=UploadAccepted,
    status_code=http_status.HTTP_202_ACCEPTED,
)
def reprocess_source(
    source_id: str,
    db: DbSession,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
) -> UploadAccepted:
    source = _load_source(db, source_id, user)

    # The chunks table is the vector store's own persistence, so deleting the
    # rows removes the old embeddings before the new job re-writes them.
    db.execute(delete(Chunk).where(Chunk.source_id == source.id))
    source.status = "pending"
    source.error_message = None
    source.page_count = None

    job = IngestionJob(
        source_id=source.id,
        user_id=user.id,
        status="queued",
        progress=0,
        failed_chunks=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(ingest_service.run_ingest, job.id)
    return UploadAccepted(source_id=source.id, job_id=job.id, status="queued")
