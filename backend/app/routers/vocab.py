import json

from camel_tools.utils.dediac import dediac_ar
from fastapi import APIRouter, HTTPException
from fsrs import Card
from pydantic import BaseModel

from ..db import get_db
from ..users import current_user_id, log_activity
from ..nlp.fanar import fanar_translate

router = APIRouter()

# unified levels: not_known (default; frequent), hard (frequent),
# easy (normal growth), known (out of the review queue)
STATUSES = ("not_known", "hard", "easy", "known")


class VocabAdd(BaseModel):
    lemma_key: str  # will be dediacritized server-side
    display: str  # vocalized lemma, phrase, or snippet text
    root: str | None = None
    pos: str | None = None
    gloss: str | None = None
    notes: str | None = None
    is_phrase: bool = False
    status: str = "not_known"
    importance: int = 0  # 0-3


class VocabUpdate(BaseModel):
    status: str | None = None
    importance: int | None = None
    notes: str | None = None


@router.get("/vocab")
def list_vocab():
    db = get_db()
    rows = db.execute(
        "SELECT lemma_key, display, is_phrase, root, pos, gloss, notes, status, "
        "importance, due, created_at FROM words WHERE user_id = ? "
        "ORDER BY importance DESC, created_at DESC",
        (current_user_id(),),
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/vocab")
def add_vocab(req: VocabAdd):
    if req.status not in STATUSES:
        raise HTTPException(400, "bad status")
    if req.importance not in (0, 1, 2, 3):
        raise HTTPException(400, "importance must be 0-3")
    key = dediac_ar(req.lemma_key).strip()
    if not key:
        raise HTTPException(400, "empty lemma_key")
    gloss = req.gloss
    if req.is_phrase and not gloss:
        gloss = fanar_translate(req.display)  # snippets get a translation back
    card = Card()  # due immediately
    db = get_db()
    db.execute(
        """INSERT INTO words (lemma_key, display, is_phrase, root, pos, gloss,
                              notes, status, importance, card_json, due)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(lemma_key) DO UPDATE SET status = excluded.status""",
        (
            key,
            req.display,
            int(req.is_phrase),
            req.root,
            req.pos,
            gloss,
            req.notes,
            req.status,
            req.importance,
            json.dumps(card.to_dict()),
            card.due.isoformat(),
        ),
    )
    log_activity(db, "marks")
    db.commit()
    return {"lemma_key": key, "status": req.status, "gloss": gloss}


@router.patch("/vocab/{lemma_key}")
def update_vocab(lemma_key: str, req: VocabUpdate):
    sets, vals = [], []
    if req.status is not None:
        if req.status not in STATUSES:
            raise HTTPException(400, "bad status")
        sets.append("status = ?")
        vals.append(req.status)
    if req.importance is not None:
        if req.importance not in (0, 1, 2, 3):
            raise HTTPException(400, "importance must be 0-3")
        sets.append("importance = ?")
        vals.append(req.importance)
    if req.notes is not None:
        sets.append("notes = ?")
        vals.append(req.notes)
    if not sets:
        raise HTTPException(400, "nothing to update")
    db = get_db()
    cur = db.execute(
        f"UPDATE words SET {', '.join(sets)} WHERE lemma_key = ?",
        (*vals, lemma_key),
    )
    if cur.rowcount and req.status is not None:
        log_activity(db, "marks")
    db.commit()
    if cur.rowcount == 0:
        raise HTTPException(404, "word not in wallet")
    return {"lemma_key": lemma_key, "ok": True}


@router.delete("/vocab/{lemma_key}")
def remove_vocab(lemma_key: str):
    db = get_db()
    db.execute("DELETE FROM words WHERE lemma_key = ?", (lemma_key,))
    db.commit()
    return {"ok": True}
