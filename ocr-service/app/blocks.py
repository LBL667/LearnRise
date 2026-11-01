"""Line-wise merging of raw OCR detections.

Raw PP-OCR output is one entry per text region.  The API contract returns one
block per visual line, so detections are sorted by vertical centre then by
left edge and grouped when their vertical extents overlap.
"""

from __future__ import annotations

from typing import Any

REVIEW_THRESHOLD = 0.6
_VERTICAL_OVERLAP = 0.5


def _bounds(box: Any) -> tuple[float, float, float, float]:
    points = [(float(p[0]), float(p[1])) for p in box]
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _is_cjk(char: str) -> bool:
    return "\u4e00" <= char <= "\u9fff"


def _join(left: str, right: str) -> str:
    if not left:
        return right
    if not right:
        return left
    if _is_cjk(left[-1]) or _is_cjk(right[0]):
        return left + right
    return f"{left} {right}"


def merge_lines(items: list[tuple[Any, str, float]]) -> list[dict[str, Any]]:
    """Merge detections into one block per visual line."""
    entries = []
    for box, text, confidence in items:
        x0, y0, x1, y1 = _bounds(box)
        entries.append(
            {
                "x0": x0,
                "y0": y0,
                "x1": x1,
                "y1": y1,
                "cy": (y0 + y1) / 2.0,
                "h": max(y1 - y0, 1.0),
                "text": text,
                "confidence": confidence,
            }
        )
    entries.sort(key=lambda item: (item["cy"], item["x0"]))

    lines: list[list[dict[str, Any]]] = []
    for entry in entries:
        placed = False
        for line in lines:
            anchor = line[0]
            overlap = min(anchor["y1"], entry["y1"]) - max(anchor["y0"], entry["y0"])
            if overlap >= _VERTICAL_OVERLAP * min(anchor["h"], entry["h"]):
                line.append(entry)
                placed = True
                break
        if not placed:
            lines.append([entry])

    blocks: list[dict[str, Any]] = []
    for line in lines:
        line.sort(key=lambda item: item["x0"])
        text = ""
        for entry in line:
            text = _join(text, entry["text"])
        confidence = min(entry["confidence"] for entry in line)
        x0 = min(entry["x0"] for entry in line)
        y0 = min(entry["y0"] for entry in line)
        x1 = max(entry["x1"] for entry in line)
        y1 = max(entry["y1"] for entry in line)
        blocks.append(
            {
                "text": text,
                "confidence": round(confidence, 4),
                "box": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
                "needs_review": confidence < REVIEW_THRESHOLD,
            }
        )
    return blocks
