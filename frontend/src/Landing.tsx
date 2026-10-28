import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "./supabase";
import { DeskSky } from "./DeskSky";
import { PaperDefs, PaperSheet } from "./Paper";

const REPO = "https://github.com/hussain-ha2310242/tadabbur";

/** A step counter for the small demos; still when the reader asks for less motion. */
function useTick(ms: number, steps: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setN((x) => (x + 1) % steps), ms);
    return () => window.clearInterval(id);
  }, [ms, steps]);
  return n;
}

/** Supabase's messages, said plainly. */
export function plainAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password do not match.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: the link is in your inbox.";
  if (/already registered|already been registered/i.test(message)) return "There is already an account with this email. Sign in instead.";
  if (/signups? not allowed|signup is disabled/i.test(message)) return "Sign-ups are closed right now.";
  if (/rate limit/i.test(message)) return "Too many tries. Wait a few minutes, then try again.";
  if (/should be at least/i.test(message)) return "The password is too short (8 characters or more).";
  if (/should be different/i.test(message)) return "The new password must be different from the old one.";
  return message;
}

// ---- the demos: each one loops a single feature, drawn in the app's own style ----

const WORDS = [
  { ar: "قرأ", gloss: "read", root: ["ق", "ر", "أ"] },
  { ar: "الطالب", gloss: "student", root: ["ط", "ل", "ب"] },
  { ar: "الكتاب", gloss: "book", root: ["ك", "ت", "ب"] },
  { ar: "في", gloss: "in", root: [] },
  { ar: "المكتبة", gloss: "library", root: ["ك", "ت", "ب"] },
];

