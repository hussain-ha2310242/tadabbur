import os
import sqlite3
from pathlib import Path

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS texts (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    tokens_json TEXT NOT NULL,
    importance  INTEGER NOT NULL DEFAULT 2,
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS glosses (
    lemma_key TEXT PRIMARY KEY,
    gloss     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS word_info (
    lemma_key TEXT PRIMARY KEY,
    info_json TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS translations (
    key         TEXT PRIMARY KEY,
    translation TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS words (
    id         INTEGER PRIMARY KEY,
    lemma_key  TEXT UNIQUE NOT NULL,
    display    TEXT NOT NULL,
    is_phrase  INTEGER NOT NULL DEFAULT 0,
    root       TEXT,
    pos        TEXT,
    gloss      TEXT,
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'not_known',
    importance INTEGER NOT NULL DEFAULT 0,
    card_json  TEXT,
    due        TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS text_tags (
    text_id INTEGER NOT NULL,
    tag_id  INTEGER NOT NULL,
    PRIMARY KEY (text_id, tag_id)
);

-- Claude-produced study data for a note: sentence translations and
-- per-word meanings/roots in context. Keyed by note.
CREATE TABLE IF NOT EXISTS note_analysis (
    text_id       INTEGER PRIMARY KEY,
    analysis_json TEXT NOT NULL,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- user edits to a word's meaning/root; they win over Claude's and CAMeL's
CREATE TABLE IF NOT EXISTS meaning_overrides (
    lemma_key TEXT PRIMARY KEY,
    gloss     TEXT,
    root      TEXT
);

-- the people using the app; id 1 is the owner (see users.py)
CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    timezone   TEXT NOT NULL DEFAULT 'Asia/Qatar',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- your notes on the text: a span of words (it may cross sentences, from
-- start_si/start_ti to end_si/end_ti inclusive), the Arabic it covers, your
-- comment, and its own level and schedule, so it is a flashcard as well
CREATE TABLE IF NOT EXISTS annotations (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL DEFAULT 1,
    text_id    INTEGER NOT NULL,
    start_si   INTEGER NOT NULL,
    start_ti   INTEGER NOT NULL,
    end_si     INTEGER NOT NULL,
    end_ti     INTEGER NOT NULL,
    quote      TEXT NOT NULL,
    meaning    TEXT,
    comment    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'not_known',
    card_json  TEXT,
    due        TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- one row per user per day (in the user's time zone): what they studied.
-- Any non-zero count makes the day part of the streak.
CREATE TABLE IF NOT EXISTS activity (
    user_id INTEGER NOT NULL,
    day     TEXT NOT NULL,
    reviews INTEGER NOT NULL DEFAULT 0,
    marks   INTEGER NOT NULL DEFAULT 0,
    texts   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
);
"""

# bump when a migration is added below; stored in the file (PRAGMA user_version)
SCHEMA_VERSION = 4

# tables whose rows belong to one person. The column is in place for the
# multi-user step; every row so far belongs to the owner (id 1).
USER_OWNED = ("texts", "words", "tags")

_initialized = False


def get_db() -> sqlite3.Connection:
    global _initialized
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    if not _initialized:
        conn.executescript(SCHEMA)
        # migration for dbs created before the importance column existed
        try:
            conn.execute(
                "ALTER TABLE texts ADD COLUMN importance INTEGER NOT NULL DEFAULT 2"
            )
        except sqlite3.OperationalError:
            pass  # column already there
        try:
            conn.execute(
                "ALTER TABLE words ADD COLUMN importance INTEGER NOT NULL DEFAULT 0"
            )
        except sqlite3.OperationalError:
            pass
        # old three-state model -> unified four-level model
        conn.execute("UPDATE words SET status = 'hard' WHERE status = 'learning'")
        conn.execute("UPDATE words SET status = 'known' WHERE status = 'ignored'")
        _migrate(conn)
        conn.commit()
        _initialized = True
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Versioned, run-once steps. Each step is also safe to run twice."""
    from .users import backfill_activity, ensure_owner

    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version < 2:
        # v2: the owner's profile, user_id on owned rows, and the streak's
        # history rebuilt from the words, reviews and notes already saved
        for table in USER_OWNED:
            try:
                conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1"
                )
            except sqlite3.OperationalError:
                pass  # column already there
        ensure_owner(conn)
        backfill_activity(conn)
    else:
        ensure_owner(conn)
    if version < 3:
        # v3: where a note comes from (author, book, site) and a link to it
        for col in ("source", "url"):
            try:
                conn.execute(f"ALTER TABLE texts ADD COLUMN {col} TEXT")
            except sqlite3.OperationalError:
                pass
    if version < 4:
        # v4: the AI meaning of a selection, kept beside your note
        try:
            conn.execute("ALTER TABLE annotations ADD COLUMN meaning TEXT")
        except sqlite3.OperationalError:
            pass
    if version < SCHEMA_VERSION:
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
