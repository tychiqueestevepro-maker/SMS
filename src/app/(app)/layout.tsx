import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { loadBillingSettingsData } from "@/app/(app)/settings/billing-data";
import { createClient } from "@/lib/supabase/server";

export default async function ProductLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const fullName = typeof user.user_metadata.full_name === "string" ? user.user_metadata.full_name : null;

  const { data: workspace } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle();
  const workspaceId = workspace?.id ?? "";

  const { count } = await supabase
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("has_unread_messages", true);

  const billingData = await loadBillingSettingsData();
  const smsUsage = billingData.usage
    ? { used: billingData.usage.usedCredits, max: billingData.usage.safetyCapCredits }
    : null;

  return (
    <AppShell email={user.email ?? "Account"} fullName={fullName} unreadCount={count ?? 0} smsUsage={smsUsage}>
      {children}
    </AppShell>
  );
}
