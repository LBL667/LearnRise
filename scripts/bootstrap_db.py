"""Repo-root wrapper for ``backend/scripts/bootstrap_db.py``.

The real implementation lives in ``backend/scripts/`` because the backend
container bind-mounts ``./backend`` at ``/app``. Keep the logic in one file.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

runpy.run_path(str(BACKEND_ROOT / "scripts" / "bootstrap_db.py"), run_name="__main__")
