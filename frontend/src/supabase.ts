import { createClient } from "@supabase/supabase-js";

/** The browser's connection to Supabase. Both values are public by design
 *  (what each person can read or change is decided by row level security),
 *  so they live here; VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
 *  override them, for another project or a local test. */
const url = import.meta.env.VITE_SUPABASE_URL || "https://cyhmgmsdqlnllsuobfcw.supabase.co";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_8RYJ4NsMgU16zsSF1a8D9g_HwTZwDfT";

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
