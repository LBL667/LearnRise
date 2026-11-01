"""Standalone daily reminder worker.

Run with ``python -m app.worker.scheduler``. APScheduler must never be started
from the web process: uvicorn runs several workers and each would fire the job.
This module is the only place that constructs the scheduler.

The job fires every day at 08:00 in ``settings.timezone`` (Asia/Shanghai).
``run_reminders`` itself owns idempotency and multi-process safety through a
PostgreSQL advisory lock, so even a stray extra process cannot double-send.
"""

from __future__ import annotations

import logging
import signal
import sys
from types import FrameType
from zoneinfo import ZoneInfo

from apscheduler.schedulers.base import SchedulerNotRunningError
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings
from app.security.redaction import install_redaction
from app.services.email import run_reminders

__all__ = ["REMINDER_HOUR", "REMINDER_JOB_ID", "REMINDER_MINUTE", "build_scheduler", "main"]

logger = logging.getLogger(__name__)

REMINDER_JOB_ID = "daily-reminders"
REMINDER_HOUR = 8
REMINDER_MINUTE = 0


def run_daily_reminders() -> None:
    logger.info("daily reminder job triggered")
    try:
        result = run_reminders()
    except Exception:
        logger.exception("daily reminder job crashed")
        return
    logger.info("daily reminder job finished: %s", result)


def build_scheduler() -> BlockingScheduler:
    timezone = ZoneInfo(settings.timezone)
    scheduler = BlockingScheduler(timezone=timezone)
    scheduler.add_job(
        run_daily_reminders,
        CronTrigger(hour=REMINDER_HOUR, minute=REMINDER_MINUTE, timezone=timezone),
        id=REMINDER_JOB_ID,
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    return scheduler


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    install_redaction()
    scheduler = build_scheduler()

    def _shutdown(signum: int, frame: FrameType | None) -> None:
        logger.info("received signal %s; shutting down reminder scheduler", signum)
        if scheduler.running:
            scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info(
        "reminder scheduler starting; daily job at %02d:%02d %s",
        REMINDER_HOUR,
        REMINDER_MINUTE,
        settings.timezone,
    )
    try:
        scheduler.start()
    except (KeyboardInterrupt, SchedulerNotRunningError):
        pass
    logger.info("reminder scheduler stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
