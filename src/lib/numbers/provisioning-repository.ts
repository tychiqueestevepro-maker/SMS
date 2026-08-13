import type { NormalizedBusinessVerification } from "./business";

export type WorkspaceSetupDisposition =
  | "claimed"
  | "ready"
  | "in_progress"
  | "reconciliation_required";

export interface WorkspaceSetupClaim {
  disposition: WorkspaceSetupDisposition;
  operationId: string;
}

export type NumberPurchaseDisposition =
  | "claimed"
  | "already_started"
  | "in_progress"
  | "reconciliation_required";

export interface NumberPurchaseClaim {
  disposition: NumberPurchaseDisposition;
  operationId: string;
  phoneNumberId: string | null;
}

export type NumberReleaseDisposition =
  | "claimed"
  | "already_released"
  | "in_progress"
  | "reconciliation_required"
  | "blocked_active_campaign";

export interface NumberReleaseClaim {
  disposition: NumberReleaseDisposition;
  operationId: string;
  providerNumberId: string | null;
}

export interface InternalSetupFailure {
  providerCode: string | null;
  providerMessage: string;
  providerResourceId: string | null;
}

export interface NumberSearchAttemptClaim {
  allowed: boolean;
  replayed: boolean;
  retryAfterSeconds: number;
}

/** Durable, service-role boundary for all non-idempotent number side effects. */
export interface NumberProvisioningRepository {
  claimNumberSearchAttempt(input: {
    requestId: string;
    requestedAt: string;
    workspaceId: string;
  }): Promise<NumberSearchAttemptClaim>;
  claimWorkspaceSetup(input: {
    operationId: string;
    workspaceId: string;
  }): Promise<WorkspaceSetupClaim>;
  recordWorkspaceAccount(input: {
    encryptedCredential: string;
    operationId: string;
    providerAccountId: string;
    providerName: string;
    workspaceId: string;
  }): Promise<boolean>;
  completeWorkspaceSetup(input: {
    messagingServiceId: string;
    operationId: string;
    workspaceId: string;
  }): Promise<boolean>;
  markWorkspaceSetupUnknown(input: {
    failure: InternalSetupFailure;
    operationId: string;
    step: "account" | "service";
    workspaceId: string;
  }): Promise<boolean>;
  claimNumberPurchase(input: {
    businessVerification: NormalizedBusinessVerification;
    operationId: string;
    phoneNumber: string;
    selectionNonce: string;
    workspaceId: string;
  }): Promise<NumberPurchaseClaim>;
  completeNumberPurchase(input: {
    operationId: string;
    providerName: string;
    providerNumberId: string;
    providerStatus: string;
    workspaceId: string;
  }): Promise<{ completed: boolean; phoneNumberId: string }>;
  markNumberPurchaseUnknown(input: {
    failure: InternalSetupFailure;
    operationId: string;
    workspaceId: string;
  }): Promise<boolean>;
  claimNumberRelease(input: {
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<NumberReleaseClaim>;
  completeNumberRelease(input: {
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<boolean>;
  markNumberReleaseUnknown(input: {
    failure: InternalSetupFailure;
    operationId: string;
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<boolean>;
}
