import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  decideAdminAccess,
  enforceAdminRouteAccess,
} from "@/lib/admin/access";
import { createClient } from "@/lib/supabase/server";

export type AuthorizedAdmin = Readonly<{
  email: string;
  userId: string;
}>;

export async function requireAdminUser(): Promise<AuthorizedAdmin> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const decision = decideAdminAccess(
    user ? { email: user.email ?? null, id: user.id } : null,
    process.env.ADMIN_EMAILS,
  );

  if (decision.status !== "allowed") {
    enforceAdminRouteAccess(decision, { notFound, redirect });
  }

  return { email: decision.email, userId: decision.userId };
}
