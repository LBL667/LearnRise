"""Authentication endpoints: password login and current-user lookup."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from functools import lru_cache

from fastapi import APIRouter, HTTPException, status
from jose import jwt
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.errors import CodedHTTPException
from app.config import settings
from app.deps import CurrentUser, DbSession
from app.models import User
from app.security.password import hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

LOGIN_FAILED_DETAIL = "邮箱或密码错误"
EMAIL_TAKEN_DETAIL = "邮箱已注册"
EMPTY_DISPLAY_NAME_DETAIL = "显示名称不能为空"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


def create_access_token(user_id: str) -> str:
    """Mint a short-lived access token for ``user_id``."""
    issued_at = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "exp": issued_at + timedelta(minutes=settings.jwt_expire_minutes),
        "iat": issued_at,
        "typ": "access",
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


@lru_cache(maxsize=1)
def _timing_decoy_hash() -> str:
    """Hash an unrelated password so unknown emails cost the same as bad ones."""
    return hash_password("timing-equalizer-not-a-real-password")


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(func.lower(User.email) == email))

    stored_hash = user.password_hash if user is not None else _timing_decoy_hash()
    password_ok = verify_password(payload.password, stored_hash)
    if user is None or not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=LOGIN_FAILED_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
def read_current_user(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: DbSession) -> TokenResponse:
    email = payload.email.strip().lower()
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(
            status_code=422,
            detail=EMPTY_DISPLAY_NAME_DETAIL,
        )

    existing = db.scalar(select(User).where(func.lower(User.email) == email))
    if existing is not None:
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=EMAIL_TAKEN_DETAIL,
            code="EMAIL_TAKEN",
        )

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        display_name=display_name,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise CodedHTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=EMAIL_TAKEN_DETAIL,
            code="EMAIL_TAKEN",
        ) from None
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.id),
        user=UserOut.model_validate(user),
    )
