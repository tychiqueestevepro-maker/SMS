import { type NextRequest, NextResponse } from "next/server";

import { getApplicationOrigin } from "@/lib/application-url";
import { createClient } from "@/lib/supabase/server";

const ALLOWED_DESTINATIONS = new Set([
  "/campaigns",
  "/contacts",
  "/inbox",
  "/reset-password",
  "/settings",
]);

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const requestedPath = request.nextUrl.searchParams.get("next") ?? "/campaigns";
  const nextPath = ALLOWED_DESTINATIONS.has(requestedPath) ? requestedPath : "/campaigns";
  const applicationOrigin = getApplicationOrigin();

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(nextPath, applicationOrigin));
    }
  }

  const loginUrl = new URL("/login", applicationOrigin);
  loginUrl.searchParams.set("error", "This sign-in link is invalid or has expired.");
  return NextResponse.redirect(loginUrl);
}
