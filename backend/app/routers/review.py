import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fsrs import Card, Rating, Scheduler
from pydantic import BaseModel

from ..db import get_db
from ..tokens import word_keys
from ..users import current_user_id, log_activity
from .annotations import NOTE_PREFIX, span_parts

router = APIRouter()

scheduler = Scheduler()

# unified model: the level you press IS the grade
STATUS_RATING = {"not_known": 1, "hard": 2, "easy": 3, "known": 4}


class GradeRequest(BaseModel):
    lemma_key: str
    status: str  # not_known | hard | easy | known


def _lemmas_in_notes(db, text_ids: list[int]) -> set[str]:
    """Wallet-eligible lemma keys appearing in the given notes."""
    keys: set[str] = set()
    if not text_ids:
        return keys
    marks = ",".join("?" * len(text_ids))
    for r in db.execute(f"SELECT tokens_json FROM texts WHERE id IN ({marks})", text_ids):
        keys |= word_keys(json.loads(r["tokens_json"]))
    return keys


def _ids(raw: str | None) -> list[int]:
    """'3,7' -> [3, 7]; blanks and junk are ignored."""
    return [int(x) for x in (raw or "").split(",") if x.strip().isdigit()]


@router.get("/review/due")
def due_words(
    tag_id: int | None = None,
    text_id: int | None = None,
    tag_ids: str | None = None,
    text_ids: str | None = None,
):
    """Due cards, limited to the union of the given notes and every note with a given tag.
    tag_ids / text_ids take comma lists; tag_id / text_id stay for one at a time."""
    now = datetime.now(timezone.utc).isoformat()
    db = get_db()
    tags = _ids(tag_ids) + ([tag_id] if tag_id is not None else [])
    texts = _ids(text_ids) + ([text_id] if text_id is not None else [])
    scope: set[str] | None = None
    if tags:
        marks = ",".join("?" * len(tags))
        texts += [r["text_id"] for r in db.execute(
            f"SELECT text_id FROM text_tags WHERE tag_id IN ({marks})", tags)]
    scoped = bool(tags or texts)
    if scoped:
        scope = _lemmas_in_notes(db, sorted(set(texts)))
    rows = db.execute(
        "SELECT lemma_key, display, is_phrase, root, pos, gloss, notes, "
        "importance, status, due "
        "FROM words WHERE status != 'known' AND (due IS NULL OR due <= ?) "
        "ORDER BY importance DESC, due",
        (now,),
    ).fetchall()
    out = [dict(r) for r in rows]
    if scoped:
        out = [r for r in out if r["lemma_key"] in (scope or set())]
    return out + _due_notes(db, now, set(texts) if scoped else None)


def _due_notes(db, now: str, text_scope: set[int] | None) -> list[dict]:
    """Your selections that are due, shaped like word cards: the selection is
    the front ("display"), its meaning ("gloss") and your note ("comment") the
    back, and "before"/"after" hold the rest of its sentence for the front."""
    rows = db.execute(
        "SELECT a.*, t.tokens_json, t.title FROM annotations a JOIN texts t ON t.id = a.text_id "
        "WHERE a.user_id = ? AND a.status != 'known' AND (a.due IS NULL OR a.due <= ?) "
        "ORDER BY a.due",
        (current_user_id(), now),
    ).fetchall()
    out = []
    for r in rows:
        if text_scope is not None and r["text_id"] not in text_scope:
            continue
        try:
            parts = span_parts(json.loads(r["tokens_json"]), r)
        except (IndexError, KeyError, ValueError):
            parts = {"before": "", "after": ""}
        out.append({
            "lemma_key": f"{NOTE_PREFIX}{r['id']}",
            "display": r["quote"],
            "is_phrase": 1,
            "root": None,
            "pos": None,
            "gloss": r["meaning"] or "",
            "comment": r["comment"],
            "notes": r["title"],
            "importance": 0,
            "status": r["status"],
            "due": r["due"],
            "kind": "note",
            **parts,
        })
    return out


@router.post("/review/grade")
def grade(req: GradeRequest):
    if req.status not in STATUS_RATING:
        raise HTTPException(400, f"status must be one of {list(STATUS_RATING)}")
    db = get_db()
    if req.lemma_key.startswith(NOTE_PREFIX):
        return _grade_note(db, req)
    row = db.execute(
        "SELECT card_json FROM words WHERE lemma_key = ?", (req.lemma_key,)
    ).fetchone()
    if not row:
        raise HTTPException(404, "word not in wallet")
    card = Card.from_dict(json.loads(row["card_json"])) if row["card_json"] else Card()
    card, _log = scheduler.review_card(card, Rating(STATUS_RATING[req.status]))
    db.execute(
        "UPDATE words SET status = ?, card_json = ?, due = ? WHERE lemma_key = ?",
        (req.status, json.dumps(card.to_dict()), card.due.isoformat(), req.lemma_key),
    )
    log_activity(db, "reviews")
    db.commit()
    return {"lemma_key": req.lemma_key, "status": req.status, "due": card.due.isoformat()}


def _grade_note(db, req: GradeRequest):
    """A note's card is scheduled exactly like a word's."""
    try:
        note_id = int(req.lemma_key[len(NOTE_PREFIX):])
    except ValueError:
        raise HTTPException(404, "note not found")
    row = db.execute(
        "SELECT card_json FROM annotations WHERE id = ? AND user_id = ?", (note_id, current_user_id())
    ).fetchone()
    if not row:
        raise HTTPException(404, "note not found")
    card = Card.from_dict(json.loads(row["card_json"])) if row["card_json"] else Card()
    card, _log = scheduler.review_card(card, Rating(STATUS_RATING[req.status]))
    db.execute(
        "UPDATE annotations SET status = ?, card_json = ?, due = ? WHERE id = ?",
        (req.status, json.dumps(card.to_dict()), card.due.isoformat(), note_id),
    )
    log_activity(db, "reviews")
    db.commit()
    return {"lemma_key": req.lemma_key, "status": req.status, "due": card.due.isoformat()}
