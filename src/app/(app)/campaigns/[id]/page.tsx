import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadCampaignEditor } from "@/app/(app)/campaigns/data";
import { CampaignEditor } from "@/components/campaigns/campaign-editor";

type CampaignPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: CampaignPageProps): Promise<Metadata> {
  const { id } = await params;
  const campaign = await loadCampaignEditor(id);
  return { title: campaign?.name || "Campaign" };
}

export default async function CampaignPage({ params }: CampaignPageProps) {
  const { id } = await params;
  const campaign = await loadCampaignEditor(id);
  if (!campaign) notFound();
  return <CampaignEditor initialData={campaign} key={`${campaign.id}-${campaign.status}`} />;
}
