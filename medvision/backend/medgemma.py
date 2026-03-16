"""
medgemma.py — Local MedGemma 4B-IT inference wrapper.

Loads google/medgemma-4b-it on the local NVIDIA GPU.
  - ≥ 8 GB VRAM → float16 (full precision, faster inference)
  - < 8 GB VRAM → 4-bit BitsAndBytes quantization (fits in 6 GB)
  - CPU fallback if no CUDA device is found

Environment variables consumed:
  HUGGINGFACE_TOKEN   — required to download the gated model on first run
  MEDGEMMA_DEVICE     — "cuda" | "cpu"  (default: auto-detect)
  MEDGEMMA_ENABLED    — set to "true" to activate (default: false)
"""

from __future__ import annotations

import io
import logging
import os
import re
import time
from typing import Optional

logger = logging.getLogger(__name__)

_MODEL_ID = "google/medgemma-4b-it"


def _resolve_model_path() -> str:
    """Return local path if MEDGEMMA_MODEL_PATH is set, otherwise HF Hub ID."""
    local = os.environ.get("MEDGEMMA_MODEL_PATH", "").strip()
    if local:
        import pathlib
        p = pathlib.Path(local)
        if p.exists() and p.is_dir():
            logger.info("MedGemma: using local directory %s", local)
            return str(p)
        else:
            logger.warning("MEDGEMMA_MODEL_PATH=%s not found — falling back to HF Hub", local)
    return _MODEL_ID

# ── Prompt sent with every frame ───────────────────────────────────────────
_ANALYSIS_PROMPT = """You are a medical AI assistant performing emergency triage.
Analyse the image and respond with EXACTLY this format (no other text):

CONDITION: <one snake_case medical condition or "none_detected">
CONFIDENCE: <high|medium|low>
SEVERITY: <immediate|urgent|stable|none>
OBSERVATION: <one sentence describing what you see>

Focus on: skin colour, body posture, visible injuries, breathing distress,
consciousness level, external bleeding."""


def _parse_response(text: str) -> dict:
    """Extract structured fields from the model's text output."""
    result = {
        "condition": "none_detected",
        "confidence": "low",
        "severity": "none",
        "observation": text.strip()[:200],
    }
    for line in text.splitlines():
        line = line.strip()
        if line.upper().startswith("CONDITION:"):
            val = line.split(":", 1)[1].strip().lower()
            result["condition"] = re.sub(r"[^a-z0-9_]", "_", val)[:50]
        elif line.upper().startswith("CONFIDENCE:"):
            val = line.split(":", 1)[1].strip().lower()
            if val in ("high", "medium", "low"):
                result["confidence"] = val
        elif line.upper().startswith("SEVERITY:"):
            val = line.split(":", 1)[1].strip().lower()
            if val in ("immediate", "urgent", "stable", "none"):
                result["severity"] = val
        elif line.upper().startswith("OBSERVATION:"):
            result["observation"] = line.split(":", 1)[1].strip()[:200]
    return result


