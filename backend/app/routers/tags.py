"""Custom tags for notes (e.g. 'Madina L4', 'Qur'an', 'hal')."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_db

router = APIRouter()


class TagCreate(BaseModel):
    name: str


class TextTags(BaseModel):
    names: list[str]


def _clean(name: str) -> str:
    return " ".join(name.split()).strip()


def tags_by_text(db) -> dict[int, list[dict]]:
    """{text_id: [{id, name}, ...]} for every tagged note, in one query."""
    out: dict[int, list[dict]] = {}
    rows = db.execute(
        "SELECT tt.text_id, t.id, t.name FROM text_tags tt "
        "JOIN tags t ON t.id = tt.tag_id ORDER BY t.name"
    ).fetchall()
    for r in rows:
        out.setdefault(r["text_id"], []).append({"id": r["id"], "name": r["name"]})
    return out


@router.get("/tags")
def list_tags():
    db = get_db()
    rows = db.execute(
        "SELECT t.id, t.name, COUNT(tt.text_id) AS notes FROM tags t "
        "LEFT JOIN text_tags tt ON tt.tag_id = t.id "
        "GROUP BY t.id ORDER BY t.name"
    ).fetchall()
    return [dict(r) for r in rows]


@router.post("/tags")
def create_tag(req: TagCreate):
    name = _clean(req.name)
    if not name:
        raise HTTPException(400, "empty tag")
    db = get_db()
    db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
    db.commit()
    row = db.execute("SELECT id, name FROM tags WHERE name = ?", (name,)).fetchone()
    return dict(row)


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int):
    db = get_db()
    db.execute("DELETE FROM text_tags WHERE tag_id = ?", (tag_id,))
    db.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
    db.commit()
    return {"ok": True}


@router.put("/texts/{text_id}/tags")
def set_text_tags(text_id: int, req: TextTags):
    """Replace the note's tag set; unknown names are created."""
    db = get_db()
    if not db.execute("SELECT 1 FROM texts WHERE id = ?", (text_id,)).fetchone():
        raise HTTPException(404, "text not found")
    names: list[str] = []
    for n in req.names:
        c = _clean(n)
        if c and c not in names:
            names.append(c)
    db.execute("DELETE FROM text_tags WHERE text_id = ?", (text_id,))
    for n in names:
        db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (n,))
        tag_id = db.execute("SELECT id FROM tags WHERE name = ?", (n,)).fetchone()["id"]
        db.execute(
            "INSERT OR IGNORE INTO text_tags (text_id, tag_id) VALUES (?, ?)",
            (text_id, tag_id),
        )
    db.commit()
    return {"tags": names}
