"use client";

import React from "react";

import { CampaignActiveView } from "@/components/campaigns/campaign-active/campaign-active-view";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder/campaign-builder";
import type { CampaignEditorDto } from "@/components/campaigns/types";

export function CampaignEditor({ initialData }: { initialData: CampaignEditorDto }) {
  if (initialData.status === "draft") {
    return <CampaignBuilder initialData={initialData} />;
  }

  return <CampaignActiveView initialData={initialData} />;
}
