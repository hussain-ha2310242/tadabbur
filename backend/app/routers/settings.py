from fastapi import APIRouter
from pydantic import BaseModel

from ..db import get_db

router = APIRouter()

DEFAULTS = {
    "tts_voice": "Noor",
    "ar_text_scale": "1",
    "theme": "light",  # light | dark | system
    "card_style": "sticky",  # sticky | index
}


def get_setting(key: str) -> str | None:
    db = get_db()
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else DEFAULTS.get(key)


class SettingsUpdate(BaseModel):
    values: dict[str, str]


@router.get("/settings")
def read_settings():
    db = get_db()
    stored = {r["key"]: r["value"] for r in db.execute("SELECT key, value FROM settings")}
    return {**DEFAULTS, **stored}


@router.put("/settings")
def write_settings(req: SettingsUpdate):
    db = get_db()
    db.executemany(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        list(req.values.items()),
    )
    db.commit()
    return read_settings()
