import type { NumberImportCountryCode } from "./import-eligibility-token.server";

export type NumberImportProductStatus =
  | "verification"
  | "pending"
  | "importing"
  | "action_required"
  | "active"
  | "failed";

export type NumberImportClaimDisposition =
  | "claimed"
  | "already_started"
  | "in_progress"
  | "reconciliation_required";

export interface NumberImportClaim {
  disposition: NumberImportClaimDisposition;
  operationId: string;
  phoneNumberId: string;
}

export interface NumberImportContext {
  importStatus: NumberImportProductStatus;
  operationId: string;
  phoneNumberId: string;
  providerImportId: string;
  providerNumberId: string | null;
  workspaceId: string;
}

export type NumberImportDisconnectDisposition =
  | "claimed"
  | "already_disconnected"
  | "in_progress"
  | "reconciliation_required";

export interface NumberImportDisconnectClaim {
  disposition: NumberImportDisconnectDisposition;
  operationId: string;
  providerImportId: string | null;
  providerNumberId: string | null;
}

export interface NumberImportPersistenceFailure {
  providerCode: string | null;
  providerMessage: string;
  providerResourceId: string | null;
}

export interface NumberImportRepository {
  claimImport(input: {
    countryCode: NumberImportCountryCode;
    operationId: string;
    phoneNumber: string;
    workspaceId: string;
  }): Promise<NumberImportClaim>;
  recordImportStarted(input: {
    importStatus: NumberImportProductStatus;
    operationId: string;
    providerImportId: string;
    providerName: string;
    providerStatus: string;
    verificationCode: string | null;
    workspaceId: string;
  }): Promise<{ phoneNumberId: string; recorded: boolean }>;
  markImportUnknown(input: {
    failure: NumberImportPersistenceFailure;
    operationId: string;
    workspaceId: string;
  }): Promise<boolean>;
  getImportContext(input: {
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<NumberImportContext | null>;
  getCallbackContext(providerImportId: string): Promise<{
    phoneNumberId: string;
    workspaceId: string;
  } | null>;
  updateImportStatus(input: {
    importStatus: NumberImportProductStatus;
    observedAt: string;
    phoneNumberId: string;
    providerNumberId: string | null;
    providerStatus: string;
    usable: boolean;
    verificationCode: string | null;
    workspaceId: string;
  }): Promise<boolean>;
  claimDisconnect(input: {
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<NumberImportDisconnectClaim>;
  completeDisconnect(input: {
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<boolean>;
  markDisconnectUnknown(input: {
    failure: NumberImportPersistenceFailure;
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<boolean>;
}
