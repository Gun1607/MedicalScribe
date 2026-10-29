"""
MedicalScribe 2.0 — FastAPI backend
====================================
Ultra-fast Groq LPU Cloud integration with Local Whisper + Ollama fallback.
Run with:  python main.py   or   uvicorn main:app --reload
"""

import json
import logging
import os
import re
import tempfile
import time
from contextlib import asynccontextmanager
from typing import List, Optional

import ollama
from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from sqlalchemy.orm import Session

from config import settings
from db import (
    add_rule,
    get_db,
    get_rules,
    get_rules_string,
    get_visit_by_id,
    get_visits,
    save_visit,
)
from groq_client import (
    GroqError,
    generate_notes_groq,
    transcribe_audio_groq,
)
from models import (
    DictionaryResponse,
    DictionaryRuleOut,
    HealthResponse,
    LearnRequest,
    LearnResponse,
    StructuredNote,
    TranscribeResponse,
    VisitOut,
)
from prompt import MASTER_PROMPT

# --------------------------------------------------------------------------- #
#  Logging
# --------------------------------------------------------------------------- #

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("medicalscribe")


# --------------------------------------------------------------------------- #
#  Lifespan — load resources
# --------------------------------------------------------------------------- #

def _load_local_whisper() -> WhisperModel:
    """Helper to instantiate local Whisper model with optimized CPU settings."""
    logger.info(
        "Loading local Whisper model (model=%s, device=%s, compute_type=%s) …",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )
    logger.info("Local Whisper model loaded successfully.")
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load heavy resources at startup or defer if Groq is enabled."""
    app.state.whisper_model = None
    if settings.use_groq and settings.groq_api_key.strip():
        logger.info(
            "⚡ Groq Cloud LPU mode enabled! (Whisper: %s, LLM: %s). Startup instantaneous.",
            settings.groq_whisper_model,
            settings.groq_llm_model,
        )
    else:
        logger.info("Local mode active. Loading local Whisper model...")
        app.state.whisper_model = _load_local_whisper()

    yield
    logger.info("Shutting down…")


# --------------------------------------------------------------------------- #
#  App
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="MedicalScribe API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------- #
#  Local LLM / JSON Helpers
# --------------------------------------------------------------------------- #

def _call_ollama(prompt: str, retries: int = 3, initial_delay: float = 1.0) -> str:
    """Call Ollama with retry logic and exponential backoff."""
    delay = initial_delay
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            response = ollama.chat(
                model=settings.ollama_model,
                messages=[{"role": "user", "content": prompt}],
            )
            return response["message"]["content"].strip()
        except Exception as exc:
            last_exc = exc
            logger.warning("Ollama call attempt %d failed: %s", attempt, exc)
            if attempt < retries:
                time.sleep(delay)
                delay *= 2.0
    raise last_exc


def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences and extract JSON object from LLM output."""
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    json_match = re.search(r"\{[\s\S]*\}", text)
    if json_match:
        text = json_match.group()
    return text.strip()


# --------------------------------------------------------------------------- #
#  Endpoints
# --------------------------------------------------------------------------- #

@app.get("/api/health", response_model=HealthResponse)
async def health(request: Request):
    """Check readiness of Groq Cloud, local Whisper, and Ollama."""
    groq_key = settings.groq_api_key.strip()
    groq_configured = bool(groq_key)

    whisper_loaded = hasattr(request.app.state, "whisper_model") and request.app.state.whisper_model is not None

    ollama_connected = False
    try:
        ollama.list()
        ollama_connected = True
    except Exception:
        pass

    provider = "groq" if (settings.use_groq and groq_configured) else "local"
    status_str = "ok" if (groq_configured or (whisper_loaded and ollama_connected)) else "needs_config"

    return HealthResponse(
        status=status_str,
        provider=provider,
        groq_configured=groq_configured,
        groq_model=settings.groq_llm_model if groq_configured else "",
        whisper_loaded=whisper_loaded,
        ollama_connected=ollama_connected,
        ollama_model=settings.ollama_model,
    )


