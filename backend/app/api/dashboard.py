"""Dashboard endpoints.

``GET /api/dashboard/summary`` returns every learning-dashboard metric in one
read-only, 60 second cached payload; see :mod:`app.services.dashboard`.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.deps import CurrentUser, DbSession
from app.services.dashboard import summary

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


class RadarItem(BaseModel):
    name: str
    value: float


class HistogramItem(BaseModel):
    bucket: str
    count: int


class HeatmapItem(BaseModel):
    date: str
    count: int


class CurveItem(BaseModel):
    days: int
    retrievability: float


class DashboardSummaryOut(BaseModel):
    due_count: int
    reviewed_today: int
    streak_days: int
    mastery_radar: list[RadarItem]
    difficulty_histogram: list[HistogramItem]
    heatmap: list[HeatmapItem]
    forgetting_curve: list[CurveItem]


@router.get("/summary", response_model=DashboardSummaryOut)
def get_dashboard_summary(db: DbSession, user: CurrentUser) -> DashboardSummaryOut:
    return DashboardSummaryOut.model_validate(summary(db, user_id=user.id))
