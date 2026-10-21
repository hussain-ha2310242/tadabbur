import json
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_db
from ..users import log_activity
from ..nlp.camel import analyze_text
from ..nlp.gloss import ensure_glosses
from ..tokens import is_word, word_keys
from .annotations import notes_for_text
from .tags import tags_by_text

router = APIRouter()


def _apply_fanar_glosses(analyzed: list[dict]) -> None:
    """Replace CAMeL's morphology-tag glosses with real dictionary glosses."""
    lemmas = {t["lemma_key"]: t["lemma"] for s in analyzed for t in s["tokens"] if is_word(t)}
    glosses = ensure_glosses(lemmas)
    for s in analyzed:
        for t in s["tokens"]:
            if t["lemma_key"] in glosses:
                t["gloss"] = glosses[t["lemma_key"]]

_SENT_SPLIT = re.compile(r"(?<=[.!؟…])\s+|\n+")


def split_sentences(body: str) -> list[str]:
    return [s.strip() for s in _SENT_SPLIT.split(body) if s.strip()]


class TextCreate(BaseModel):
    title: str
    body: str
    importance: int = 2  # 1=low 2=normal 3=high
    # "fanar": one batched Fanar call for dictionary glosses (default)
    # "none":  no AI call at save time; meanings come from Claude's paste
    glosses: str = "fanar"
    source: str | None = None
    url: str | None = None


class SourceUpdate(BaseModel):
    source: str | None = None
    url: str | None = None


def clean_source(source: str | None, url: str | None) -> tuple[str | None, str | None]:
    """Trim both; blank means none. Links must be http(s), so a pasted
    'javascript:' or 'data:' address can never become a clickable link."""
    source = " ".join((source or "").split())[:200] or None
    url = (url or "").strip()[:500] or None
    if url and not re.match(r"^https?://[^\s]+$", url, re.IGNORECASE):
        raise HTTPException(400, "the link must start with http:// or https://")
    return source, url


class TitleUpdate(BaseModel):
    title: str


class ImportanceUpdate(BaseModel):
    importance: int


@router.post("/texts")
def create_text(req: TextCreate):
    if req.importance not in (1, 2, 3):
        raise HTTPException(400, "importance must be 1-3")
    if req.glosses not in ("fanar", "none"):
        raise HTTPException(400, "glosses must be 'fanar' or 'none'")
    source, url = clean_source(req.source, req.url)
    sentences = split_sentences(req.body)
    if not sentences:
        raise HTTPException(400, "empty text")
    # analyze once at import time; reads are then instant
    analyzed = [{"text": s, "tokens": analyze_text(s)} for s in sentences]
    if req.glosses == "fanar":
        _apply_fanar_glosses(analyzed)
    db = get_db()
    cur = db.execute(
        "INSERT INTO texts (title, body, tokens_json, importance, source, url) VALUES (?, ?, ?, ?, ?, ?)",
        (req.title, req.body, json.dumps(analyzed, ensure_ascii=False), req.importance, source, url),
    )
    log_activity(db, "texts")
    db.commit()
    return {"id": cur.lastrowid, "sentences": len(sentences)}


@router.get("/texts")
def list_texts():
    """The notes for the home page. One pass per note, and two queries for
    everything else: which words are known, and which notes have study data."""
    db = get_db()
    rows = db.execute(
        "SELECT id, title, importance, created_at, tokens_json, source, url, "
        "substr(body, 1, 400) AS head FROM texts ORDER BY importance DESC, id DESC"
    ).fetchall()
    tags = tags_by_text(db)
    known = {r["lemma_key"] for r in db.execute("SELECT lemma_key FROM words WHERE status = 'known'")}
    analysed = {r["text_id"] for r in db.execute("SELECT text_id FROM note_analysis")}

    out = []
    for r in rows:
        sentences = json.loads(r["tokens_json"])
        keys = word_keys(sentences)
        out.append(
            {
                "id": r["id"],
                "title": r["title"],
                "importance": r["importance"],
                "created_at": r["created_at"],
                "source": r["source"],
                "url": r["url"],
                "sentences": len(sentences),
                "to_learn": len(keys - known),  # distinct words not yet known
                "words": len(keys),  # distinct words: what the progress bar measures against
                "excerpt": " ".join(r["head"].split())[:160],
                "tags": tags.get(r["id"], []),
                "has_analysis": r["id"] in analysed,
            }
        )
    return out