@app.post("/api/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: UploadFile,
    doctor_id: str = Form(...),
    groq_api_key: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """
    Transcribe audio and return structured medical notes.
    Uses Groq Cloud (Option A, ~1.5s latency) if configured,
    or falls back to optimized local Whisper + Ollama.
    """
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided.")

    # --- Size validation ---
    audio_bytes = await audio.read()
    if len(audio_bytes) > settings.max_audio_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file exceeds the {settings.max_audio_size_mb} MB limit.",
        )

    # Determine effective Groq API Key
    effective_groq_key = (groq_api_key or settings.groq_api_key or "").strip()
    use_groq = settings.use_groq and bool(effective_groq_key)

    raw_transcript = ""
    result_text = ""

    # ----------------------------------------------------------------------- #
    #  Option A: Groq Cloud LPU Pipeline (Whisper Large V3 + Llama 3.3 70B)
    # ----------------------------------------------------------------------- #
    if use_groq:
        logger.info("🚀 Processing with Groq Cloud LPU pipeline...")
        total_start = time.perf_counter()

        try:
            # 1. Speech-to-Text via Groq Whisper Large V3
            raw_transcript = transcribe_audio_groq(
                audio_bytes=audio_bytes,
                filename=audio.filename,
                api_key=effective_groq_key,
                model=settings.groq_whisper_model,
            )

            # 2. Build prompt with learned dictionary rules
            dictionary_rules = get_rules_string(db, doctor_id)
            prompt = (
                f"{MASTER_PROMPT}\n\n"
                f"DOCTOR DICTIONARY:\n{dictionary_rules}\n\n"
                f"RAW TRANSCRIPT:\n{raw_transcript}"
            )

            # 3. Clinical entity extraction via Groq Llama 3.3 70B
            result_text = generate_notes_groq(
                prompt=prompt,
                api_key=effective_groq_key,
                model=settings.groq_llm_model,
            )

            total_elapsed = time.perf_counter() - total_start
            logger.info("✨ Total Groq turnaround: %.2f seconds!", total_elapsed)

        except GroqError as g_err:
            logger.error("Groq Cloud error: %s", g_err)
            raise HTTPException(
                status_code=502,
                detail=f"Groq API Error: {g_err}. Please verify your GROQ_API_KEY.",
            )

    # ----------------------------------------------------------------------- #
    #  Fallback: Local Whisper + Ollama
    # ----------------------------------------------------------------------- #
    else:
        logger.info("🖥️ Processing with local CPU pipeline (Whisper + Ollama)...")
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
            temp_audio.write(audio_bytes)
            temp_audio_path = temp_audio.name

        try:
            # Ensure local model is loaded
            if request.app.state.whisper_model is None:
                request.app.state.whisper_model = _load_local_whisper()

            whisper_model: WhisperModel = request.app.state.whisper_model
            # Optimized local settings: greedy search (beam_size=1) + Silero VAD
            segments, _info = whisper_model.transcribe(
                temp_audio_path,
                beam_size=1,
                vad_filter=True,
                language="en",
            )
            raw_transcript = " ".join(segment.text for segment in segments)
            logger.info("Local Whisper transcription complete (%d chars).", len(raw_transcript))

            # Build prompt
            dictionary_rules = get_rules_string(db, doctor_id)
            prompt = (
                f"{MASTER_PROMPT}\n\n"
                f"DOCTOR DICTIONARY:\n{dictionary_rules}\n\n"
                f"RAW TRANSCRIPT:\n{raw_transcript}"
            )

            # Ollama inference
            try:
                result_text = _call_ollama(prompt)
            except ollama.ResponseError as exc:
                logger.error("Ollama response error: %s", exc.error)
                raise HTTPException(status_code=500, detail=f"Ollama Error: {exc.error}")
            except Exception as exc:
                logger.error("Ollama connection error: %s", exc)
                raise HTTPException(
                    status_code=500,
                    detail="Failed to connect to Ollama. Is it running? "
                           f"Run 'ollama run {settings.ollama_model}' or configure GROQ_API_KEY for instant processing.",
                )

        finally:
            if os.path.exists(temp_audio_path):
                os.remove(temp_audio_path)

    # ----------------------------------------------------------------------- #
    #  Parse & Store Output
    # ----------------------------------------------------------------------- #
    result_text = _strip_markdown_fences(result_text)

    try:
        parsed_json = json.loads(result_text)
    except json.JSONDecodeError:
        logger.error("Failed to parse JSON: %s", result_text[:500])
        raise HTTPException(status_code=500, detail="Failed to parse LLM response into structured JSON.")

    structured = StructuredNote.model_validate(parsed_json)
    patient_name: Optional[str] = parsed_json.get("patient", {}).get("name") or None

    # Persist visit
    visit = save_visit(
        db=db,
        doctor_id=doctor_id,
        patient_name=patient_name,
        raw_transcript=raw_transcript,
        structured_notes=json.dumps(parsed_json),
    )
    logger.info("Visit saved successfully (id=%d, doctor=%s).", visit.id, doctor_id)

    return TranscribeResponse(
        visit_id=visit.id,
        raw_transcript=raw_transcript,
        structured_notes=structured,
    )


@app.post("/api/learn", response_model=LearnResponse)
async def learn(request: LearnRequest, db: Session = Depends(get_db)):
    """Add or update dictionary correction rules for a doctor."""
    for correction in request.corrections:
        add_rule(db, request.doctor_id, correction.misheard, correction.correct)
    logger.info("Learned %d corrections for doctor %s.", len(request.corrections), request.doctor_id)
    return LearnResponse(status="success")


@app.get("/api/dictionary/{doctor_id}", response_model=DictionaryResponse)
async def get_dictionary(doctor_id: str, db: Session = Depends(get_db)):
    """Retrieve all dictionary rules for a doctor."""
    rules = get_rules(db, doctor_id)
    return DictionaryResponse(
        doctor_id=doctor_id,
        rules=[DictionaryRuleOut.model_validate(r) for r in rules],
    )


@app.get("/api/visits", response_model=List[VisitOut])
async def list_visits(doctor_id: str, db: Session = Depends(get_db)):
    """List all visits for a doctor."""
    visits = get_visits(db, doctor_id)
    return [VisitOut.model_validate(v) for v in visits]


@app.get("/api/visits/{visit_id}", response_model=VisitOut)
async def get_visit(visit_id: int, db: Session = Depends(get_db)):
    """Retrieve a single visit by ID."""
    visit = get_visit_by_id(db, visit_id)
    if not visit:
        raise HTTPException(status_code=404, detail="Visit not found.")
    return VisitOut.model_validate(visit)


# --------------------------------------------------------------------------- #
#  Entrypoint
# --------------------------------------------------------------------------- #

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
