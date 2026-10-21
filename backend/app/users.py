"""Who is using the app, and what they did each day.

Today there is one person (the owner, id 1). Every route that needs the user
asks current_user_id(); when login is added, that function reads the verified
session and nothing else has to change.

Activity is one row per user per day, in the user's own time zone. A day with
any activity counts towards the streak.
"""

import json
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore

OWNER_ID = 1
OWNER_NAME = "Hussain"
OWNER_TZ = "Asia/Qatar"

# what counts as a day's study:
#   reviews - cards graded in the deck
#   marks   - word levels set while reading (or in the word wallet)
#   texts   - notes added
ACTIVITY_KINDS = ("reviews", "marks", "texts")


def current_user_id() -> int:
    """The signed-in user. Single-user for now: always the owner.
    Used as a FastAPI dependency, so login can replace it in one place."""
    return OWNER_ID


def tz_for(name: str | None):
    """A tzinfo for an IANA name; falls back to a fixed offset when the
    system has no time zone database (Qatar has no daylight saving)."""
    name = name or OWNER_TZ
    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    return timezone(timedelta(hours=3)) if name == OWNER_TZ else timezone.utc


def valid_tz(name: str) -> bool:
    if ZoneInfo is None:
        return name == OWNER_TZ
    try:
        ZoneInfo(name)
        return True
    except Exception:
        return False


def user_tz(db: sqlite3.Connection, user_id: int):
    row = db.execute("SELECT timezone FROM users WHERE id = ?", (user_id,)).fetchone()
    return tz_for(row["timezone"] if row else None)


def today_for(db: sqlite3.Connection, user_id: int) -> date:
    return datetime.now(user_tz(db, user_id)).date()


def log_activity(db: sqlite3.Connection, kind: str, n: int = 1, user_id: int | None = None) -> None:
    """Add n to today's count of `kind`. The caller commits."""
    if kind not in ACTIVITY_KINDS:
        raise ValueError(f"unknown activity kind: {kind}")
    if n <= 0:
        return
    uid = user_id if user_id is not None else current_user_id()
    day = today_for(db, uid).isoformat()
    db.execute(
        f"INSERT INTO activity (user_id, day, {kind}) VALUES (?, ?, ?) "
        f"ON CONFLICT(user_id, day) DO UPDATE SET {kind} = {kind} + excluded.{kind}",
        (uid, day, n),
    )


def streak_for(db: sqlite3.Connection, user_id: int) -> dict:
    """Current streak (alive until the end of today, so it does not reset just
    because today has not been studied yet), longest streak, and whether
    today already counts."""
    active = {
        date.fromisoformat(r["day"])
        for r in db.execute(
            "SELECT day FROM activity WHERE user_id = ? AND reviews + marks + texts > 0",
            (user_id,),
        )
    }
    today = today_for(db, user_id)
    studied_today = today in active
    d = today if studied_today else today - timedelta(days=1)
    current = 0
    while d in active:
        current += 1
        d -= timedelta(days=1)
    longest, run, prev = 0, 0, None
    for d in sorted(active):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        longest = max(longest, run)
        prev = d
    return {
        "current": current,
        "longest": longest,
        "today": studied_today,
        "active_days": len(active),
    }


# ---- one-time setup: the owner's row and history from data already saved ----

def _local_day(stamp: str, tz) -> str | None:
    """'2026-09-01 18:20:00' (UTC, SQLite) or an ISO time -> local YYYY-MM-DD."""
    try:
        dt = datetime.fromisoformat(stamp.replace(" ", "T"))
    except (ValueError, AttributeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).date().isoformat()


def ensure_owner(conn: sqlite3.Connection) -> None:
    """Create the owner's row once. 'Joined' is the first word saved, so the
    profile reflects the history already in the database."""
    if conn.execute("SELECT 1 FROM users WHERE id = ?", (OWNER_ID,)).fetchone():
        return
    first = conn.execute("SELECT MIN(created_at) AS t FROM words").fetchone()["t"]
    conn.execute(
        "INSERT INTO users (id, name, timezone, created_at) "
        "VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))",
        (OWNER_ID, OWNER_NAME, OWNER_TZ, first),
    )


def backfill_activity(conn: sqlite3.Connection) -> None:
    """Rebuild past study days from what is already saved: when each word was
    added, each card's last review, and when each note was added. Runs once,
    so the streak does not start from zero."""
    tz = tz_for(OWNER_TZ)
    days: dict[str, dict[str, int]] = defaultdict(lambda: dict.fromkeys(ACTIVITY_KINDS, 0))
    for r in conn.execute("SELECT created_at, card_json FROM words"):
        d = _local_day(r["created_at"], tz) if r["created_at"] else None
        if d:
            days[d]["marks"] += 1
        if r["card_json"]:
            try:
                last = json.loads(r["card_json"]).get("last_review")
            except (ValueError, AttributeError):
                last = None
            d = _local_day(last, tz) if last else None
            if d:
                days[d]["reviews"] += 1
    for r in conn.execute("SELECT created_at FROM texts"):
        d = _local_day(r["created_at"], tz) if r["created_at"] else None
        if d:
            days[d]["texts"] += 1
    conn.executemany(
        "INSERT OR IGNORE INTO activity (user_id, day, reviews, marks, texts) VALUES (?, ?, ?, ?, ?)",
        [(OWNER_ID, d, c["reviews"], c["marks"], c["texts"]) for d, c in days.items()],
    )
