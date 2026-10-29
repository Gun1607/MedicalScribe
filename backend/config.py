"""
Application configuration loaded from environment variables / .env file.
Self-contained with zero external dependencies beyond pydantic & standard library.
"""

import os
from pathlib import Path
from typing import List

# Read .env manually so python-dotenv is optional
_env_path = Path(__file__).resolve().parent / ".env"
if _env_path.exists():
    with open(_env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


class Settings:
    """MedicalScribe 2.0 backend settings with environment variable fallbacks."""

    def __init__(self):
        self.cors_origins: str = os.getenv("CORS_ORIGINS", "http://localhost:5173")
        # Groq Cloud Settings (Option A - Ultra Fast)
        self.groq_api_key: str = os.getenv("GROQ_API_KEY", "")
        self.use_groq: bool = os.getenv("USE_GROQ", "true").lower() in ("true", "1", "yes")
        self.groq_whisper_model: str = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")
        self.groq_llm_model: str = os.getenv("GROQ_LLM_MODEL", "llama-3.3-70b-specdec")
        
        # Local Fallback Settings
        self.ollama_model: str = os.getenv("OLLAMA_MODEL", "llama3")
        self.whisper_model: str = os.getenv("WHISPER_MODEL", "base")
        self.whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")
        self.whisper_compute_type: str = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
        self.database_url: str = os.getenv("DATABASE_URL", "sqlite:///./scribe.db")
        self.max_audio_size_mb: int = int(os.getenv("MAX_AUDIO_SIZE_MB", "25"))

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins into a list."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def max_audio_size_bytes(self) -> int:
        """Maximum audio file size in bytes."""
        return self.max_audio_size_mb * 1024 * 1024


settings = Settings()

