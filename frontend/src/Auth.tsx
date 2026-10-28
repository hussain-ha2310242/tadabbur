import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Landing, plainAuthError } from "./Landing";

/** The app once someone is signed in; before that, the landing page with
 *  sign up and sign in (email and password). */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Landing />;
  // a new key per person, so nothing from one account shows in another
  return <div key={session.user.id}>{children}</div>;
}

/** On the profile: who you are signed in as, a new password, and signing out. */
export function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  if (!user) return null;

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (!user?.email) return;
    setBusy(true);
    setMsg(null);
    // the current password is checked first, so an open laptop is not enough to change it
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: current });
    if (check.error) {
      setBusy(false);
      setMsg("The current password is not right.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setBusy(false);
    if (error) {
      setMsg(plainAuthError(error.message));
      return;
    }
    setCurrent("");
    setNext("");
    setChanging(false);
    setMsg("password changed");
  }

  return (
    <div className="pf-account hand">
      <span>
        {user.email}
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        <button onClick={() => setChanging((c) => !c)} className="pf-signout" aria-expanded={changing}>
          change password
        </button>
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        <button onClick={() => supabase.auth.signOut()} className="pf-signout">
          sign out
        </button>
      </span>
      {changing && (
        <form onSubmit={changePassword} className="pf-keep">
          <input type="email" value={user.email ?? ""} autoComplete="username" readOnly hidden />
          <input
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="current password"
            aria-label="Current password"
          />
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="new password (8+)"
            aria-label="New password"
          />
          <button type="submit" disabled={busy || !current || next.length < 8}>
            {busy ? "saving…" : "save"}
          </button>
        </form>
      )}
      {msg && <p className="pf-account-msg">{msg}</p>}
    </div>
  );
}
