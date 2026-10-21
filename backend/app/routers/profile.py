from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..db import get_db
from ..users import current_user_id, streak_for, today_for, valid_tz

router = APIRouter()

# how many days of history the profile shows (12 weeks)
HISTORY_DAYS = 84


class ProfileUpdate(BaseModel):
    name: str | None = None
    timezone: str | None = None


@router.get("/profile")
def get_profile(user_id: int = Depends(current_user_id)):
    db = get_db()
    user = db.execute(
        "SELECT id, name, timezone, created_at FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if not user:
        raise HTTPException(404, "no such user")

    today = today_for(db, user_id)
    start = today - timedelta(days=HISTORY_DAYS - 1)
    stored = {
        r["day"]: r
        for r in db.execute(
            "SELECT day, reviews, marks, texts FROM activity WHERE user_id = ? AND day >= ?",
            (user_id, start.isoformat()),
        )
    }
    days = []
    for i in range(HISTORY_DAYS):
        d = (start + timedelta(days=i)).isoformat()
        r = stored.get(d)
        days.append(
            {
                "day": d,
                "reviews": r["reviews"] if r else 0,
                "marks": r["marks"] if r else 0,
                "texts": r["texts"] if r else 0,
            }
        )

    by_status = {
        r["status"]: r["n"]
        for r in db.execute(
            "SELECT status, COUNT(*) AS n FROM words "
            "WHERE user_id = ? AND is_phrase = 0 GROUP BY status",
            (user_id,),
        )
    }
    totals = {
        "words": sum(by_status.values()),
        "known": by_status.get("known", 0),
        "learning": sum(by_status.get(s, 0) for s in ("not_known", "hard", "easy")),
        "texts": db.execute(
            "SELECT COUNT(*) AS n FROM texts WHERE user_id = ?", (user_id,)
        ).fetchone()["n"],
        "reviews": db.execute(
            "SELECT COALESCE(SUM(reviews), 0) AS n FROM activity WHERE user_id = ?", (user_id,)
        ).fetchone()["n"],
    }

    return {
        "id": user["id"],
        "name": user["name"],
        "timezone": user["timezone"],
        "joined": user["created_at"],
        "today": today.isoformat(),
        "streak": streak_for(db, user_id),
        "days": days,
        "totals": totals,
    }


@router.put("/profile")
def update_profile(req: ProfileUpdate, user_id: int = Depends(current_user_id)):
    sets, vals = [], []
    if req.name is not None:
        name = " ".join(req.name.split())
        if not 1 <= len(name) <= 60:
            raise HTTPException(400, "name must be 1-60 characters")
        sets.append("name = ?")
        vals.append(name)
    if req.timezone is not None:
        if not valid_tz(req.timezone):
            raise HTTPException(400, "unknown time zone")
        sets.append("timezone = ?")
        vals.append(req.timezone)
    if not sets:
        raise HTTPException(400, "nothing to update")
    db = get_db()
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id = ?", (*vals, user_id))
    db.commit()
    return get_profile(user_id)
