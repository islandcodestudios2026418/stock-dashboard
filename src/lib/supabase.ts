import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
    if (!url || !key) throw new Error("Supabase env vars not configured");
    _client = createClient(url, key);
  }
  return _client;
}

// Convenience: returns null if env vars not set (for graceful fallback)
export function trySupabase(): SupabaseClient | null {
  try { return getSupabase(); } catch { return null; }
}
