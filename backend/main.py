"""
MedicalScribe 2.0 — FastAPI backend
====================================
Run with:  python main.py   or   uvicorn main:app --reload
"""

import json
import logging
import os
import re
import tempfile
from contextlib import asynccontextmanager
from typing import List, Optional

import ollama
from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import time
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
#  Lifespan — load Whisper model on startup
# --------------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load heavy resources at startup and clean up on shutdown."""
    logger.info(
        "Loading Whisper model (model=%s, device=%s, compute_type=%s) …",
        settings.whisper_model,
        settings.whisper_device,
        settings.whisper_compute_type,
    )
    app.state.whisper_model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )
    logger.info("Whisper model loaded.")
    yield
    logger.info("Shutting down…")


# --------------------------------------------------------------------------- #
#  App
# --------------------------------------------------------------------------- #

app = FastAPI(
    title="MedicalScribe API",
    version="1.0.0",
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
#  Helpers
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
    # Strip leading/trailing markdown fences
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text)
    # Try to extract JSON object if there's extra text around it
    json_match = re.search(r"\{[\s\S]*\}", text)
    if json_match:
        text = json_match.group()
    return text.strip()


# --------------------------------------------------------------------------- #
#  Endpoints
# --------------------------------------------------------------------------- #

@app.get("/api/health", response_model=HealthResponse)
async def health(request: Request):
    """Check readiness of Whisper and Ollama."""
    whisper_loaded = hasattr(request.app.state, "whisper_model") and request.app.state.whisper_model is not None

    ollama_connected = False
    try:
        ollama.list()
        ollama_connected = True
    except Exception:
        pass

    return HealthResponse(
        status="ok" if (whisper_loaded and ollama_connected) else "degraded",
        whisper_loaded=whisper_loaded,
        ollama_connected=ollama_connected,
        ollama_model=settings.ollama_model,
    )


@app.post("/api/transcribe", response_model=TranscribeResponse)
async def transcribe(
    request: Request,
    audio: UploadFile,
    doctor_id: str = Form(...),
    db: Session = Depends(get_db),
):
    """Transcribe an audio file and return structured medical notes."""
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided.")

    # --- size validation ---
    audio_bytes = await audio.read()
    if len(audio_bytes) > settings.max_audio_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file exceeds the {settings.max_audio_size_mb} MB limit.",
        )

    # Save to temp file (suffix .webm for browser-recorded audio)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        temp_audio.write(audio_bytes)
        temp_audio_path = temp_audio.name

    try:
        # Transcribe with faster-whisper
        whisper_model: WhisperModel = request.app.state.whisper_model
        segments, _info = whisper_model.transcribe(temp_audio_path, beam_size=1, vad_filter=True, language="en")
        raw_transcript = " ".join(segment.text for segment in segments)
        logger.info("Transcription complete (%d chars).", len(raw_transcript))

        # Build prompt with dictionary rules
        dictionary_rules = get_rules_string(db, doctor_id)
        prompt = (
            f"{MASTER_PROMPT}\n\n"
            f"DOCTOR DICTIONARY:\n{dictionary_rules}\n\n"
            f"RAW TRANSCRIPT:\n{raw_transcript}"
        )

        # Call Ollama (with retries)
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
                       f"Please run 'ollama run {settings.ollama_model}' in a separate terminal.",
            )

        # Parse LLM JSON
        result_text = _strip_markdown_fences(result_text)

        try:
            parsed_json = json.loads(result_text)
        except json.JSONDecodeError:
            logger.error("Failed to parse JSON from Ollama: %s", result_text[:500])
            raise HTTPException(status_code=500, detail="Failed to parse LLM response into JSON.")

        structured = StructuredNote.model_validate(parsed_json)

        # Extract patient name for storage
        patient_name: Optional[str] = parsed_json.get("patient", {}).get("name") or None

        # Persist visit
        visit = save_visit(
            db=db,
            doctor_id=doctor_id,
            patient_name=patient_name,
            raw_transcript=raw_transcript,
            structured_notes=json.dumps(parsed_json),
        )
        logger.info("Visit saved (id=%d, doctor=%s).", visit.id, doctor_id)

        return TranscribeResponse(
            visit_id=visit.id,
            raw_transcript=raw_transcript,
            structured_notes=structured,
        )

    finally:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)


@app.post("/api/learn", response_model=LearnResponse)
async def learn(request: LearnRequest, db: Session = Depends(get_db)):
    """Add or update dictionary correction rules for a doctor."""
    for correction in request.corrections:
        add_rule(db, request.doctor_id, correction.misheard, correction.correct)
    logger.info(
        "Learned %d corrections for doctor %s.", len(request.corrections), request.doctor_id
    )
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
