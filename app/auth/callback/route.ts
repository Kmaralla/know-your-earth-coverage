import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@/lib/supabase/server";

/**
 * Supabase PKCE auth callback.
 * After a magic-link click, Supabase redirects here with ?code=...
 * We exchange the code for a session, set cookies, then send the user
 * to their original destination (or "/" by default).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // `next` carries the original destination (e.g. "/?share=handle")
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const redirectTo = new URL(next, origin);
    const response = NextResponse.redirect(redirectTo);
    const supabase = createRouteHandlerClient(request, response);

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return response;
  }

  // Code missing or exchange failed — send back to home
  return NextResponse.redirect(new URL("/", origin));
}
