# Running Tadabbur on your computer

The site is one Netlify project (the app in `frontend/` and four small
functions in `frontend/netlify/functions/`) talking to one Supabase project.
Your computer runs the app; Supabase stays the real, online one.

## The app and the functions together (recommended)

Needs Node 22 or newer.

```sh
cd frontend
npm install
echo "FANAR_API_KEY=your-fanar-key" > .env   # read by the functions; never commit it
npx netlify-cli dev
```

Open http://localhost:8888. Sign-up, sign-in, saving notes, word analysis,
translations and audio all work, against the real Supabase project.

## The app alone (quicker)

```sh
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Sign-up, sign-in, reading, levels, phrases and the
deck all work. Saving a new article with "extract & save", audio and word
details need the functions, so use `netlify dev` for those (or save with
Claude's reply).

## Signing in locally

- **Email and password** work as they are.
- **Google** sends you back to the address Supabase allows. In Supabase:
  *Authentication > URL Configuration > Redirect URLs*, add
  `http://localhost:8888/**` and `http://localhost:5173/**`.

## Settings the server functions read

| Name | Needed | What it does |
|---|---|---|
| `FANAR_API_KEY` | yes | Fanar: word analysis, translations, word details, audio |
| `SUPABASE_SECRET_KEY` | no | keeps word analyses, translations and audio so they are paid for once |
| `FANAR_TTS_VOICE` | no | the default voice (Noor, Huda, Jasim, Hamad, Abdulrahman) |
| `LIMIT_ANALYZE`, `LIMIT_TRANSLATE`, `LIMIT_ENRICH`, `LIMIT_TTS` | no | Fanar calls per person per day (300, 400, 200, 300) |

On Netlify these live in *Site configuration > Environment variables*. Never
give them a `VITE_` prefix: those are built into the public page.

## The database

`supabase/schema.sql` is the whole database: tables, row level security (each
person sees only their own rows), the few SQL functions the app calls, the
daily limits and account deletion. A fresh Supabase project can be set up by
running it in the SQL editor.
