"""
SQLAlchemy ORM models and database helper functions for MedicalScribe 2.0.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from config import settings

# --------------------------------------------------------------------------- #
#  Engine & session factory
# --------------------------------------------------------------------------- #

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


# --------------------------------------------------------------------------- #
#  FastAPI dependency
# --------------------------------------------------------------------------- #

def get_db():
    """Yield a database session and ensure it is closed after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# --------------------------------------------------------------------------- #
#  ORM models
# --------------------------------------------------------------------------- #

class DictionaryRule(Base):
    __tablename__ = "dictionary_rules"

    id = Column(Integer, primary_key=True, index=True)
    doctor_id = Column(String, default="dr_admin", index=True)
    misheard_word = Column(String, index=True)
    correct_word = Column(String)


class Visit(Base):
    __tablename__ = "visits"

    id = Column(Integer, primary_key=True, index=True)
    doctor_id = Column(String, index=True)
    patient_name = Column(String, nullable=True)
    raw_transcript = Column(String)
    structured_notes = Column(String)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)


# Create tables
Base.metadata.create_all(bind=engine)


# --------------------------------------------------------------------------- #
#  Dictionary helpers
# --------------------------------------------------------------------------- #

def add_rule(db: Session, doctor_id: str, misheard: str, correct: str) -> DictionaryRule:
    """Add or update a dictionary rule. Uses the caller-provided session."""
    try:
        rule = db.query(DictionaryRule).filter(
            DictionaryRule.doctor_id == doctor_id,
            DictionaryRule.misheard_word == misheard,
        ).first()

        if rule:
            rule.correct_word = correct
        else:
            rule = DictionaryRule(
                doctor_id=doctor_id,
                misheard_word=misheard,
                correct_word=correct,
            )
            db.add(rule)

        db.commit()
        db.refresh(rule)
        return rule
    except Exception:
        db.rollback()
        raise


def get_rules(db: Session, doctor_id: str) -> list[DictionaryRule]:
    """Return all dictionary rules for a doctor."""
    return db.query(DictionaryRule).filter(DictionaryRule.doctor_id == doctor_id).all()


def get_rules_string(db: Session, doctor_id: str) -> str:
    """Return a formatted string of dictionary rules for the prompt."""
    rules = get_rules(db, doctor_id)
    if not rules:
        return "No dictionary rules found."
    rules_list = [f"'{r.misheard_word}' usually means '{r.correct_word}'" for r in rules]
    return ", ".join(rules_list)


# --------------------------------------------------------------------------- #
#  Visit helpers
# --------------------------------------------------------------------------- #

def save_visit(
    db: Session,
    doctor_id: str,
    patient_name: str | None,
    raw_transcript: str,
    structured_notes: str,
) -> Visit:
    """Persist a transcription visit."""
    try:
        visit = Visit(
            doctor_id=doctor_id,
            patient_name=patient_name,
            raw_transcript=raw_transcript,
            structured_notes=structured_notes,
        )
        db.add(visit)
        db.commit()
        db.refresh(visit)
        return visit
    except Exception:
        db.rollback()
        raise


def get_visits(db: Session, doctor_id: str) -> list[Visit]:
    """List all visits for a doctor, most recent first."""
    return (
        db.query(Visit)
        .filter(Visit.doctor_id == doctor_id)
        .order_by(Visit.created_at.desc())
        .all()
    )


def get_visit_by_id(db: Session, visit_id: int) -> Visit | None:
    """Retrieve a single visit by ID."""
    return db.query(Visit).filter(Visit.id == visit_id).first()
