import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadCampaignEditor } from "@/app/(app)/campaigns/data";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const campaign = await loadCampaignEditor();
  if (!campaign) notFound();
  return <CampaignEditor initialData={campaign} key="new-draft" />;
}
