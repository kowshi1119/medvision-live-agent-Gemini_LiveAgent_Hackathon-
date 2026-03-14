"""
MedVision — Firestore knowledge base queries.

Provides get_who_protocol() which is registered as a Gemini tool.
Falls back gracefully when Firestore is unavailable.
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger("medvision.knowledge")

_db = None  # lazy-initialised Firestore client
COLLECTION = "who_protocols"


def _get_db():
    global _db
    if _db is None:
        from google.cloud import firestore  # type: ignore
        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        _db = firestore.AsyncClient(project=project) if project else firestore.AsyncClient()
    return _db


async def get_who_protocol(condition: str) -> dict[str, Any] | None:
    """
    Look up a WHO emergency protocol by condition key.

    Args:
        condition: snake_case condition identifier, e.g. "cardiac_arrest".

    Returns:
        Protocol dict or None if not found.
    """
    condition = condition.strip().lower().replace(" ", "_").replace("-", "_")
    try:
        db = _get_db()
        # Direct document lookup by condition key
        doc_ref = db.collection(COLLECTION).document(condition)
        doc = await doc_ref.get()
        if doc.exists:
            return doc.to_dict()

        # Fallback: query keywords array
        query = (
            db.collection(COLLECTION)
            .where("keywords", "array_contains", condition)
            .limit(1)
        )
        results = query.stream()
        async for result in results:
            return result.to_dict()

        logger.info("No WHO protocol found for condition: %s", condition)
        return None

    except Exception as exc:
        logger.error("Firestore query error for '%s': %s", condition, exc)
        return None


async def search_protocols_by_keyword(keyword: str, limit: int = 3) -> list[dict[str, Any]]:
    """
    Search protocols by a free-text keyword (checks keywords array field).
    Used for fuzzy multi-condition detection.
    """
    keyword = keyword.strip().lower()
    results: list[dict[str, Any]] = []
    try:
        db = _get_db()
        query = (
            db.collection(COLLECTION)
            .where("keywords", "array_contains", keyword)
            .limit(limit)
        )
        async for doc in query.stream():
            results.append(doc.to_dict())
    except Exception as exc:
        logger.error("Protocol keyword search error for '%s': %s", keyword, exc)
    return results


async def list_all_conditions() -> list[str]:
    """Return all condition keys stored in Firestore."""
    conditions: list[str] = []
    try:
        db = _get_db()
        async for doc in db.collection(COLLECTION).stream():
            conditions.append(doc.id)
    except Exception as exc:
        logger.error("Failed to list conditions: %s", exc)
    return conditions
