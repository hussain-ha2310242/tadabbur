# Tadabbur (تدبّر)

A personal Arabic reading and vocabulary app. Paste an article, read it one
word or one sentence at a time, mark how well you know each word, save
phrases and notes on any run of words, and review them all as flashcards on
a spaced-repetition schedule (FSRS). Everything runs locally; the only
outside service is Fanar.

## Run

```sh
cp .env.example .env   # add FANAR_API_KEY
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000/api/health

The first build takes a while: CAMeL Tools and its data (light bundle) are
baked into the backend image. The database upgrades itself on start
(`PRAGMA user_version`, see `backend/app/db.py`).

## Deploy

The frontend deploys to **Netlify** from this repository; `netlify.toml`
holds the settings (build in `frontend/`, publish `dist/`).

1. In Netlify: *Add new project > Import an existing project > GitHub*, pick
   this repository. The settings are read from `netlify.toml`.
2. Host the backend (FastAPI + CAMeL Tools needs about 1-2 GB of memory; the
   plan is Google Cloud Run), then set `API_URL` to its https address in
   *Site configuration > Environment variables* and redeploy. Calls to
   `/api/*` are forwarded there, so the app needs no CORS setup.

Without `API_URL` the site still builds and shows, but cannot load data.

## What does what

- **Reading:** CAMeL Tools splits and analyses each text once, when it is
  saved (lemma, root, part of speech). Fanar adds dictionary glosses, the
  sentence translations, and the meaning of any phrase you select.
- **Study data from Claude:** instead of an API call, a note can carry a
  prompt you paste into Claude; its JSON reply is imported as sentence
  translations and word meanings in context.
- **Audio:** Fanar TTS, cached forever in `data/audio/` (one call per sentence).
- **Review:** words, phrases and notes share one deck and one level scale
  (not known, hard, easy, known); the level you pick is the grade.
- **You:** a profile with a daily streak; any review, level change or new
  note counts for the day.

## Layout

- `backend/` - FastAPI + SQLite. `app/routers/` holds one module per area
  (texts, vocab, review, annotations, profile, study, tags, enrich, audio,
  stats, settings); `app/users.py` is the one place the current user is
  decided, for the multi-user step later.
- `frontend/` - Vite + React + TypeScript + Tailwind. A paper sheet on a
  desk; Rakkas for the name, Playpen Sans (Arabic and Latin) for text.
- `content/` - authored source material (see `content/README.md`).
- `data/` - the SQLite database and cached audio (not in git).
