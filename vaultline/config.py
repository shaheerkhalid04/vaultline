"""Environment backed settings for vaultline."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(PROJECT_ROOT / ".env")


class ConfigError(RuntimeError):
    """Raised when the environment is not usable."""


@dataclass(frozen=True)
class Settings:
    url: str
    key: str
    bucket: str
    files_table: str
    notes_table: str
    edge_function: str
    max_mb: int

    @property
    def edge_function_url(self) -> str:
        return f"{self.url.rstrip('/')}/functions/v1/{self.edge_function}"


def load_settings() -> Settings:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_KEY", "").strip()

    missing = [name for name, value in (("SUPABASE_URL", url), ("SUPABASE_KEY", key)) if not value]
    if missing:
        raise ConfigError(
            "Missing "
            + ", ".join(missing)
            + ". Copy .env.example to .env and fill in your project values."
        )

    return Settings(
        url=url,
        key=key,
        bucket=os.getenv("VAULTLINE_BUCKET", "vaultline-files"),
        files_table=os.getenv("VAULTLINE_FILES_TABLE", "file_records"),
        notes_table=os.getenv("VAULTLINE_NOTES_TABLE", "notes"),
        edge_function=os.getenv("VAULTLINE_EDGE_FUNCTION", "validate-upload"),
        max_mb=int(os.getenv("VAULTLINE_MAX_MB", "10")),
    )
