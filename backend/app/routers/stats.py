from datetime import datetime, timezone

from fastapi import APIRouter

from ..db import get_db
from ..users import current_user_id, streak_for

router = APIRouter()


@router.get("/stats")
def stats():
    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    by_status = {
        r["status"]: r["n"]
        for r in db.execute(
            "SELECT status, COUNT(*) AS n FROM words WHERE is_phrase = 0 GROUP BY status"
        ).fetchall()
    }
    phrases = db.execute("SELECT COUNT(*) AS n FROM words WHERE is_phrase = 1").fetchone()["n"]
    due = db.execute(
        "SELECT COUNT(*) AS n FROM words WHERE status != 'known' AND (due IS NULL OR due <= ?)",
        (now,),
    ).fetchone()["n"]
    texts = db.execute("SELECT COUNT(*) AS n FROM texts").fetchone()["n"]
    learning = sum(by_status.get(s, 0) for s in ("not_known", "hard", "easy"))
    user = db.execute("SELECT name FROM users WHERE id = ?", (current_user_id(),)).fetchone()
    return {
        "known": by_status.get("known", 0),
        "learning": learning,
        "hard": by_status.get("hard", 0),
        "easy": by_status.get("easy", 0),
        "phrases": phrases,
        "due": due,
        "texts": texts,
        "streak": streak_for(db, current_user_id()),
        "name": user["name"] if user else "",
    }
