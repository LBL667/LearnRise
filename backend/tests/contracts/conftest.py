"""Contract-test environment.

Profiles are selected through ``PARITY_PROFILE``: unset means only ``local`` so
plain collection stays fast; ``all`` runs both. Huawei profiles require
credentials via ``HUAWEI_AK`` and are skipped otherwise.
"""

from __future__ import annotations

import os
from collections.abc import Generator

import pytest


def _profiles() -> list[str]:
    raw = os.environ.get("PARITY_PROFILE", "").strip().lower()
    if not raw:
        return ["local"]
    if raw == "all":
        return ["local", "huawei"]
    return [raw]


def pytest_collection_modifyitems(items: list[object]) -> None:
    if os.environ.get("HUAWEI_AK"):
        return
    skip = pytest.mark.skip(reason="HUAWEI_AK not set; Huawei contract tests skipped")
    for item in items:
        if "requires_huawei" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(params=_profiles())
def provider_profile(request: pytest.FixtureRequest) -> Generator[str, None, None]:
    profile = request.param
    if profile == "huawei" and not os.environ.get("HUAWEI_AK"):
        pytest.skip("HUAWEI_AK not set; skipping huawei contract profile")
    yield profile
