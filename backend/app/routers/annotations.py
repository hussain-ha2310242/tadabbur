"""Selections on a text: a span of words (it may cross sentences), its meaning
from the AI, and your note if you wrote one (none = a phrase). Each is also a
flashcard: the selection in front, the meaning and note behind, with its own
level and schedule like a word in the wallet."""

import json

from fastapi import APIRouter, Depends, HTTPException
from fsrs import Card
from pydantic import BaseModel

from ..db import get_db
from ..users import current_user_id, log_activity
from .enrich import _chat_translate, _clean_translation, _shaheen, _valid_translation

router = APIRouter()

STATUSES = ("not_known", "hard", "easy", "known")
NOTE_PREFIX = "note:"  # how a note's card is keyed in the deck


class AnnotationCreate(BaseModel):
    text_id: int
    start_si: int
    start_ti: int
    end_si: int
    end_ti: int
    comment: str = ""


class AnnotationUpdate(BaseModel):
    comment: str | None = None
    status: str | None = None


def _span_words(sentences: list[dict], a: tuple[int, int], b: tuple[int, int]) -> list[str]:
    """The words from position a to b (inclusive), across sentences."""
    words = []
    for si in range(a[0], b[0] + 1):
        toks = sentences[si]["tokens"]
        lo = a[1] if si == a[0] else 0
        hi = b[1] if si == b[0] else len(toks) - 1
        words += [t["word"] for t in toks[lo : hi + 1]]
    return words


def selection_meaning(quote: str, context: str) -> str | None:
    """The selection's meaning as a whole, read in its sentence: the chat model
    with context first, the MT model as fallback. None if neither gives a valid
    answer; the selection is saved either way."""
    candidate = _clean_translation(_chat_translate(quote, context) or "")
    if not _valid_translation(quote, candidate):
        candidate = _clean_translation(_shaheen(quote) or "")
    return candidate if _valid_translation(quote, candidate) else None


def span_parts(sentences: list[dict], row) -> dict:
    """The quote and the words around it in its first and last sentence,
    so a card can show the selection inside its sentence."""
    s0, s1 = sentences[row["start_si"]]["tokens"], sentences[row["end_si"]]["tokens"]
    return {
        "before": " ".join(t["word"] for t in s0[: row["start_ti"]]),
        "after": " ".join(t["word"] for t in s1[row["end_ti"] + 1 :]),
    }


def note_dict(row, sentences: list[dict] | None = None, title: str | None = None) -> dict:
    out = {
        "id": row["id"],
        "text_id": row["text_id"],
        "start_si": row["start_si"],
        "start_ti": row["start_ti"],
        "end_si": row["end_si"],
        "end_ti": row["end_ti"],
        "quote": row["quote"],
        "meaning": row["meaning"] if "meaning" in row.keys() else None,
        "comment": row["comment"],
        "status": row["status"],
        "due": row["due"],
        "created_at": row["created_at"],
    }
    if title is not None:
        out["title"] = title
    if sentences is not None:
        try:
            out.update(span_parts(sentences, row))
        except (IndexError, KeyError):
            out.update({"before": "", "after": ""})
    return out


def notes_for_text(db, text_id: int) -> list[dict]:
    return [
        note_dict(r)
        for r in db.execute(
            "SELECT * FROM annotations WHERE text_id = ? AND user_id = ? ORDER BY start_si, start_ti",
            (text_id, current_user_id()),
        )
    ]


@router.get("/annotations")
def list_annotations(user_id: int = Depends(current_user_id)):
    db = get_db()
    rows = db.execute(
        "SELECT a.*, t.title AS title FROM annotations a JOIN texts t ON t.id = a.text_id "
        "WHERE a.user_id = ? ORDER BY a.created_at DESC, a.id DESC",
        (user_id,),
    ).fetchall()
    return [note_dict(r, title=r["title"]) for r in rows]


@router.post("/annotations")
def create_annotation(req: AnnotationCreate, user_id: int = Depends(current_user_id)):
    db = get_db()
    row = db.execute("SELECT tokens_json FROM texts WHERE id = ?", (req.text_id,)).fetchone()
    if not row:
        raise HTTPException(404, "text not found")
    sentences = json.loads(row["tokens_json"])
    a, b = (req.start_si, req.start_ti), (req.end_si, req.end_ti)
    if b < a:
        a, b = b, a
    try:
        if not (0 <= a[0] < len(sentences) and 0 <= b[0] < len(sentences)):
            raise IndexError
        if not (0 <= a[1] < len(sentences[a[0]]["tokens"]) and 0 <= b[1] < len(sentences[b[0]]["tokens"])):
            raise IndexError
    except IndexError:
        raise HTTPException(400, "the selection is outside the text")
    quote = " ".join(_span_words(sentences, a, b)).strip()
    if not quote:
        raise HTTPException(400, "empty selection")
    comment = (req.comment or "").strip()[:2000]
    context = " ".join(sentences[si]["text"] for si in range(a[0], b[0] + 1))
    meaning = selection_meaning(quote, context)
    card = Card()
    cur = db.execute(
        """INSERT INTO annotations (user_id, text_id, start_si, start_ti, end_si, end_ti,
                                    quote, meaning, comment, card_json, due)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_id, req.text_id, a[0], a[1], b[0], b[1], quote, meaning, comment,
         json.dumps(card.to_dict()), card.due.isoformat()),
    )
    log_activity(db, "marks")
    db.commit()
    new = db.execute("SELECT * FROM annotations WHERE id = ?", (cur.lastrowid,)).fetchone()
    return note_dict(new)


@router.patch("/annotations/{note_id}")
def update_annotation(note_id: int, req: AnnotationUpdate, user_id: int = Depends(current_user_id)):
    sets, vals = [], []
    if req.comment is not None:
        sets.append("comment = ?")
        vals.append(req.comment.strip()[:2000])
    if req.status is not None:
        if req.status not in STATUSES:
            raise HTTPException(400, "bad status")
        sets.append("status = ?")
        vals.append(req.status)
    if not sets:
        raise HTTPException(400, "nothing to update")
    db = get_db()
    cur = db.execute(
        f"UPDATE annotations SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
        (*vals, note_id, user_id),
    )
    if cur.rowcount and req.status is not None:
        log_activity(db, "marks")
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "note not found")
    return note_dict(db.execute("SELECT * FROM annotations WHERE id = ?", (note_id,)).fetchone())


@router.delete("/annotations/{note_id}")
def delete_annotation(note_id: int, user_id: int = Depends(current_user_id)):
    db = get_db()
    db.execute("DELETE FROM annotations WHERE id = ? AND user_id = ?", (note_id, user_id))
    db.commit()
    return {"ok": True}