function TapDemo() {
  const n = useTick(1600, WORDS.length);
  const w = WORDS[n];
  return (
    <div className="lp-demo" aria-hidden="true">
      <p className="ar lp-sentence" dir="rtl">
        {WORDS.map((x, i) => (
          <span key={i} className={`lp-tok ${i === n ? "on" : ""}`}>
            {x.ar}
          </span>
        ))}
      </p>
      <div key={n} className="sticky lp-card lp-pop">
        <span className="ar lp-card-word">{w.ar}</span>
        <span className="hand lp-card-gloss">{w.gloss}</span>
        <span className="lp-roots" dir="rtl">
          {w.root.map((r, i) => (
            <span key={i} className="root-l ar">
              {r}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

const LEVEL_NAMES = ["not known", "hard", "easy", "known"];

function LevelDemo() {
  const n = useTick(1100, 4);
  return (
    <div className="lp-demo" aria-hidden="true">
      <p className="ar lp-big" style={{ color: `var(--st-${n})` }}>
        مَلْعَب
      </p>
      <div className="lp-slider">
        <span className="lp-rail" />
        {LEVEL_NAMES.map((_, i) => (
          <span key={i} className="lp-stop" style={{ left: `${(i / 3) * 100}%` }} />
        ))}
        <span className="lp-knob" style={{ left: `${(n / 3) * 100}%`, background: `var(--st-${n})` }} />
      </div>
      <span className="hand lp-level" style={{ color: `var(--st-${n})` }}>
        {LEVEL_NAMES[n]}
      </span>
    </div>
  );
}

function NoteDemo() {
  const n = useTick(1400, 4); // 0 plain, 1 underlined, 2-3 note shown
  return (
    <div className="lp-demo" aria-hidden="true">
      <p className="ar lp-sentence" dir="rtl">
        <span className="lp-tok">قطعنا</span>
        <span className="lp-tok">التذاكر</span>
        <span className={`lp-span ${n >= 1 ? "drawn" : ""}`}>
          <span className="lp-tok">بكل</span>
          <span className="lp-tok">يسر</span>
        </span>
      </p>
      <div className={`sticky lp-card lp-note ${n >= 2 ? "shown" : ""}`}>
        <span className="hand lp-card-gloss">with complete ease</span>
        <span className="lp-note-comment">a phrase worth keeping</span>
      </div>
    </div>
  );
}

function CardDemo() {
  const n = useTick(1700, 2);
  return (
    <div className="lp-demo" aria-hidden="true">
      <div className={`lp-flip ${n === 1 ? "turned" : ""}`}>
        <div className="frame lp-face lp-front">
          <span className="ar lp-big">جَوْلَة</span>
        </div>
        <div className="frame lp-face lp-back">
          <span className="hand lp-card-gloss">tour, trip</span>
          <span className="lp-roots" dir="rtl">
            <span className="root-l ar">ج</span>
            <span className="root-l ar">و</span>
            <span className="root-l ar">ل</span>
          </span>
        </div>
      </div>
      <div className="lp-grid">
        {Array.from({ length: 21 }, (_, i) => (
          <span key={i} className={`lp-cell ${i % 3 !== 1 || i > 15 ? "lit" : ""}`} style={{ animationDelay: `${i * 70}ms` }} />
        ))}
      </div>
    </div>
  );
}

const FEATURES: { title: string; text: string; demo: ReactNode }[] = [
  {
    title: "Tap any word",
    text: "Paste an Arabic article. Every word shows its meaning, its dictionary form and its root.",
    demo: <TapDemo />,
  },
  {
    title: "Mark what you know",
    text: "Four levels, from not known to known. Your words fill a wallet you can search by Arabic, English or root.",
    demo: <LevelDemo />,
  },
  {
    title: "Keep phrases and notes",
    text: "Drag across any run of words to save it as a phrase, with its meaning and your own note.",
    demo: <NoteDemo />,
  },
  {
    title: "Review, a little each day",
    text: "Words and phrases come back as flashcards on a spaced-repetition schedule, and a streak keeps you going.",
    demo: <CardDemo />,
  },
];

/** What a visitor sees before signing in: the idea, the features, and the way in. */
export function Landing() {
  const [mode, setMode] = useState<"signup" | "signin" | null>(null);

  return (
    <>
      <DeskSky />
      <PaperDefs />
      <main className="lp sheet paper" dir="ltr">
        <PaperSheet />
        <header className="lp-head">
          <h1 className="lp-brand ar">
            <span className="hl-under">تدبّر</span>
          </h1>
          <p className="lp-tag">Read Arabic slowly, and keep every word you learn.</p>
          {mode ? (
            <AuthForm mode={mode} onMode={setMode} />
          ) : (
            <div className="lp-cta">
              <button className="lp-go hand" onClick={() => setMode("signup")}>
                sign up, it's free
              </button>
              <button className="lp-link hand" onClick={() => setMode("signin")}>
                sign in
              </button>
            </div>
          )}
        </header>

        <section className="lp-features" aria-label="Features">
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-feature">
              {f.demo}
              <h2 className="lp-title">{f.title}</h2>
              <p className="lp-text">{f.text}</p>
            </article>
          ))}
        </section>

        <footer className="lp-foot hand">
          <button className="lp-link" onClick={() => setMode("signup")}>
            start reading
          </button>
          <span aria-hidden="true">·</span>
          <a className="lp-link" href={REPO} target="_blank" rel="noreferrer">
            source on GitHub
          </a>
          <span aria-hidden="true">·</span>
          <span>made with Claude</span>
        </footer>
      </main>
    </>
  );
}

/** Email and password: a new account, or signing in to one. */
function AuthForm({ mode, onMode }: { mode: "signup" | "signin"; onMode: (m: "signup" | "signin") => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(plainAuthError(error.message));
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) setError(plainAuthError(error.message));
      // with email confirmation on, there is no session until the link is opened
      else if (!data.session) setSent(true);
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <p className="lp-sent hand">
        Almost there: open the link we sent to <b>{email.trim()}</b>, then sign in.
      </p>
    );
  }

  return (
    <form className="signin-form lp-form" onSubmit={submit}>
      <input
        type="email"
        required
        autoFocus
        autoComplete={mode === "signup" ? "email" : "username"}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email"
        aria-label="Email"
      />
      <input
        type="password"
        required
        minLength={mode === "signup" ? 8 : undefined}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={mode === "signup" ? "password (8+ characters)" : "password"}
        aria-label="Password"
      />
      <button
        type="submit"
        className="signin-go hand"
        disabled={busy || !email.trim() || (mode === "signup" ? password.length < 8 : !password)}
      >
        {busy ? "one moment…" : mode === "signup" ? "create my account" : "sign in"}
      </button>
      <button type="button" className="lp-link hand" onClick={() => onMode(mode === "signup" ? "signin" : "signup")}>
        {mode === "signup" ? "already have an account? sign in" : "new here? sign up"}
      </button>
      {error && <p className="me-error hand">{error}</p>}
    </form>
  );
}
