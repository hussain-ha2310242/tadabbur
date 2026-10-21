"""content/ -> SQLite loader. Idempotent: run after every content edit.

Stage 2 fills this in. The contract already holds: everything the app
serves comes from CONTENT_DIR files validated against the schemas in
content/README.md - this module is the only writer of content tables.

Usage: python -m app.seed
"""

import os
from pathlib import Path

CONTENT_DIR = Path(os.environ.get("CONTENT_DIR", "./content"))
DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
DB_PATH = DATA_DIR / "app.db"


def main():
    print(f"content: {CONTENT_DIR.resolve()}")
    print(f"db:      {DB_PATH.resolve()}")
    print("seed: not implemented yet (Stage 2)")


if __name__ == "__main__":
    main()
