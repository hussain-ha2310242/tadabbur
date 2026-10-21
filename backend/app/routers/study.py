"""Copy-prompt study flow.

The app builds a prompt from a note; you paste it into Claude yourself,
then paste Claude's JSON reply back here. Nothing is generated server-side,
so there is no LLM call on this path.
"""

import json
import re

from camel_tools.utils.dediac import dediac_ar
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_db
from .texts import split_sentences

router = APIRouter()


class AnalysisImport(BaseModel):
    raw: str  # Claude's reply, pasted as-is (fences and prose tolerated)


_PROMPT_HEAD = (
    "You are helping an adult learner of Modern Standard Arabic understand a text.\n\n"
    "Text title: {title}\n\n"
    "Sentences (numbered):\n{sentences}\n\n"
)

_PROMPT_SCHEMA = (
    "Return ONLY one valid JSON object (no prose, no markdown fences) with this exact shape:\n"
    "{\n"
    '  "sentences": [{"index": 0, "en": "natural English translation of sentence 0, in context"}],\n'
    '  "words": [{"lemma": "dictionary form, fully vocalized", '
    '"pos": "noun | verb | particle | adjective | adverb | other", '
    '"root": "root letters separated by spaces, or null", '
    '"meaning": "short English meaning as used in THIS text (1-4 words)"}]\n'
    "}\n\n"
    "Rules:\n"
    "- One entry in \"sentences\" for every numbered sentence, same index.\n"
    "- One entry in \"words\" for every content word (skip punctuation and numbers).\n"
    "- \"meaning\" is the sense used in this text, not every possible sense.\n"
    "- Give the root whenever you are confident; use null only when you are not.\n"
    "- Output the JSON object alone.\n"
)


def build_prompt(title: str, sentences: list[str]) -> str:
    numbered = "\n".join(f"{i}. {s}" for i, s in enumerate(sentences))
    return _PROMPT_HEAD.format(title=title, sentences=numbered) + _PROMPT_SCHEMA


def _extract_json(raw: str):
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        raise HTTPException(400, "No JSON object found - paste the whole reply")
    try:
        return json.loads(match.group())
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e.msg} (line {e.lineno})")


def _text_row(text_id: int):
    db = get_db()
    row = db.execute("SELECT title, body FROM texts WHERE id = ?", (text_id,)).fetchone()
    if not row:
        raise HTTPException(404, "text not found")
    return row


@router.get("/texts/{text_id}/prompt")
def get_prompt(text_id: int):
    row = _text_row(text_id)
    sentences = split_sentences(row["body"])
    return {"prompt": build_prompt(row["title"], sentences), "sentences": len(sentences)}


class PreviewIn(BaseModel):
    title: str
    body: str


@router.post("/prompt_preview")
def prompt_preview(req: PreviewIn):
    """The copy-prompt for a note that is not saved yet. Nothing is written."""
    sentences = split_sentences(req.body)
    if not sentences:
        raise HTTPException(400, "empty text")
    return {"prompt": build_prompt(req.title.strip() or "Untitled", sentences), "sentences": len(sentences)}


@router.get("/texts/{text_id}/analysis")
def get_analysis(text_id: int):
    _text_row(text_id)
    db = get_db()
    row = db.execute(
        "SELECT analysis_json FROM note_analysis WHERE text_id = ?", (text_id,)
    ).fetchone()
    return json.loads(row["analysis_json"]) if row else None


@router.post("/texts/{text_id}/analysis")
def import_analysis(text_id: int, req: AnalysisImport):
    _text_row(text_id)
    data = _extract_json(req.raw)
    if not isinstance(data, dict):
        raise HTTPException(400, "Expected a JSON object with 'sentences' and 'words'")

    sents = data.get("sentences") or []
    words = data.get("words") or []
    if not isinstance(sents, list) or not isinstance(words, list):
        raise HTTPException(400, "'sentences' and 'words' must be arrays")

    sent_map: dict[str, str] = {}
    for s in sents:
        if isinstance(s, dict) and isinstance(s.get("index"), int) and isinstance(s.get("en"), str):
            if s["en"].strip():
                sent_map[str(s["index"])] = s["en"].strip()

    word_map: dict[str, dict] = {}
    for w in words:
        if not isinstance(w, dict):
            continue
        lemma, meaning = w.get("lemma"), w.get("meaning")
        if not isinstance(lemma, str) or not lemma.strip():
            continue
        if not isinstance(meaning, str) or not meaning.strip():
            continue
        key = dediac_ar(lemma).strip()
        if not key:
            continue
        root = w.get("root")
        root = " ".join(root.replace(".", " ").split()) if isinstance(root, str) and root.strip() else None
        word_map[key] = {
            "lemma": lemma.strip(),
            "meaning": meaning.strip(),
            "root": root or None,
            "pos": w.get("pos") if isinstance(w.get("pos"), str) else None,
        }

    if not sent_map and not word_map:
        raise HTTPException(400, "JSON had no usable 'sentences' or 'words' entries")

    analysis = {"sentences": sent_map, "words": word_map}
    db = get_db()
    db.execute(
        "INSERT OR REPLACE INTO note_analysis (text_id, analysis_json) VALUES (?, ?)",
        (text_id, json.dumps(analysis, ensure_ascii=False)),
    )
    # fill in roots for wallet words that have none yet (never overwrite)
    for key, v in word_map.items():
        if v["root"]:
            db.execute(
                "UPDATE words SET root = ? WHERE lemma_key = ? AND root IS NULL",
                (v["root"], key),
            )
    db.commit()
    return {"sentences": len(sent_map), "words": len(word_map)}


@router.delete("/texts/{text_id}/analysis")
def clear_analysis(text_id: int):
    db = get_db()
    db.execute("DELETE FROM note_analysis WHERE text_id = ?", (text_id,))
    db.commit()
    return {"ok": True}


class OverrideIn(BaseModel):
    gloss: str | None = None
    root: str | None = None


@router.put("/overrides/{lemma_key}")
def set_override(lemma_key: str, req: OverrideIn):
    """Edit a word's meaning and/or root. Both empty removes the override."""
    key = dediac_ar(lemma_key).strip()
    if not key:
        raise HTTPException(400, "empty lemma_key")
    gloss = (req.gloss or "").strip() or None
    root = " ".join((req.root or "").replace(".", " ").split()) or None
    db = get_db()
    if gloss is None and root is None:
        db.execute("DELETE FROM meaning_overrides WHERE lemma_key = ?", (key,))
    else:
        db.execute(
            "INSERT OR REPLACE INTO meaning_overrides (lemma_key, gloss, root) VALUES (?, ?, ?)",
            (key, gloss, root),
        )
    # keep the wallet in step so review cards show the edit too
    if gloss is not None:
        db.execute("UPDATE words SET gloss = ? WHERE lemma_key = ?", (gloss, key))
    if root is not None:
        db.execute("UPDATE words SET root = ? WHERE lemma_key = ?", (root, key))
    db.commit()
    return {"lemma_key": key, "gloss": gloss, "root": root}
