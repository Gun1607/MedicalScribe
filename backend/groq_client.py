"""
Groq Cloud API integration for MedicalScribe 2.0.
Ultra-fast Speech-to-Text (Whisper Large V3) and Clinical JSON generation.
Built with httpx — zero extra dependencies.
Includes dynamic model discovery and automatic fallback across active Groq models.
"""

import json
import logging
import time
from typing import List, Optional
import httpx

logger = logging.getLogger("medicalscribe.groq")

GROQ_BASE_URL = "https://api.groq.com/openai/v1"

_CACHED_MODELS: List[str] = []
_CACHE_TIMESTAMP: float = 0.0


class GroqError(Exception):
    """Custom exception for Groq API errors."""
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


def transcribe_audio_groq(
    audio_bytes: bytes,
    filename: str,
    api_key: str,
    model: str = "whisper-large-v3-turbo",
    retries: int = 3,
    timeout: float = 30.0,
) -> str:
    """
    Transcribe audio bytes using Groq Whisper Large V3.
    Typically completes in 300ms - 800ms.
    """
    if not api_key:
        raise GroqError("Groq API key is not configured.", status_code=401)

    url = f"{GROQ_BASE_URL}/audio/transcriptions"
    headers = {
        "Authorization": f"Bearer {api_key}",
    }

    # Ensure appropriate file extension
    ext = "webm"
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    upload_filename = f"audio.{ext}"

    files = {
        "file": (upload_filename, audio_bytes, f"audio/{ext}"),
    }
    data = {
        "model": model,
        "response_format": "json",
        "temperature": "0.0",
    }

    delay = 1.0
    for attempt in range(1, retries + 1):
        try:
            logger.info("Transcribing audio via Groq Whisper (%s, %d bytes, attempt %d)...", model, len(audio_bytes), attempt)
            start_t = time.perf_counter()
            with httpx.Client(timeout=timeout) as client:
                response = client.post(url, headers=headers, files=files, data=data)

            elapsed = time.perf_counter() - start_t

            if response.status_code == 200:
                result = response.json()
                raw_text = result.get("text", "").strip()
                logger.info("Groq Whisper transcription completed in %.2fs (%d characters).", elapsed, len(raw_text))
                return raw_text

            if response.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                logger.warning("Groq transcription transient status %d on attempt %d: %s", response.status_code, attempt, response.text)
                time.sleep(delay)
                delay *= 2.0
                continue

            error_detail = response.text
            try:
                error_json = response.json()
                error_detail = error_json.get("error", {}).get("message", response.text)
            except Exception:
                pass

            raise GroqError(f"Groq Whisper error ({response.status_code}): {error_detail}", status_code=response.status_code)

        except (httpx.TimeoutException, httpx.NetworkError) as net_err:
            logger.warning("Groq transcription network error on attempt %d: %s", attempt, net_err)
            if attempt == retries:
                raise GroqError(f"Failed to connect to Groq Audio API after {retries} attempts: {net_err}")
            time.sleep(delay)
            delay *= 2.0


def get_active_groq_chat_models(api_key: str) -> List[str]:
    """
    Dynamically fetch active chat models directly from Groq's /models endpoint.
    Caches the list for 5 minutes.
    """
    global _CACHED_MODELS, _CACHE_TIMESTAMP
    now = time.time()
    if _CACHED_MODELS and (now - _CACHE_TIMESTAMP < 300):
        return _CACHED_MODELS

    try:
        url = f"{GROQ_BASE_URL}/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        with httpx.Client(timeout=6.0) as client:
            res = client.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json().get("data", [])
                chat_models = []
                for item in data:
                    model_id = item.get("id", "")
                    is_active = item.get("active", True)
                    lower = model_id.lower()
                    # Exclude non-chat models
                    if (
                        is_active
                        and "whisper" not in lower
                        and "guard" not in lower
                        and "embed" not in lower
                    ):
                        chat_models.append(model_id)

                if chat_models:
                    logger.info("Discovered %d active Groq chat models from API: %s", len(chat_models), chat_models)
                    _CACHED_MODELS = chat_models
                    _CACHE_TIMESTAMP = now
                    return chat_models
    except Exception as exc:
        logger.warning("Could not dynamically query Groq /models endpoint: %s", exc)

    return _CACHED_MODELS or [
        "llama-3.3-70b-specdec",
        "llama-3.2-3b-preview",
        "llama-3.2-1b-preview",
        "mixtral-8x7b-32768",
        "gemma2-9b-it",
    ]


