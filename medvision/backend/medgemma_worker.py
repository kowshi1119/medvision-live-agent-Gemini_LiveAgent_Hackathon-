"""
medgemma_worker.py — Background thread for non-blocking MedGemma inference.

Keeps the asyncio event loop free.  The worker:
  - Runs in a daemon thread started at app startup.
  - Accepts frames via submit_frame()  (never blocks; drops oldest if full).
  - Exposes results via get_result()   (returns latest dict or None).

Usage::

    worker = MedGemmaWorker(analyser)
    worker.start()                    # call once

    worker.submit_frame(jpeg_bytes)   # from async video-frame handler
    result = worker.get_result()      # returns dict or None
    worker.stop()                     # graceful shutdown
"""

from __future__ import annotations

import logging
import queue
import threading
from typing import Optional

logger = logging.getLogger(__name__)

_SENTINEL = object()  # signals the worker thread to exit


class MedGemmaWorker:
    """
    Wraps a MedGemmaAnalyser in a dedicated daemon thread with a bounded queue.

    frame_queue  maxsize=3  — if all 3 slots are full the oldest is discarded
                              so the worker always processes the freshest frame.
    result_queue maxsize=10 — latest results; caller reads the last one.
    """

    def __init__(self, analyser) -> None:
        self._analyser = analyser
        self._frame_q: queue.Queue = queue.Queue(maxsize=3)
        self._result_q: queue.Queue = queue.Queue(maxsize=10)
        self._thread: Optional[threading.Thread] = None
        self._running = False

    # ── Lifecycle ──────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the background worker thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._run,
            name="medgemma-worker",
            daemon=True,
        )
        self._thread.start()
        logger.info("MedGemmaWorker started")

    def stop(self) -> None:
        """Signal the worker to exit and wait for it to finish."""
        self._running = False
        try:
            self._frame_q.put_nowait(_SENTINEL)
        except queue.Full:
            pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=5.0)
        logger.info("MedGemmaWorker stopped")

    # ── Public API ─────────────────────────────────────────────────────────

    def submit_frame(self, jpeg_bytes: bytes) -> None:
        """
        Queue a JPEG frame for analysis.  Never blocks.
        If the queue is full, the oldest item is discarded to make room.
        """
        if not self._running:
            return
        # Discard the oldest frame if queue is at capacity
        if self._frame_q.full():
            try:
                self._frame_q.get_nowait()
            except queue.Empty:
                pass
        try:
            self._frame_q.put_nowait(jpeg_bytes)
        except queue.Full:
            pass  # extremely unlikely after the discard above

    def get_result(self) -> Optional[dict]:
        """
        Return the most recent result dict, or None if nothing is ready.
        Drains the result queue to keep only the freshest result.
        """
        latest = None
        while True:
            try:
                latest = self._result_q.get_nowait()
            except queue.Empty:
                break
        return latest

    # ── Worker loop ────────────────────────────────────────────────────────

    def _run(self) -> None:
        logger.info("MedGemmaWorker thread running")
        while self._running:
            try:
                item = self._frame_q.get(timeout=1.0)
            except queue.Empty:
                continue

            if item is _SENTINEL:
                break

            jpeg_bytes: bytes = item
            result = self._analyser.analyse_frame(jpeg_bytes)
            logger.debug(
                "MedGemma result: %s  conf=%s  sev=%s",
                result.get("condition"),
                result.get("confidence"),
                result.get("severity"),
            )

            # Drain result queue if full to avoid stale results accumulating
            if self._result_q.full():
                try:
                    self._result_q.get_nowait()
                except queue.Empty:
                    pass
            try:
                self._result_q.put_nowait(result)
            except queue.Full:
                pass

        logger.info("MedGemmaWorker thread exiting")
