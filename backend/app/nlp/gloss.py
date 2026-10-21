"""Proper English glosses for Arabic lemmas via the Fanar chat API.

CAMeL's built-in glosses are morphology-database tags (e.g.
"the+water+[def.gen.]") - unusable as learner-facing meanings. This module
batch-translates unique lemmas through Fanar once and caches them forever
in the glosses table, so each lemma costs one API call across all texts.
"""

import json
import os
import re

import httpx

from ..db import get_db

FANAR_BASE = "https://api.fanar.qa/v1"
CHAT_MODEL = "Fanar"
BATCH_SIZE = 40

_SYSTEM = (
    "You are an Arabic-English dictionary. Given a JSON array of Arabic "
    "words, return ONLY a JSON object mapping each word exactly as given "
    "to a concise English gloss (1-3 words). No explanations."
)


def _fanar_batch(lemmas: list[str]) -> dict[str, str]:
    key = os.environ.get("FANAR_API_KEY")
    if not key:
        return {}
    r = httpx.post(
        f"{FANAR_BASE}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": CHAT_MODEL,
            "messages": [
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": json.dumps(lemmas, ensure_ascii=False)},
            ],
            "max_tokens": 40 * len(lemmas) + 200,
        },
        timeout=60,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if not match:
        return {}
    parsed = json.loads(match.group())
    return {k: str(v) for k, v in parsed.items() if isinstance(v, str) and v.strip()}


def ensure_glosses(lemmas: dict[str, str]) -> dict[str, str]:
    """lemmas: {lemma_key: vocalized_lemma}. Returns {lemma_key: gloss}.

    Serves from the glosses table; asks Fanar only for lemmas never seen
    before. Fanar failures are swallowed - missing keys just keep their
    CAMeL fallback gloss.
    """
    if not lemmas:
        return {}
    db = get_db()
    cached = {
        r["lemma_key"]: r["gloss"]
        for r in db.execute(
            f"SELECT lemma_key, gloss FROM glosses WHERE lemma_key IN "
            f"({','.join('?' * len(lemmas))})",
            list(lemmas),
        ).fetchall()
    }
    missing = [k for k in lemmas if k not in cached]

    for i in range(0, len(missing), BATCH_SIZE):
        batch_keys = missing[i : i + BATCH_SIZE]
        # send the vocalized lemma (better MT input), map back via position
        batch_lemmas = [lemmas[k] for k in batch_keys]
        try:
            result = _fanar_batch(batch_lemmas)
        except Exception:
            continue
        rows = []
        for k, lemma in zip(batch_keys, batch_lemmas):
            gloss = result.get(lemma)
            if gloss:
                cached[k] = gloss
                rows.append((k, gloss))
        if rows:
            db.executemany(
                "INSERT OR REPLACE INTO glosses (lemma_key, gloss) VALUES (?, ?)", rows
            )
            db.commit()
    return cached
