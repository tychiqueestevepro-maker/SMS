import type { SmsProvider } from "../messaging/provider";
import { SimulatedMessagingProvider } from "../providers/simulated/provider";
import type {
  CompleteReconciliationInput,
  DeferReconciliationInput,
  DispatchRepository,
  FinalValidateDispatchInput,
  MarkAcceptedInput,
  MarkDispatchUnknownInput,
  MarkKnownFailureInput,
  RecordReconciledDeliveryStateInput,
  RecordReconciledProviderCostInput,
} from "./repository";
import type {
  DispatchClaim,
  FinalDispatchValidationSnapshot,
  FinalValidationResult,
  ReconciliationClaim,
} from "./types";
import { finalValidationFailure } from "./validation";

export const FIXED_NOW = new Date("2026-08-10T12:00:00.000Z");

export function dispatchClaim(
  overrides: Partial<DispatchClaim> = {},
): DispatchClaim {
  return {
    workspaceId: "workspace-1",
    campaignId: "campaign-1",
    campaignRecipientId: "recipient-1",
    contactId: "contact-1",
    messageId: "message-1",
    claimToken: "claim-1",
    reservationId: "reservation-1",
    estimatedSegments: 1,
    ...overrides,
  };
}

export function validFinalSnapshot(
  overrides: Partial<FinalDispatchValidationSnapshot> = {},
): FinalDispatchValidationSnapshot {
  return {
    campaignActive: true,
    recipientActive: true,
    contactActive: true,
    suppressed: false,
    workspaceAuthorized: true,
    phoneNumberReady: true,
    reservationValid: true,
    actualOutboundSegments: 100,
    reservedOutboundSegments: 1,
    safetyCapSegments: 10_000,
    ...overrides,
  };
}

export function reconciliationClaim(
  overrides: Partial<ReconciliationClaim> = {},
): ReconciliationClaim {
  return {
    workspaceId: "workspace-1",
    campaignId: "campaign-1",
    campaignRecipientId: "recipient-1",
    contactId: "contact-1",
    messageId: "message-1",
    reconciliationToken: "reconcile-1",
    reservationId: "reservation-1",
    providerMessageId: "sim-message-000001",
    billingPeriodId: "period-july",
    usagePosition: 42,
    ...overrides,
  };
}

export class MemoryDispatchRepository implements DispatchRepository {
  readonly accepted: MarkAcceptedInput[] = [];
  readonly knownFailures: MarkKnownFailureInput[] = [];
  readonly unknown: MarkDispatchUnknownInput[] = [];
  readonly validationReleases: string[] = [];
  readonly completedReconciliations: CompleteReconciliationInput[] = [];
  readonly deferredReconciliations: DeferReconciliationInput[] = [];
  readonly begunProviderAttempts: string[] = [];
  readonly reconciledDeliveryStates: RecordReconciledDeliveryStateInput[] = [];
  readonly reconciledProviderCosts: RecordReconciledProviderCostInput[] = [];
  readonly dispatchClaims: DispatchClaim[];
  readonly reconciliationClaims: ReconciliationClaim[];
  validationSnapshot = validFinalSnapshot();
  failMarkAccepted = false;
  failMarkKnownFailure = false;
  failMarkUnknown = false;

  constructor(options: {
    dispatchClaims?: DispatchClaim[];
    reconciliationClaims?: ReconciliationClaim[];
  } = {}) {
    this.dispatchClaims = [...(options.dispatchClaims ?? [])];
    this.reconciliationClaims = [...(options.reconciliationClaims ?? [])];
  }

  async claimAndReserveNext(): Promise<DispatchClaim | null> {
    return this.dispatchClaims.shift() ?? null;
  }

  async finalValidateAndBeginProviderAttempt(
    input: FinalValidateDispatchInput,
  ): Promise<FinalValidationResult> {
    const reason = finalValidationFailure(this.validationSnapshot);
    if (reason) {
      this.validationReleases.push(input.claim.reservationId);
      return {
        ok: false,
        reason,
        reservationReleased: true,
        recipientStopped:
          reason === "campaign_inactive" ||
          reason === "recipient_inactive" ||
          reason === "contact_inactive" ||
          reason === "suppressed",
      };
    }
    this.begunProviderAttempts.push(input.claim.messageId);
    return {
      ok: true,
      sendInput: {
        workspaceId: input.claim.workspaceId,
        messageId: input.claim.messageId,
        from: "+12025550101",
        to: "+12025550199",
        body: "Hello from Riink",
        idempotencyKey: `dispatch:${input.claim.messageId}`,
      },
    };
  }

  async markAccepted(input: MarkAcceptedInput): Promise<void> {
    if (this.failMarkAccepted) throw new Error("database unavailable");
    this.accepted.push(input);
  }

  async markKnownFailureAndRelease(
    input: MarkKnownFailureInput,
  ): Promise<void> {
    if (this.failMarkKnownFailure) throw new Error("database unavailable");
    this.knownFailures.push(input);
  }

  async markDispatchUnknownAndStop(
    input: MarkDispatchUnknownInput,
  ): Promise<void> {
    if (this.failMarkUnknown) throw new Error("database unavailable");
    this.unknown.push(input);
  }

  async claimNextReconciliation(): Promise<ReconciliationClaim | null> {
    return this.reconciliationClaims.shift() ?? null;
  }

  async completeReconciliation(
    input: CompleteReconciliationInput,
  ): Promise<void> {
    this.completedReconciliations.push(input);
  }

  async recordReconciledDeliveryState(
    input: RecordReconciledDeliveryStateInput,
  ): Promise<void> {
    this.reconciledDeliveryStates.push(input);
  }

  async recordReconciledProviderCost(
    input: RecordReconciledProviderCostInput,
  ): Promise<void> {
    this.reconciledProviderCosts.push(input);
  }

  async deferReconciliation(input: DeferReconciliationInput): Promise<void> {
    this.deferredReconciliations.push(input);
  }
}

export function successfulProvider(): SmsProvider {
  return new SimulatedMessagingProvider({ now: () => FIXED_NOW });
}
