"""Shared Fanar chat-completion helper with JSON extraction."""

import json
import os
import re

import httpx

FANAR_BASE = "https://api.fanar.qa/v1"
CHAT_MODEL = "Fanar"


def fanar_translate(text: str) -> str | None:
    """Ar→En via the dedicated MT model. Returns None on failure."""
    key = os.environ.get("FANAR_API_KEY")
    if not key:
        return None
    try:
        r = httpx.post(
            f"{FANAR_BASE}/translations",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": "Fanar-Shaheen-MT-1", "text": text, "langpair": "ar-en"},
            timeout=60,
        )
        r.raise_for_status()
        return r.json()["text"]
    except Exception:
        return None


def fanar_json(system: str, user: str, max_tokens: int = 2000, timeout: int = 120):
    """One chat call; returns the first JSON value found in the reply
    (object or array), or None on any failure."""
    key = os.environ.get("FANAR_API_KEY")
    if not key:
        return None
    try:
        r = httpx.post(
            f"{FANAR_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": CHAT_MODEL,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                "max_tokens": max_tokens,
            },
            timeout=timeout,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        match = re.search(r"[\[{].*[\]}]", content, re.DOTALL)
        return json.loads(match.group()) if match else None
    except Exception:
        return None
