export type NumberProductStatus = "pending" | "ready";
export type NumberProductStatusLabel = "Pending" | "Ready";

export type NumberSource = "included" | "imported";
export type NumberSourceLabel = "Included" | "Imported";

export type NumberImportStatus =
  | "verification"
  | "pending"
  | "importing"
  | "action_required"
  | "active"
  | "failed";

export type NumberImportStatusLabel =
  | "Verification"
  | "Pending"
  | "Import in progress"
  | "Action required"
  | "Active"
  | "Failed";

export interface NumberClientDto {
  id: string;
  phoneNumber: string;
  countryCode: string | null;
  source: NumberSource;
  sourceLabel: NumberSourceLabel;
  status: NumberProductStatus;
  statusLabel: NumberProductStatusLabel | NumberImportStatusLabel;
  importStatus: NumberImportStatus | null;
  isDefault: boolean;
  createdAt: string;
  activatedAt: string | null;
  verificationCode: string | null;
  setup:
    | {
        title: string;
        description: string;
      }
    | null;
}

export interface NumberSearchCandidateDto {
  selectionId: string;
  phoneNumber: string;
  areaCode: string;
  locality: string | null;
  region: string | null;
}

export interface BillingNumberAllowance {
  maxPhoneNumbers: number;
}

export interface NumberCapacityDecision {
  allowed: boolean;
  currentNumberCount: number;
  maxPhoneNumbers: number;
  remainingSlots: number;
  error: { code: "PHONE_NUMBER_LIMIT_REACHED"; message: string } | null;
}

export type CampaignUsingNumberState =
  | "draft"
  | "active"
  | "paused"
  | "finished"
  | "deleted";

export interface CampaignUsingNumber {
  id: string;
  phoneNumberId: string;
  state: CampaignUsingNumberState;
}

export interface NumberRemovalDecision {
  allowed: boolean;
  blockingCampaignIds: string[];
  error:
    | {
        code: "PHONE_NUMBER_IN_ACTIVE_CAMPAIGN";
        message: string;
      }
    | null;
}
