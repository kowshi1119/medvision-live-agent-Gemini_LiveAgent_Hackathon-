"""
MedVision — Triage card parser.

Extracts [TRIAGE_CARD]{...}[/TRIAGE_CARD] markers from Gemini streaming
text and returns validated dicts with keys:
    condition, priority, steps, reference

Design:
  - TriageParser is STATEFUL: one instance per session so cards that
    arrive split across multiple streaming chunks are buffered correctly.
  - Malformed JSON and validation failures are logged and skipped —
    the bad block is consumed from the buffer to prevent infinite loops.
  - flush() must be called at turn-complete to catch cards that arrived
    entirely inside the final streaming payload.
  - _validate normalises field names because Gemini sometimes emits
    "who_reference" or "protocol_reference" instead of "reference".
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("medvision.triage")

# Matches one complete [TRIAGE_CARD]{...}[/TRIAGE_CARD] block.
# re.DOTALL so the JSON body can span multiple lines.
# The lazy .*? + explicit [/TRIAGE_CARD] anchor correctly captures
# JSON that contains nested arrays (e.g. the "steps" field).
_TRIAGE_RE = re.compile(
    r"\[TRIAGE_CARD\]\s*(\{.*?\})\s*\[/TRIAGE_CARD\]",
    re.DOTALL,
)

VALID_PRIORITIES = {"immediate", "urgent", "delayed"}


class TriageParser:
    """
    Stateful streaming parser for [TRIAGE_CARD] blocks.

    Usage — one instance per WebSocket session:
        parser = TriageParser()
        ...
        cards = parser.process(chunk)   # call for every partial text chunk
        cards = parser.flush()          # call once at turn-complete
    """

    def __init__(self) -> None:
        self._buffer: str = ""

    def process(self, chunk: str) -> list[dict[str, Any]]:
        """
        Append *chunk* to the internal buffer and extract every complete
        [TRIAGE_CARD] block found so far.  Returns a (possibly empty)
        list of validated card dicts.  Invalid blocks are logged,
        consumed, and skipped so the loop never stalls.
        """
        self._buffer += chunk
        return self._extract_all()

    def flush(self) -> list[dict[str, Any]]:
        """
        Force-extract whatever complete blocks remain in the buffer.
        Call this once at turn-complete to catch cards that arrived
        entirely inside the final streaming payload.
        Clears the buffer after extraction.
        """
        cards = self._extract_all()
        self._buffer = ""
        return cards

    def clean(self, text: str) -> str:
        """Strip TRIAGE_CARD blocks from text and return display-safe transcript."""
        return _TRIAGE_RE.sub("", text)

    # ── internal ──────────────────────────────────────────────────────────────

    def _extract_all(self) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        while True:
            match = _TRIAGE_RE.search(self._buffer)
            if not match:
                break
            json_str = match.group(1)
            try:
                raw: dict[str, Any] = json.loads(json_str)
                card = _validate(raw)
                cards.append(card)
                logger.info(
                    "Triage card extracted: condition=%s priority=%s steps=%d",
                    card["condition"],
                    card["priority"],
                    len(card["steps"]),
                )
            except json.JSONDecodeError as exc:
                logger.error(
                    "Triage card JSON parse error: %s | snippet: %.200s",
                    exc,
                    json_str,
                )
            except ValueError as exc:
                logger.error("Triage card validation error: %s", exc)

            # Always consume the matched block (even on error) so we
            # never loop forever on the same malformed block.
            self._buffer = (
                self._buffer[: match.start()] + self._buffer[match.end():]
            )

        return cards


# ── Validation ────────────────────────────────────────────────────────────────

def _validate(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Normalise and validate a raw parsed card dict.
    Always emits a card — partial cards are better than no card for the demo.

    Defaults:
      condition  → "unknown_condition"  (never raises on missing)
      priority   → "urgent"             (safer than delayed)
      steps      → auto-filled from get_who_protocol when empty
      reference  → "WHO ETAT 2016"
      timestamp  → current server time when missing or placeholder
    """
    condition = str(raw.get("condition", "")).strip().lower().replace(" ", "_")
    if not condition:
        logger.warning("Triage card missing 'condition' — using 'unknown_condition'")
        condition = "unknown_condition"

    priority = str(raw.get("priority", "urgent")).lower().strip()
    if priority not in VALID_PRIORITIES:
        logger.warning("Unknown priority %r — defaulting to 'urgent'", priority)
        priority = "urgent"

    steps_raw = raw.get("steps", [])
    if not isinstance(steps_raw, list):
        logger.warning("Field 'steps' is not a list (%s) — will auto-fill", type(steps_raw).__name__)
        steps_raw = []
    steps: list[str] = [str(s).strip() for s in steps_raw if str(s).strip()]

    # Auto-fill steps from protocol when the list is empty
    if not steps and condition != "unknown_condition":
        try:
            from agent import get_who_protocol  # delayed import to avoid circular dep
            protocol = get_who_protocol(condition)
            steps = [str(s) for s in protocol.get("steps", [])]
            logger.info("Triage card steps auto-filled from protocol for: %s", condition)
        except Exception as exc:
            logger.debug("Could not auto-fill steps from protocol: %s", exc)

    # Gemini may use any of these key names for the protocol citation
    reference = str(
        raw.get("reference")
        or raw.get("who_reference")
        or raw.get("protocol_reference")
        or "WHO ETAT 2016"
    ).strip()

    # Timestamp — use server time when missing or when Gemini emits a placeholder
    raw_ts = str(raw.get("timestamp") or raw.get("ts") or "")
    if not raw_ts or raw_ts.upper().startswith("TIMESTAMP") or raw_ts == "2024-01-01T00:00:00Z":
        timestamp = datetime.now(timezone.utc).isoformat()
    else:
        timestamp = raw_ts

    return {
        "condition": condition,
        "priority": priority,
        "steps": steps,
        "reference": reference,
        "timestamp": timestamp,
    }
