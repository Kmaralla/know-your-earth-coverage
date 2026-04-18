import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://example.supabase.co";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "public-anon-key";
  return createBrowserClient(url, anon, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}
