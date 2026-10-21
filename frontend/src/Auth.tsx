import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { DeskSky } from "./DeskSky";

const redirectTo = () => window.location.origin;

/** The app once someone is signed in; before that, the sign-in sheet. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <SignIn />;
  // a new key per person, so nothing from one account shows in another
  return <div key={session.user.id}>{children}</div>;
}

function SignInSheet({ children }: { children: ReactNode }) {
  return (
    <>
      <DeskSky />
      <main className="signin" dir="ltr">
        <h1 className="signin-brand ar">
          <span className="hl-under">تدبّر</span>
        </h1>
        {children}
      </main>
    </>
  );
}

/** Email link sign-in (no password), or a guest account that can be kept later. */
function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function guest() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInAnonymously();
    setBusy(false);
    if (error) {
      setError(
        /disabled/i.test(error.message)
          ? "Guest accounts are off. Turn on anonymous sign-ins in Supabase (Authentication > Sign In / Providers), or use your email."
          : error.message,
      );
    }
  }

  return (
    <SignInSheet>
      {sent ? (
        <p className="signin-note hand">
          A sign-in link is on its way to <b>{email.trim()}</b>. Open it on this device.
        </p>
      ) : (
        <form className="signin-form" onSubmit={sendLink}>
          <label className="hand" htmlFor="signin-email">
            your email, for a sign-in link
          </label>
          <input
            id="signin-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <button type="submit" className="signin-go hand" disabled={busy || !email.trim()}>
            send the link
          </button>
          <button type="button" className="signin-guest hand" onClick={guest} disabled={busy}>
            or start as a guest
          </button>
        </form>
      )}
      {error && <p className="me-error hand">{error}</p>}
    </SignInSheet>
  );
}

/** On the profile: who you are signed in as. A guest can keep their notes by
 *  adding an email; the account stays the same, so nothing moves. */
export function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  if (!user) return null;

  async function keep(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: redirectTo() });
    setBusy(false);
    setMsg(error ? error.message : `check ${email.trim()} to confirm; your notes stay as they are`);
  }

  return (
    <div className="pf-account hand">
      {user.is_anonymous ? (
        <form onSubmit={keep} className="pf-keep">
          <span>guest account: add an email to keep your notes</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email to keep your notes"
          />
          <button type="submit" disabled={busy || !email.trim()}>
            keep
          </button>
        </form>
      ) : (
        <span>
          {user.email}
          <span className="pf-dot" aria-hidden="true">
            ·
          </span>
          <button onClick={() => supabase.auth.signOut()} className="pf-signout">
            sign out
          </button>
        </span>
      )}
      {msg && <p className="pf-account-msg">{msg}</p>}
    </div>
  );
}
