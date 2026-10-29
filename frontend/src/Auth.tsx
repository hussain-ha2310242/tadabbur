import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { Landing, plainAuthError } from "./Landing";
import { isDemo, onDemoChange, stopDemo } from "./demo";
import { READER_TOUR, Tour } from "./Tour";

/** The app once someone is signed in; the app in demo mode while someone is
 *  trying it; otherwise the landing page. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [demo, setDemo] = useState(isDemo());
  const [touring, setTouring] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s && isDemo()) stopDemo(); // signed in from the demo: back to the real data
    });
    const off = onDemoChange((on) => {
      setDemo(on);
      setTouring(on); // the tour offers itself when the demo starts; skip any time
    });
    return () => {
      data.subscription.unsubscribe();
      off();
    };
  }, []);

  if (session === undefined) return null;
  if (session) {
    // a new key per person, so nothing from one account shows in another
    return <div key={session.user.id}>{children}</div>;
  }
  if (demo) {
    return (
      <>
        <div key="demo">{children}</div>
        <DemoBar onTour={() => setTouring(true)} />
        {touring && <Tour steps={READER_TOUR} onDone={() => setTouring(false)} />}
      </>
    );
  }
  return <Landing />;
}

/** While trying the app: nothing is kept, and the way to keep it. */
function DemoBar({ onTour }: { onTour: () => void }) {
  const leave = (hash = "") => {
    stopDemo();
    if (hash) window.location.hash = hash;
  };
  return (
    <div className="demo-bar hand" role="region" aria-label="Demo" dir="ltr">
      <span className="demo-bar-text">trying Tadabbur · nothing is saved</span>
      <button onClick={onTour}>tour</button>
      <button className="demo-bar-go" onClick={() => leave("signup")}>
        sign up to keep your words
      </button>
      <button onClick={() => leave()} aria-label="Leave the demo" title="Leave the demo">
        ×
      </button>
    </div>
  );
}

/** On the profile: who you are signed in as, a new password (for email
 *  accounts), signing out, and deleting the account. */
export function Account() {
  const [user, setUser] = useState<User | null>(null);
  const [changing, setChanging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  if (!user) return null;
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? [user.app_metadata?.provider ?? "email"];
  const hasPassword = providers.includes("email");

  async function deleteAccount() {
    setBusy(true);
    const { error } = await supabase.rpc("delete_my_account");
    setBusy(false);
    if (error) {
      setMsg(error.message);
      return;
    }
    await supabase.auth.signOut();
  }

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
        {hasPassword && (
          <>
            <button onClick={() => setChanging((c) => !c)} className="pf-signout" aria-expanded={changing}>
              change password
            </button>
            <span className="pf-dot" aria-hidden="true">
              ·
            </span>
          </>
        )}
        <button onClick={() => supabase.auth.signOut()} className="pf-signout">
          sign out
        </button>
        <span className="pf-dot" aria-hidden="true">
          ·
        </span>
        <button onClick={() => setDeleting((d) => !d)} className="pf-signout" aria-expanded={deleting}>
          delete account
        </button>
      </span>
      {deleting && (
        <p className="pf-delete">
          This removes your account with all your notes, words and history, for good.
          <button onClick={deleteAccount} disabled={busy} className="pf-delete-go">
            {busy ? "deleting…" : "delete everything"}
          </button>
          <button onClick={() => setDeleting(false)} className="pf-signout">
            keep it
          </button>
        </p>
      )}
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
