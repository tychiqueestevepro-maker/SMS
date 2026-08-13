export type AdminIdentity = {
  email: string | null;
  id: string;
};

export type AdminAccessDecision =
  | { status: "allowed"; email: string; userId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" };

export type AdminRouteEffects = {
  notFound: () => never;
  redirect: (location: string) => never;
};

export function parseAdminEmails(configuredEmails: string | undefined): ReadonlySet<string> {
  return new Set(
    (configuredEmails ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function decideAdminAccess(
  identity: AdminIdentity | null,
  configuredEmails: string | undefined,
): AdminAccessDecision {
  if (!identity) return { status: "unauthenticated" };
  const email = identity.email?.trim().toLowerCase();
  if (!email || !parseAdminEmails(configuredEmails).has(email)) {
    return { status: "forbidden" };
  }
  return { email, status: "allowed", userId: identity.id };
}

export function enforceAdminRouteAccess(
  decision: Exclude<AdminAccessDecision, { status: "allowed" }>,
  effects: AdminRouteEffects,
): never {
  if (decision.status === "unauthenticated") effects.redirect("/login");
  return effects.notFound();
}
