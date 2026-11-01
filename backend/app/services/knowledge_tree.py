"""Assemble the flat ``knowledge_points`` table into a nested tree.

The front end renders the mind map read-only, so the whole hierarchy is
returned in one payload. Assembly is O(n) and iterative: a dict index maps
``id -> node`` and every row is attached to its parent exactly once.

Robustness rules
----------------
* Orphans (``parent_id`` pointing at a row that does not exist, or at a row of
  another source/user that the caller did not load) are promoted to roots so
  data is never silently dropped.
* Self references and multi-node cycles cannot hang the builder: each parent
  chain is walked with a visited set, and any node whose chain loops is
  promoted to a root. Each node still appears exactly once.
* Nesting is capped at :data:`MAX_DEPTH`; a node whose ancestor chain is
  longer is promoted to a root and a warning is logged.
"""

from __future__ import annotations

import logging
from typing import Any

from app.models import KnowledgePoint

logger = logging.getLogger(__name__)

#: Maximum nesting depth (root = 0). Deeper nodes are promoted to roots.
MAX_DEPTH = 12

TreeNode = dict[str, Any]


def _sort_key(point: KnowledgePoint) -> tuple[int, str, str]:
    return (point.sort_order, point.title or "", str(point.id))


def _chain_loops_or_too_deep(
    point_id: str, parent_id: str, index: dict[str, KnowledgePoint]
) -> tuple[bool, bool]:
    """Walk up from ``parent_id`` and report ``(cycle, too_deep)``.

    ``cycle`` is true when the chain revisits a node (including ``point_id``);
    ``too_deep`` is true when the chain is longer than :data:`MAX_DEPTH` steps.
    An unknown parent (orphan) returns ``(False, False)`` -- promotion happens
    naturally because the parent is absent from ``index``.
    """
    seen: set[str] = {point_id}
    current: str | None = parent_id
    steps = 0
    while current is not None:
        if current in seen:
            return True, False
        if steps >= MAX_DEPTH:
            return False, True
        seen.add(current)
        row = index.get(current)
        if row is None:
            return False, False
        current = row.parent_id
        steps += 1
    return False, False


def build_tree(rows: list[KnowledgePoint]) -> list[TreeNode]:
    """Return the nested representation of ``rows``.

    Only the rows passed in are considered; callers are responsible for
    loading exactly the (user, source) slice they are allowed to expose.
    """
    ordered = sorted(rows, key=_sort_key)
    index: dict[str, KnowledgePoint] = {str(point.id): point for point in ordered}

    nodes: dict[str, TreeNode] = {
        str(point.id): {
            "id": str(point.id),
            "title": point.title,
            "content": point.content or "",
            "level": point.level,
            "mastery_score": point.mastery_score,
            "children": [],
        }
        for point in ordered
    }

    roots: list[TreeNode] = []
    for point in ordered:
        point_id = str(point.id)
        node = nodes[point_id]
        parent_id = None if point.parent_id is None else str(point.parent_id)

        if parent_id is None or parent_id == point_id or parent_id not in index:
            if parent_id is not None and parent_id == point_id:
                logger.warning("knowledge point %s references itself; promoted", point_id)
            elif parent_id is not None:
                logger.warning(
                    "knowledge point %s has missing parent %s; promoted",
                    point_id,
                    parent_id,
                )
            roots.append(node)
            continue

        cycle, too_deep = _chain_loops_or_too_deep(point_id, parent_id, index)
        if cycle:
            logger.warning(
                "knowledge point %s is part of a parent cycle; promoted", point_id
            )
            roots.append(node)
            continue
        if too_deep:
            logger.warning(
                "knowledge point %s exceeds max depth %s; promoted",
                point_id,
                MAX_DEPTH,
            )
            roots.append(node)
            continue

        parent_node = nodes[parent_id]
        parent_children = parent_node["children"]
        assert isinstance(parent_children, list)
        parent_children.append(node)

    return roots
