# Tadabbur (تدبّر)

A personal Arabic reading and vocabulary app. Paste an article, read it one
word or one sentence at a time, mark how well you know each word, save
phrases and notes on any run of words, and review them all as flashcards on
a spaced-repetition schedule (FSRS).

It is one Netlify site and one Supabase project: the app talks to Supabase
directly for your data, and a few small Netlify functions call Fanar with a
key the browser never sees.

## What does what

- **Reading:** when a note is saved, its text is split into sentences and
  words in the browser, and Fanar analyses each word once (lemma, root, part
  of speech, meaning). The analysis of a written word is kept and shared, so
  it is paid for once. Fanar also gives the sentence translations and the
  meaning of any phrase you select.
- **Study data from Claude:** instead of an API call, a note can carry a
  prompt you paste into Claude; its JSON reply is imported as sentence
  translations and word meanings in context.
- **Audio:** Fanar TTS, kept in private Supabase storage (one call per sentence).
- **Review:** words, phrases and notes share one deck and one level scale
  (not known, hard, easy, known); the level you pick is the grade.
- **You:** sign in with an email link (or start as a guest and add an email
  later). A profile with a daily streak; any review, level change or new
  note counts for the day.

## Layout

- `frontend/` - Vite + React + TypeScript + Tailwind. A paper sheet on a
  desk; Rakkas for the name, Playpen Sans (Arabic and Latin) for text.
  - `src/api.ts` - every read and write, on `@supabase/supabase-js`;
    scheduling with `ts-fsrs`.
  - `src/arabic.ts` - sentences and tokens; `src/study.ts` - the Claude prompt.
  - `netlify/functions/` - `analyze`, `translate`, `enrich`, `tts` at `/api/*`.
    Each checks the caller's Supabase session first.
- `supabase/schema.sql` - the database: tables, row level security (each
  person sees only their own rows), and the few SQL functions the app calls.
- `content/` - authored source material (see `content/README.md`).
- `netlify.toml` - build settings; `.env.example` - the server-side settings.
