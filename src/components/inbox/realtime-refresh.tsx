"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

export function InboxRealtimeRefresh({ workspaceId }: { workspaceId: string | null }) {
  const router = useRouter();

  useEffect(() => {
    if (!workspaceId) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 150);
    };
    const channel = supabase
      .channel(`workspace-inbox-${workspaceId}`)
      .on(
        "postgres_changes",
        { event: "*", filter: `workspace_id=eq.${workspaceId}`, schema: "public", table: "messages" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", filter: `workspace_id=eq.${workspaceId}`, schema: "public", table: "contacts" },
        refresh,
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [router, workspaceId]);

  return null;
}
