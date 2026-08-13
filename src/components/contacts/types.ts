import type { ContactSearchSource, ExistingContactMatch } from "@/lib/contacts/types";

export type PipelineStageDto = {
  id: string;
  name: string;
  position: number;
  isDefault: boolean;
  contactCount: number;
};

export interface ContactsWorkspaceData {
  contacts: ContactSearchSource[];
  existingContactMatches: ExistingContactMatch[];
  stages: PipelineStageDto[];
  kpis?: {
    total: number;
    replied: number;
    optedOut: number;
    inCampaigns: number;
  };
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
  };
  filters?: {
    search: string;
    filter: string;
    view: string;
  };
};

export type ContactActionResult = {
  ok: boolean;
  message: string;
  imported?: number;
};
