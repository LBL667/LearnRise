#!/usr/bin/env python3
"""OCR smoke test wrapper for plan task 5.

Thin CLI around the OCR canary in ``huawei_canary.py`` so the plan's QA
scenario ``python scripts/ocr_smoke.py fixtures/board.jpg`` works unchanged.

Uses the same env vars as the canary: ``HUAWEI_AK``, ``HUAWEI_SK``,
``HUAWEI_PROJECT_ID``, ``OCR_REGION`` (default cn-north-4).

Exit codes: 0 PASS, 1 FAIL, 2 BLOCKED (missing credentials/SDK).
Prints one JSON line on stdout with the canary result.
"""

from __future__ import annotations

import argparse
import json
import sys

from huawei_canary import (
    STATUS_BLOCKED,
    STATUS_FAIL,
    STATUS_PASS,
    _redact_value,
    _run_canary,
    _secret_values,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Huawei handwritten OCR smoke test (RecognizeHandwriting, cn-north-4).",
    )
    parser.add_argument(
        "image",
        nargs="?",
        default=None,
        help="path to a PNG/JPG/BMP/TIFF image (default: fixtures/board.jpg, synthetic if absent)",
    )
    parser.add_argument("--timeout", type=float, default=60.0)
    args = parser.parse_args(argv)

    result = _run_canary("ocr", args.timeout, {"image": args.image})
    line = {
        "canary": "ocr",
        "status": result["status"],
        "latency_ms": result["latency_ms"],
        "region": result["region"],
        "detail": _redact_value(result["detail"], _secret_values()),
    }
    print(json.dumps(line, ensure_ascii=False), flush=True)

    status = str(result["status"])
    detail = result["detail"] if isinstance(result["detail"], dict) else {}
    if status == STATUS_FAIL:
        print("OCR smoke FAIL: see the JSON line above", file=sys.stderr)
        return 1
    if status == STATUS_BLOCKED:
        parts = []
        if detail.get("missing_env"):
            parts.append("env: " + ", ".join(str(item) for item in detail["missing_env"]))
        if detail.get("missing_sdk"):
            parts.append("sdk: " + str(detail["missing_sdk"]))
        suffix = f" ({'; '.join(parts)})" if parts else ""
        print(
            f"missing prerequisites{suffix}: OCR cannot run without Huawei credentials; "
            'export HUAWEI_AK/HUAWEI_SK and run pip install ".[huawei]". '
            "Nothing was faked: status is BLOCKED.",
            file=sys.stderr,
        )
        return 2
    if status == STATUS_PASS:
        return 0
    print(f"unexpected canary status: {status}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
