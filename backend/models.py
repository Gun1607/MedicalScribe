"""
Pydantic request / response models for the MedicalScribe API.
Separated from SQLAlchemy ORM models in db.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
#  Structured note sub-models
# --------------------------------------------------------------------------- #

class PatientInfo(BaseModel):
    name: str = ""
    age: Optional[int] = None
    gender: str = ""


class Symptom(BaseModel):
    name: str = ""
    severity: str = ""
    duration: str = ""
    details: str = ""


class Condition(BaseModel):
    name: str = ""
    status: str = ""
    notes: str = ""


class Medication(BaseModel):
    name: str = ""
    drug_class: str = ""
    dosage: str = ""
    route: str = ""
    frequency: str = ""
    duration: str = ""
    purpose: str = ""


class StructuredNote(BaseModel):
    """Full structured output returned by the LLM."""
    patient: PatientInfo = Field(default_factory=PatientInfo)
    hpi: str = ""
    pmh: str = ""
    allergies: str = ""
    symptoms: List[Symptom] = Field(default_factory=list)
    conditions: List[Condition] = Field(default_factory=list)
    medications: List[Medication] = Field(default_factory=list)
    procedures: str = ""
    follow_up: str = ""


# --------------------------------------------------------------------------- #
#  API response models
# --------------------------------------------------------------------------- #

class TranscribeResponse(BaseModel):
    """Response from /api/transcribe."""
    visit_id: int
    raw_transcript: str
    structured_notes: StructuredNote


class HealthResponse(BaseModel):
    """Response from /api/health."""
    status: str
    provider: str = "local"
    groq_configured: bool = False
    groq_model: str = ""
    whisper_loaded: bool = False
    ollama_connected: bool = False
    ollama_model: str = ""


# --------------------------------------------------------------------------- #
#  Learn / dictionary models
# --------------------------------------------------------------------------- #

class Correction(BaseModel):
    misheard: str
    correct: str


class LearnRequest(BaseModel):
    doctor_id: str
    corrections: List[Correction]


class LearnResponse(BaseModel):
    status: str


class DictionaryRuleOut(BaseModel):
    id: int
    doctor_id: str
    misheard_word: str
    correct_word: str

    model_config = {"from_attributes": True}


class DictionaryResponse(BaseModel):
    doctor_id: str
    rules: List[DictionaryRuleOut]


# --------------------------------------------------------------------------- #
#  Visit models
# --------------------------------------------------------------------------- #

class VisitOut(BaseModel):
    id: int
    doctor_id: str
    patient_name: Optional[str] = None
    raw_transcript: str
    structured_notes: str  # JSON string
    created_at: datetime

    model_config = {"from_attributes": True}