class MedGemmaAnalyser:
    """
    Wraps the MedGemma 4B-IT model for single-image medical analysis.

    Usage::

        analyser = MedGemmaAnalyser()
        analyser.load()          # blocks ~30–60 s first time (model downloads)
        result = analyser.analyse_frame(jpeg_bytes)
        # result = {"condition": "chest_pain", "confidence": "high",
        #           "severity": "immediate", "observation": "..."}
    """

    def __init__(self) -> None:
        self._model = None
        self._processor = None
        self._device: str = "cpu"
        self._ready = False
        self._error: Optional[str] = None
        self._load_time: Optional[float] = None

    # ── Loading ────────────────────────────────────────────────────────────

    def load(self) -> None:
        """Load model onto GPU/CPU. Call once at startup."""
        if self._ready:
            return
        try:
            self._do_load()
        except Exception as exc:
            self._error = str(exc)
            logger.error("MedGemma load failed: %s", exc, exc_info=True)
            raise

    def _do_load(self) -> None:
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText, BitsAndBytesConfig

        hf_token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
        model_path = _resolve_model_path()
        # Token is only required for HF Hub downloads, not local directories
        using_local = model_path != _MODEL_ID
        if not hf_token and not using_local:
            raise RuntimeError(
                "HUGGINGFACE_TOKEN not set. "
                "Accept model terms at https://huggingface.co/google/medgemma-4b-it "
                "then add your token to backend/.env  "
                "(or set MEDGEMMA_MODEL_PATH to a local clone)"
            )

        kwargs_base = {"token": hf_token} if (hf_token and not using_local) else {}

        device_env = os.environ.get("MEDGEMMA_DEVICE", "auto").lower()
        if device_env == "cpu":
            use_cuda = False
        else:
            use_cuda = torch.cuda.is_available()

        t0 = time.time()
        logger.info("Loading MedGemma 4B from %s  cuda=%s", model_path, use_cuda)

        self._processor = AutoProcessor.from_pretrained(
            model_path,
            **kwargs_base,
        )

        if use_cuda:
            vram_bytes = torch.cuda.get_device_properties(0).total_memory
            vram_gb = vram_bytes / (1024 ** 3)
            logger.info("GPU VRAM: %.1f GB", vram_gb)

            if vram_gb >= 8.0:
                logger.info("Loading in float16 (sufficient VRAM)")
                self._model = AutoModelForImageTextToText.from_pretrained(
                    model_path,
                    **kwargs_base,
                    torch_dtype=torch.float16,
                    device_map="cuda",
                )
                self._device = "cuda"
            else:
                logger.info("Loading in 4-bit quantization (limited VRAM: %.1f GB)", vram_gb)
                bnb_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_compute_dtype=torch.float16,
                )
                self._model = AutoModelForImageTextToText.from_pretrained(
                    model_path,
                    **kwargs_base,
                    quantization_config=bnb_config,
                    device_map="cuda",
                )
                self._device = "cuda"
        else:
            logger.warning("No CUDA — loading MedGemma on CPU (inference will be slow)")
            self._model = AutoModelForImageTextToText.from_pretrained(
                model_path,
                **kwargs_base,
                torch_dtype="auto",
                device_map="cpu",
            )
            self._device = "cpu"

        self._model.eval()
        self._load_time = time.time() - t0
        self._ready = True
        logger.info("MedGemma ready in %.1f s  device=%s", self._load_time, self._device)

    # ── Inference ──────────────────────────────────────────────────────────

    def analyse_frame(self, jpeg_bytes: bytes) -> dict:
        """
        Run visual medical analysis on a JPEG frame.

        Returns dict with keys: condition, confidence, severity, observation.
        Returns a 'none_detected' result if the model is not loaded or on error.
        """
        if not self._ready or self._model is None:
            return {
                "condition": "none_detected",
                "confidence": "low",
                "severity": "none",
                "observation": "MedGemma not loaded",
            }

        try:
            from PIL import Image
            import torch

            image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")

            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image", "image": image},
                        {"type": "text", "text": _ANALYSIS_PROMPT},
                    ],
                }
            ]

            inputs = self._processor.apply_chat_template(
                messages,
                add_generation_prompt=True,
                tokenize=True,
                return_dict=True,
                return_tensors="pt",
            ).to(self._device)

            with torch.inference_mode():
                output_ids = self._model.generate(
                    **inputs,
                    max_new_tokens=128,
                    do_sample=False,
                )

            # Decode only the newly generated tokens
            input_len = inputs["input_ids"].shape[1]
            new_tokens = output_ids[0][input_len:]
            raw_text = self._processor.decode(new_tokens, skip_special_tokens=True)
            logger.debug("MedGemma raw: %s", raw_text[:200])
            return _parse_response(raw_text)

        except Exception as exc:
            logger.error("MedGemma inference error: %s", exc, exc_info=True)
            return {
                "condition": "none_detected",
                "confidence": "low",
                "severity": "none",
                "observation": f"Inference error: {exc}",
            }

    # ── Status ─────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "ready": self._ready,
            "device": self._device,
            "model": _MODEL_ID,
            "load_time_s": round(self._load_time, 1) if self._load_time else None,
            "error": self._error,
        }
