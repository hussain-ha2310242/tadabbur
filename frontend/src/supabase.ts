import { createClient } from "@supabase/supabase-js";

/** The browser's connection to Supabase. Both values are public by design
 *  (what each person can read or change is decided by row level security),
 *  so they live here; VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
 *  override them, for another project or a local test. */
const url = import.meta.env.VITE_SUPABASE_URL || "https://cyhmgmsdqlnllsuobfcw.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8RYJ4NsMgU16zsSF1a8D9g_HwTZwDfT";

// PKCE: a sign-in link or Google returns a one-time code, swapped for a session here
export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" },
});

export type AuthSettings = { google: boolean; email: boolean; signup: boolean };

/** Which ways in are switched on in Supabase, so the page only offers those.
 *  If the settings cannot be read, everything is offered. */
export async function authSettings(): Promise<AuthSettings> {
  try {
    const r = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()) as { external?: Record<string, boolean>; disable_signup?: boolean };
    return { google: !!s.external?.google, email: s.external?.email !== false, signup: !s.disable_signup };
  } catch {
    return { google: true, email: true, signup: true };
  }
}
