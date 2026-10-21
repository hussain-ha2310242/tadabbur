"""Audio proxy: Fanar TTS with a permanent wav cache.

TTS is Fanar-Aura-TTS-2 (api.fanar.qa) - MSA "Standard" accent Arabic
voices: Noor, Huda (f), Jasim, Hamad, Abdulrahman (m). Long sentences are
split at word boundaries and the WAV chunks concatenated. Lesson texts are
static, so each unique (voice, text) pair costs one API call ever - after
that it's served from data/audio/.
"""

import hashlib
import io
import os
import wave
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()

FANAR_BASE = "https://api.fanar.qa/v1"
TTS_MODEL = "Fanar-Aura-TTS-2"
TTS_CHAR_LIMIT = 250  # conservative per-request cap; chunked above this

AUDIO_DIR = Path(os.environ.get("DATA_DIR", "./data")) / "audio"


def _fanar_auth() -> dict:
    key = os.environ.get("FANAR_API_KEY")
    if not key:
        raise HTTPException(500, "FANAR_API_KEY is not set")
    return {"Authorization": f"Bearer {key}"}


def _chunks(text: str, limit: int = TTS_CHAR_LIMIT) -> list[str]:
    if len(text) <= limit:
        return [text]
    out, cur = [], ""
    for word in text.split():
        if cur and len(cur) + 1 + len(word) > limit:
            out.append(cur)
            cur = word
        else:
            cur = f"{cur} {word}".strip()
    if cur:
        out.append(cur)
    return out


def _concat_wavs(blobs: list[bytes]) -> bytes:
    if len(blobs) == 1:
        return blobs[0]
    frames = []
    params = None
    for blob in blobs:
        with wave.open(io.BytesIO(blob)) as w:
            if params is None:
                params = w.getparams()
            frames.append(w.readframes(w.getnframes()))
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setparams(params)
        for f in frames:
            w.writeframes(f)
    return out.getvalue()


async def _synth(client: httpx.AsyncClient, text: str, voice: str) -> bytes:
    r = await client.post(
        f"{FANAR_BASE}/audio/speech",
        headers=_fanar_auth(),
        json={
            "model": TTS_MODEL,
            "voice": voice,
            "input": text,
            "response_format": "wav",
        },
    )
    if r.status_code != 200:
        raise HTTPException(r.status_code, f"Fanar TTS failed: {r.text}")
    return r.content


@router.get("/tts")
async def tts(text: str, voice: str | None = None):
    text = text.strip()
    if not text:
        raise HTTPException(400, "empty text")
    if not voice:
        from .settings import get_setting

        voice = get_setting("tts_voice") or os.environ.get("FANAR_TTS_VOICE", "Noor")
    key = hashlib.sha1(f"{TTS_MODEL}|{voice}|{text}".encode()).hexdigest()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    path = AUDIO_DIR / f"{key}.wav"

    if not path.exists():
        async with httpx.AsyncClient(timeout=120) as client:
            blobs = [await _synth(client, c, voice) for c in _chunks(text)]
        path.write_bytes(_concat_wavs(blobs))

    return FileResponse(path, media_type="audio/wav")