@router.patch("/texts/{text_id}")
def update_importance(text_id: int, req: ImportanceUpdate):
    if req.importance not in (1, 2, 3):
        raise HTTPException(400, "importance must be 1-3")
    db = get_db()
    cur = db.execute(
        "UPDATE texts SET importance = ? WHERE id = ?", (req.importance, text_id)
    )
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "text not found")
    return {"id": text_id, "importance": req.importance}


@router.put("/texts/{text_id}/title")
def update_title(text_id: int, req: TitleUpdate):
    title = " ".join(req.title.split())[:200]
    if not title:
        raise HTTPException(400, "the title cannot be empty")
    db = get_db()
    cur = db.execute("UPDATE texts SET title = ? WHERE id = ?", (title, text_id))
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "text not found")
    return {"id": text_id, "title": title}


@router.put("/texts/{text_id}/source")
def update_source(text_id: int, req: SourceUpdate):
    source, url = clean_source(req.source, req.url)
    db = get_db()
    cur = db.execute("UPDATE texts SET source = ?, url = ? WHERE id = ?", (source, url, text_id))
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "text not found")
    return {"id": text_id, "source": source, "url": url}


@router.get("/texts/{text_id}")
def get_text(text_id: int):
    db = get_db()
    row = db.execute("SELECT * FROM texts WHERE id = ?", (text_id,)).fetchone()
    if not row:
        raise HTTPException(404, "text not found")
    statuses = {
        r["lemma_key"]: r["status"]
        for r in db.execute("SELECT lemma_key, status FROM words").fetchall()
    }
    analysis_row = db.execute(
        "SELECT analysis_json FROM note_analysis WHERE text_id = ?", (text_id,)
    ).fetchone()
    return {
        "id": row["id"],
        "title": row["title"],
        "source": row["source"],
        "url": row["url"],
        "sentences": json.loads(row["tokens_json"]),
        "statuses": statuses,
        "overrides": {
            r["lemma_key"]: {"gloss": r["gloss"], "root": r["root"]}
            for r in db.execute("SELECT lemma_key, gloss, root FROM meaning_overrides").fetchall()
        },
        "tags": tags_by_text(db).get(text_id, []),
        "annotations": notes_for_text(db, text_id),
        "analysis": json.loads(analysis_row["analysis_json"]) if analysis_row else None,
    }


@router.post("/texts/{text_id}/mark_all_known")
def mark_all_known(text_id: int):
    """Upsert every word of the text into the wallet as 'known' -
    for articles where you already know (nearly) everything."""
    db = get_db()
    row = db.execute("SELECT tokens_json FROM texts WHERE id = ?", (text_id,)).fetchone()
    if not row:
        raise HTTPException(404, "text not found")
    seen: dict[str, dict] = {}
    for s in json.loads(row["tokens_json"]):
        for t in s["tokens"]:
            if is_word(t):
                seen.setdefault(t["lemma_key"], t)
    db.executemany(
        """INSERT INTO words (lemma_key, display, root, pos, gloss, status)
           VALUES (?, ?, ?, ?, ?, 'known')
           ON CONFLICT(lemma_key) DO UPDATE SET status = 'known'
           """,
        [
            (k, t["lemma"], t.get("root"), t.get("pos"), t.get("gloss"))
            for k, t in seen.items()
        ],
    )
    log_activity(db, "marks")
    db.commit()
    return {"marked": len(seen)}


@router.post("/texts/{text_id}/reanalyze")
def reanalyze_text(text_id: int):
    """Full re-processing of a saved text: fresh CAMeL analysis (clean
    roots) + Fanar glosses. For notes saved before pipeline improvements."""
    db = get_db()
    row = db.execute("SELECT body FROM texts WHERE id = ?", (text_id,)).fetchone()
    if not row:
        raise HTTPException(404, "text not found")
    sentences = split_sentences(row["body"])
    analyzed = [{"text": s, "tokens": analyze_text(s)} for s in sentences]
    _apply_fanar_glosses(analyzed)
    db.execute(
        "UPDATE texts SET tokens_json = ? WHERE id = ?",
        (json.dumps(analyzed, ensure_ascii=False), text_id),
    )
    db.commit()
    return {"id": text_id, "sentences": len(sentences)}


@router.delete("/texts/{text_id}")
def delete_text(text_id: int):
    db = get_db()
    db.execute("DELETE FROM texts WHERE id = ?", (text_id,))
    db.execute("DELETE FROM text_tags WHERE text_id = ?", (text_id,))
    db.execute("DELETE FROM note_analysis WHERE text_id = ?", (text_id,))
    db.execute("DELETE FROM annotations WHERE text_id = ?", (text_id,))
    db.commit()
    return {"ok": True}
