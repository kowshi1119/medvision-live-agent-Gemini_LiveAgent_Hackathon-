"""
MedVision — Cloud Storage session log persistence.

Saves session event logs as JSON blobs to GCS bucket
``medvision-session-logs-{PROJECT_ID}``.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

logger = logging.getLogger("medvision.cloud_storage")

_BUCKET_NAME_ENV = "MEDVISION_SESSION_BUCKET"
_storage_client = None


def _get_client():
    global _storage_client
    if _storage_client is None:
        from google.cloud import storage  # type: ignore
        _storage_client = storage.Client()
    return _storage_client


def _get_bucket_name() -> str:
    bucket = os.environ.get(_BUCKET_NAME_ENV)
    if bucket:
        return bucket
    project = os.environ.get("GOOGLE_CLOUD_PROJECT", "medvision")
    return f"medvision-session-logs-{project}"


async def save_session_log(session_id: str, payload: dict[str, Any]) -> str:
    """
    Persist a session log dict to GCS.

    Args:
        session_id: UUID string identifying the session.
        payload: Full session log dict.

    Returns:
        GCS URI of the saved object.

    Raises:
        Exception: Propagated from GCS client on upload failure.
    """
    import asyncio

    bucket_name = _get_bucket_name()
    date_prefix = time.strftime("%Y/%m/%d", time.gmtime(payload.get("started_at", time.time())))
    object_name = f"sessions/{date_prefix}/{session_id}.json"
    blob_content = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")

    def _upload() -> str:
        client = _get_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        blob.upload_from_string(blob_content, content_type="application/json")
        uri = f"gs://{bucket_name}/{object_name}"
        logger.info("Session log saved to %s", uri)
        return uri

    loop = asyncio.get_event_loop()
    uri = await loop.run_in_executor(None, _upload)
    return uri


async def get_session_log(session_id: str, date_prefix: str | None = None) -> dict[str, Any] | None:
    """
    Retrieve a session log from GCS by session_id.

    Args:
        session_id: UUID string.
        date_prefix: Optional YYYY/MM/DD prefix to narrow the search.

    Returns:
        Parsed JSON dict or None if not found.
    """
    import asyncio

    bucket_name = _get_bucket_name()
    if date_prefix:
        object_name = f"sessions/{date_prefix}/{session_id}.json"
        prefix = None
    else:
        object_name = None
        prefix = f"sessions/"

    def _download() -> dict[str, Any] | None:
        client = _get_client()
        bucket = client.bucket(bucket_name)

        if object_name:
            blob = bucket.blob(object_name)
            if blob.exists():
                data = blob.download_as_string()
                return json.loads(data)
            return None

        # Search by prefix if no date given
        for blob in client.list_blobs(bucket, prefix=prefix):
            if session_id in blob.name:
                data = blob.download_as_string()
                return json.loads(data)
        return None

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _download)


async def ensure_bucket_exists() -> None:
    """Create the session log bucket if it doesn't exist."""
    import asyncio

    bucket_name = _get_bucket_name()
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")

    def _create():
        client = _get_client()
        try:
            client.get_bucket(bucket_name)
            logger.info("Bucket %s already exists", bucket_name)
        except Exception:
            client.create_bucket(
                bucket_name,
                project=project,
                location="US",
            )
            logger.info("Created bucket %s", bucket_name)

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _create)
