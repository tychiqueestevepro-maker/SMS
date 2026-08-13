import "server-only";

import { randomUUID } from "node:crypto";

import { parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";

import {
  getProviderFailureDetails,
  ProductMessagingError,
  toProductMessagingError,
  type ProviderFailureDetails,
  type ProviderOperation,
} from "./errors";
import type {
  SmsProvider,
  WorkspaceMessagingSetupProvider,
} from "./provider";
import type { PurchasableNumberCountryCode } from "./types";
import type { NormalizedBusinessVerification } from "../numbers/business";
import { NumberProductError } from "../numbers/errors";
import type {
  InternalSetupFailure,
  NumberProvisioningRepository,
} from "../numbers/provisioning-repository";
import type { NumberSearchCandidateDto } from "../numbers/product-types";
import type {
  NumberSelectionTokenSigner,
  VerifiedNumberSelection,
} from "../numbers/selection-token.server";

export type NumberProvisioningInternalEvent = {
  event:
    | "workspace_setup_completed"
    | "workspace_setup_reconciliation_required"
    | "number_purchase_completed"
    | "number_purchase_reconciliation_required"
    | "number_release_completed"
    | "number_release_reconciliation_required";
  workspaceId: string;
  phoneNumberId: string | null;
  operationId: string;
  occurredAt: string;
  failure: ProviderFailureDetails | null;
};

export interface NumberProvisioningServiceOptions {
  applicationOrigin: string;
  credentialVault: {
    encrypt(plaintext: string, context: string): string;
  };
  providerName: string;
  operationId?: () => string;
  now?: () => Date;
  reportInternalEvent?: (
    event: NumberProvisioningInternalEvent,
  ) => void | Promise<void>;
}

export interface StartNumberOnboardingInput {
  businessVerification: NormalizedBusinessVerification;
  selectionToken: string;
  workspaceId: string;
}

export interface StartNumberOnboardingResult {
  phoneNumberId: string;
  status: "pending";
}

class PersistenceAfterSideEffectError extends Error {
  constructor(
    readonly operation: ProviderOperation,
    readonly providerResourceId: string | null,
  ) {
    super("Riink could not persist a completed messaging side effect.");
    this.name = "PersistenceAfterSideEffectError";
  }
}

function providerFailure(
  error: unknown,
  operation: ProviderOperation,
  providerResourceId: string | null = null,
): ProviderFailureDetails {
  if (error instanceof PersistenceAfterSideEffectError) {
    return {
      operation,
      kind: "unknown",
      providerCode: "PERSISTENCE_AFTER_SIDE_EFFECT",
      providerMessage: error.message,
      providerResourceId: error.providerResourceId ?? providerResourceId,
      retryable: false,
    };
  }

  const details = getProviderFailureDetails(error, operation);
  return {
    ...details,
    providerResourceId: details.providerResourceId ?? providerResourceId,
    retryable: false,
  };
}

function storedFailure(failure: ProviderFailureDetails): InternalSetupFailure {
  return {
    providerCode: failure.providerCode,
    providerMessage: failure.providerMessage.slice(0, 1_000),
    providerResourceId: failure.providerResourceId,
  };
}

function safePhoneNumber(
  value: string,
  countryCode: PurchasableNumberCountryCode,
): boolean {
  const normalized = parseAndNormalizePhoneNumber(value);
  return normalized?.phoneE164 === value && normalized.countryCode === countryCode;
}

/**
 * Coordinates durable claims around provider operations that cannot be safely
 * repeated. No `in_progress` or reconciliation state ever invokes the provider.
 */
export class NumberProvisioningService {
  private readonly now: () => Date;
  private readonly operationId: () => string;
  private readonly origin: string;

  constructor(
    private readonly repository: NumberProvisioningRepository,
    private readonly provider: SmsProvider,
    private readonly setupProvider: WorkspaceMessagingSetupProvider,
    private readonly selectionSigner: NumberSelectionTokenSigner,
    private readonly options: NumberProvisioningServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.operationId = options.operationId ?? randomUUID;
    this.origin = new URL(options.applicationOrigin).origin;
    if (!options.providerName.trim()) {
      throw new RangeError("Provider name is required.");
    }
  }

  async searchNumbers(input: {
    areaCode?: string;
    countryCode: PurchasableNumberCountryCode;
    limit?: number;
    requestId: string;
    workspaceId: string;
  }): Promise<NumberSearchCandidateDto[]> {
    const attempt = await this.repository.claimNumberSearchAttempt({
      requestId: input.requestId,
      requestedAt: this.now().toISOString(),
      workspaceId: input.workspaceId,
    });
    if (!attempt.allowed) throw this.productFailure();
    await this.ensureWorkspaceMessaging(input.workspaceId);

    try {
      const candidates = await this.provider.searchNumbers({
        workspaceId: input.workspaceId,
        countryCode: input.countryCode,
        areaCode: input.areaCode,
        limit: input.limit,
      });
      return candidates.flatMap((candidate) => {
        if (
          !candidate.supportsSms ||
          !safePhoneNumber(candidate.phoneNumber, input.countryCode)
        ) {
          return [];
        }
        return [
          {
            selectionId: this.selectionSigner.issue(
              {
                areaCode: input.areaCode ?? null,
                countryCode: input.countryCode,
                phoneNumber: candidate.phoneNumber,
                providerNumberId: candidate.providerNumberId,
                workspaceId: input.workspaceId,
              },
              { now: this.now() },
            ),
            phoneNumber: candidate.phoneNumber,
            areaCode: input.areaCode ?? null,
            countryCode: input.countryCode,
            locality: candidate.locality,
            region: candidate.region,
          },
        ];
      });
    } catch (error) {
      await this.report({
        event: "workspace_setup_reconciliation_required",
        workspaceId: input.workspaceId,
        phoneNumberId: null,
        operationId: this.operationId(),
        failure: providerFailure(error, "searchNumbers"),
      });
      throw toProductMessagingError(error, "searchNumbers");
    }
  }

  /**
   * Shared setup gate for onboarding flows that need workspace-scoped provider
   * credentials before they can perform an eligibility check. The durable
   * setup claim remains the single source of truth.
   */
  async ensureWorkspaceReady(workspaceId: string): Promise<void> {
    await this.ensureWorkspaceMessaging(workspaceId);
  }

  async startNumberOnboarding(
    input: StartNumberOnboardingInput,
  ): Promise<StartNumberOnboardingResult> {
    const selection = this.selectionSigner.verify(
      input.selectionToken,
      input.workspaceId,
      this.now(),
    );
    if (selection.countryCode !== input.businessVerification.businessAddress.country) {
      throw new NumberProductError("NUMBER_SETUP_INVALID");
    }
    await this.ensureWorkspaceMessaging(input.workspaceId);

    const requestedOperationId = this.operationId();
    const claim = await this.repository.claimNumberPurchase({
      businessVerification: input.businessVerification,
      operationId: requestedOperationId,
      phoneNumber: selection.phoneNumber,
      selectionNonce: selection.nonce,
      workspaceId: input.workspaceId,
    });
    if (claim.disposition === "already_started") {
      if (!claim.phoneNumberId) throw this.productFailure();
      return { phoneNumberId: claim.phoneNumberId, status: "pending" };
    }
    if (claim.disposition !== "claimed" || !claim.phoneNumberId) {
      throw this.productFailure();
    }
    this.assertOperationCorrelation(claim.operationId, requestedOperationId);

    return this.purchaseClaimedNumber(input.workspaceId, claim.operationId, claim.phoneNumberId, selection);
  }

  async releaseNumber(input: {
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<void> {
    const requestedOperationId = this.operationId();
    const claim = await this.repository.claimNumberRelease({
      operationId: requestedOperationId,
      phoneNumberId: input.phoneNumberId,
      workspaceId: input.workspaceId,
    });
    if (claim.disposition === "already_released") return;
    if (claim.disposition === "blocked_active_campaign") {
      throw new NumberProductError("PHONE_NUMBER_IN_ACTIVE_CAMPAIGN");
    }
    if (claim.disposition !== "claimed" || !claim.providerNumberId) {
      throw this.productFailure();
    }
    this.assertOperationCorrelation(claim.operationId, requestedOperationId);

    let releasedProviderId: string | null = null;
    try {
      const released = await this.provider.releaseNumber({
        workspaceId: input.workspaceId,
        providerNumberId: claim.providerNumberId,
        idempotencyKey: claim.operationId,
      });
      releasedProviderId = released.providerNumberId;
      if (releasedProviderId !== claim.providerNumberId) {
        throw new PersistenceAfterSideEffectError(
          "releaseNumber",
          releasedProviderId,
        );
      }
      const completed = await this.repository.completeNumberRelease({
        operationId: claim.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      if (!completed) {
        throw new PersistenceAfterSideEffectError(
          "releaseNumber",
          releasedProviderId,
        );
      }
      await this.report({
        event: "number_release_completed",
        workspaceId: input.workspaceId,
        phoneNumberId: input.phoneNumberId,
        operationId: claim.operationId,
        failure: null,
      });
    } catch (error) {
      const failure = providerFailure(
        error,
        "releaseNumber",
        releasedProviderId ?? claim.providerNumberId,
      );
      await this.markUnknown(() =>
        this.repository.markNumberReleaseUnknown({
          failure: storedFailure(failure),
          operationId: claim.operationId,
          phoneNumberId: input.phoneNumberId,
          workspaceId: input.workspaceId,
        }),
      );
      await this.report({
        event: "number_release_reconciliation_required",
        workspaceId: input.workspaceId,
        phoneNumberId: input.phoneNumberId,
        operationId: claim.operationId,
        failure,
      });
      throw toProductMessagingError(error, "releaseNumber");
    }
  }

  private async ensureWorkspaceMessaging(workspaceId: string): Promise<void> {
    const requestedOperationId = this.operationId();
    const claim = await this.repository.claimWorkspaceSetup({
      operationId: requestedOperationId,
      workspaceId,
    });
    if (claim.disposition === "ready") return;
    if (claim.disposition !== "claimed") throw this.productFailure();
    this.assertOperationCorrelation(claim.operationId, requestedOperationId);

    let step: "account" | "service" = "account";
    let providerResourceId: string | null = null;
    try {
      const account = await this.setupProvider.createWorkspaceAccount({
        workspaceId,
        displayName: `Riink workspace ${workspaceId}`,
      });
      providerResourceId = account.accountId;
      const encryptedCredential = this.options.credentialVault.encrypt(
        account.credential,
        `workspace:${workspaceId}:messaging-auth-token`,
      );
      const accountRecorded = await this.repository.recordWorkspaceAccount({
        encryptedCredential,
        operationId: claim.operationId,
        providerAccountId: account.accountId,
        providerName: this.options.providerName,
        workspaceId,
      });
      if (!accountRecorded) {
        throw new PersistenceAfterSideEffectError(
          "createWorkspaceAccount",
          account.accountId,
        );
      }

      step = "service";
      const service = await this.setupProvider.createMessagingService({
        workspaceId,
        account: {
          accountId: account.accountId,
          credential: account.credential,
        },
        displayName: `Riink messaging ${workspaceId}`,
        inboundWebhookUrl: `${this.origin}/api/webhooks/sms`,
      });
      providerResourceId = service.serviceId;
      const completed = await this.repository.completeWorkspaceSetup({
        messagingServiceId: service.serviceId,
        operationId: claim.operationId,
        workspaceId,
      });
      if (!completed) {
        throw new PersistenceAfterSideEffectError(
          "createMessagingService",
          service.serviceId,
        );
      }
      await this.report({
        event: "workspace_setup_completed",
        workspaceId,
        phoneNumberId: null,
        operationId: claim.operationId,
        failure: null,
      });
    } catch (error) {
      const operation =
        step === "account"
          ? ("createWorkspaceAccount" as const)
          : ("createMessagingService" as const);
      const failure = providerFailure(error, operation, providerResourceId);
      await this.markUnknown(() =>
        this.repository.markWorkspaceSetupUnknown({
          failure: storedFailure(failure),
          operationId: claim.operationId,
          step,
          workspaceId,
        }),
      );
      await this.report({
        event: "workspace_setup_reconciliation_required",
        workspaceId,
        phoneNumberId: null,
        operationId: claim.operationId,
        failure,
      });
      throw this.productFailure();
    }
  }

  private async purchaseClaimedNumber(
    workspaceId: string,
    operationId: string,
    phoneNumberId: string,
    selection: VerifiedNumberSelection,
  ): Promise<StartNumberOnboardingResult> {
    let purchasedProviderId: string | null = null;
    try {
      const purchased = await this.provider.purchaseNumber({
        workspaceId,
        providerNumberId: selection.providerNumberId,
        phoneNumber: selection.phoneNumber,
        idempotencyKey: operationId,
        inboundWebhookUrl: `${this.origin}/api/webhooks/sms`,
        statusCallbackUrl: `${this.origin}/api/webhooks/sms`,
      });
      purchasedProviderId = purchased.providerNumberId;
      if (purchased.phoneNumber !== selection.phoneNumber) {
        throw new PersistenceAfterSideEffectError(
          "purchaseNumber",
          purchasedProviderId,
        );
      }
      const completion = await this.repository.completeNumberPurchase({
        operationId,
        providerName: this.options.providerName,
        providerNumberId: purchasedProviderId,
        providerStatus: purchased.state,
        workspaceId,
      });
      if (!completion.completed || completion.phoneNumberId !== phoneNumberId) {
        throw new PersistenceAfterSideEffectError(
          "purchaseNumber",
          purchasedProviderId,
        );
      }
      await this.report({
        event: "number_purchase_completed",
        workspaceId,
        phoneNumberId,
        operationId,
        failure: null,
      });
      return { phoneNumberId, status: "pending" };
    } catch (error) {
      const failure = providerFailure(
        error,
        "purchaseNumber",
        purchasedProviderId,
      );
      await this.markUnknown(() =>
        this.repository.markNumberPurchaseUnknown({
          failure: storedFailure(failure),
          operationId,
          workspaceId,
        }),
      );
      await this.report({
        event: "number_purchase_reconciliation_required",
        workspaceId,
        phoneNumberId,
        operationId,
        failure,
      });
      throw toProductMessagingError(error, "purchaseNumber");
    }
  }

  private assertOperationCorrelation(
    actualOperationId: string,
    expectedOperationId: string,
  ): void {
    if (actualOperationId !== expectedOperationId) throw this.productFailure();
  }

  private productFailure(): ProductMessagingError {
    return new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
  }

  private async markUnknown(action: () => Promise<boolean>): Promise<void> {
    try {
      await action();
    } catch {
      // The original durable claim remains in progress and therefore fail-closed.
    }
  }

  private async report(
    event: Omit<NumberProvisioningInternalEvent, "occurredAt">,
  ): Promise<void> {
    if (!this.options.reportInternalEvent) return;
    try {
      await this.options.reportInternalEvent({
        ...event,
        occurredAt: this.now().toISOString(),
      });
    } catch {
      // Observability cannot change setup state or product behavior.
    }
  }
}
