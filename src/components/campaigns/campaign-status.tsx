import React from "react";
import type { CampaignClientStatus } from "@/components/campaigns/types";

const labels: Record<CampaignClientStatus, string> = {
  active: "Active",
  draft: "Draft",
  finished: "Finished",
  paused: "Paused",
};

export function CampaignStatusBadge({ status }: { status: CampaignClientStatus }) {
  const styles =
    status === "active"
      ? "bg-[#E9F5EE] text-[#07813F] border-[#C2E8D2]"
      : status === "paused"
        ? "bg-[#FFF4DE] text-[#B97913] border-[#FBE3B5]"
        : "bg-[#F2F4F3] text-[#66706A] border-[#E5E9E6]";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${styles}`}>
      {labels[status]}
    </span>
  );
}