def generate_notes_groq(
    prompt: str,
    api_key: str,
    model: str = "llama-3.1-8b-instant",
    retries: int = 3,
    timeout: float = 30.0,
) -> str:
    """
    Generate structured clinical notes from transcript via Groq LPU models.
    Discovers active Groq models and automatically falls back if a model is decommissioned or not found.
    Typically completes in 400ms - 900ms.
    """
    if not api_key:
        raise GroqError("Groq API key is not configured.", status_code=401)

    url = f"{GROQ_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Query active models dynamically from Groq
    active_models = get_active_groq_chat_models(api_key)

    # Build ordered candidate list to try
    candidates: List[str] = []
    if model in active_models:
        candidates.append(model)
    elif model:
        candidates.append(model)

    for m in active_models:
        if m not in candidates:
            candidates.append(m)

    logger.info("Groq candidate models sequence: %s", candidates[:5])

    last_error = ""

    for current_model in candidates:
        payload = {
            "model": current_model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a professional medical scribe. Output only valid JSON matching the exact schema requested.",
                },
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }

        delay = 1.0
        model_failed = False

        for attempt in range(1, retries + 1):
            try:
                logger.info("Generating clinical notes via Groq (%s, attempt %d)...", current_model, attempt)
                start_t = time.perf_counter()
                with httpx.Client(timeout=timeout) as client:
                    response = client.post(url, headers=headers, json=payload)

                elapsed = time.perf_counter() - start_t

                if response.status_code == 200:
                    result = response.json()
                    choices = result.get("choices", [])
                    if choices and "message" in choices[0]:
                        content = choices[0]["message"].get("content", "").strip()
                        logger.info(
                            "Groq LLM note generation completed in %.2fs (%d characters) using model %s.",
                            elapsed,
                            len(content),
                            current_model,
                        )
                        return content
                    raise GroqError("Groq returned an empty response.")

                error_detail = response.text
                try:
                    error_json = response.json()
                    error_detail = error_json.get("error", {}).get("message", response.text)
                except Exception:
                    pass

                # Check if model is decommissioned, not found, or access restricted
                is_model_unavailable = (
                    response.status_code == 404
                    or (response.status_code == 400 and any(
                        keyword in error_detail.lower()
                        for keyword in ["decommissioned", "not supported", "does not exist", "deprecated"]
                    ))
                )

                if is_model_unavailable:
                    logger.warning(
                        "Groq model '%s' unavailable (%d: %s). Trying next available model...",
                        current_model,
                        response.status_code,
                        error_detail,
                    )
                    last_error = f"Model {current_model} unavailable: {error_detail}"
                    model_failed = True
                    break  # break inner attempt loop to try next candidate model

                # Transient errors: 429, 500, 502, 503, 504
                if response.status_code in (429, 500, 502, 503, 504) and attempt < retries:
                    logger.warning("Groq LLM transient status %d on attempt %d: %s", response.status_code, attempt, error_detail)
                    time.sleep(delay)
                    delay *= 2.0
                    continue

                last_error = f"Groq LLM error ({response.status_code}): {error_detail}"
                model_failed = True
                break

            except (httpx.TimeoutException, httpx.NetworkError) as net_err:
                logger.warning("Groq LLM network error on attempt %d: %s", attempt, net_err)
                if attempt == retries:
                    last_error = f"Failed to connect to Groq Chat API after {retries} attempts: {net_err}"
                    model_failed = True
                time.sleep(delay)
                delay *= 2.0

        if not model_failed:
            # If it didn't fail, it already returned successfully
            pass

    raise GroqError(last_error or "All Groq model attempts failed.")


def check_groq_health(api_key: str) -> bool:
    """Verify whether the Groq API key is valid and responsive."""
    if not api_key:
        return False
    try:
        url = f"{GROQ_BASE_URL}/models"
        headers = {"Authorization": f"Bearer {api_key}"}
        with httpx.Client(timeout=5.0) as client:
            res = client.get(url, headers=headers)
            return res.status_code == 200
    except Exception:
        return False
