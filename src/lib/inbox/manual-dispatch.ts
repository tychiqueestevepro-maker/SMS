import {
  getProviderFailureDetails,
  ProviderOperationError,
  type ProviderFailureDetails,
} from "../messaging/errors";
import type { SmsProvider } from "../messaging/provider";
import type { SendMessageInput, SendMessageResult } from "../messaging/types";
import { estimateSmsCredits } from "../messaging/credits";
import { writeDispatchLog } from "../dispatch/logging";
import type {
  DispatchLogger,
  FinalValidationFailureReason,
} from "../dispatch/types";
import { InboxProductError } from "./errors";

export type ManualDispatchState =
  | "reserved"
  | "accepted"
  | "failed"
  | "dispatch_unknown";

export interface ManualDispatchClaim {
  claimToken: string;
  contactId: string;
  dispatchState: ManualDispatchState;
  disposition: "claimed" | "already_claimed";
  estimatedSegments: number;
  messageId: string;
  reservationId: string;
  workspaceId: string;
}

export type ManualFinalValidationResult =
  | { authorized: true; sendInput: SendMessageInput }
  | {
      authorized: false;
      code:
        | "contact_unavailable"
        | "contact_opted_out"
        | "messaging_unavailable"
        | "phone_number_not_ready"
        | "reservation_invalid"
        | "usage_safety_cap_reached";
    };

export interface ManualDispatchRepository {
  claimAndReserve(input: {
    body: string;
    contactId: string;
    estimatedSegments: number;
    now: string;
    phoneNumberId: string;
    requestId: string;
    workspaceId: string;
  }): Promise<ManualDispatchClaim>;
  finalValidateAndBeginProviderAttempt(input: {
    claim: ManualDispatchClaim;
    now: string;
  }): Promise<ManualFinalValidationResult>;
  markAccepted(input: {
    claim: ManualDispatchClaim;
    persistedAt: string;
    result: SendMessageResult;
  }): Promise<void>;
  markKnownFailureAndRelease(input: {
    claim: ManualDispatchClaim;
    failedAt: string;
    failure: ProviderFailureDetails;
  }): Promise<void>;
  markDispatchUnknown(input: {
    claim: ManualDispatchClaim;
    failure: ProviderFailureDetails | null;
    markedAt: string;
    providerMessageId: string | null;
    reason: "provider_result_ambiguous" | "post_provider_persistence_failed";
  }): Promise<void>;
}

export interface ManualMessageSenderOptions {
  now?: () => Date;
  logger?: DispatchLogger;
}

function acceptedResult(result: SendMessageResult): boolean {
  return (
    result.status === "accepted" &&
    Boolean(result.providerMessageId.trim()) &&
    Number.isFinite(Date.parse(result.acceptedAt))
  );
}

function knownPreAcceptFailure(error: unknown): error is ProviderOperationError {
  return (
    error instanceof ProviderOperationError &&
    error.details.operation === "sendMessage" &&
    error.details.kind !== "ambiguous_result"
  );
}

function productFailureForProvider(
  failure: ProviderFailureDetails,
  canRetryWithNewRequest: boolean,
) {
  const options = { canRetryWithNewRequest };
  if (failure.kind === "number_not_ready") {
    return new InboxProductError("PHONE_NUMBER_NOT_READY", options);
  }
  if (
    failure.kind === "invalid_recipient" ||
    failure.kind === "recipient_unreachable"
  ) {
    return new InboxProductError("CONTACT_CANNOT_RECEIVE_MESSAGES", options);
  }
  return new InboxProductError("MESSAGE_SEND_FAILED", options);
}

function productFailureForValidation(
  code: Extract<ManualFinalValidationResult, { authorized: false }>["code"],
) {
  if (code === "contact_unavailable") {
    return new InboxProductError("CONTACT_NOT_AVAILABLE", {
      canRetryWithNewRequest: true,
    });
  }
  if (code === "contact_opted_out") {
    return new InboxProductError("CONTACT_CANNOT_RECEIVE_MESSAGES", {
      canRetryWithNewRequest: true,
    });
  }
  if (code === "phone_number_not_ready") {
    return new InboxProductError("PHONE_NUMBER_NOT_READY", {
      canRetryWithNewRequest: true,
    });
  }
  return new InboxProductError("MESSAGE_SEND_FAILED", {
    canRetryWithNewRequest: true,
  });
}

function validationReason(
  code: Extract<ManualFinalValidationResult, { authorized: false }>["code"],
): FinalValidationFailureReason {
  if (code === "contact_unavailable") return "contact_inactive";
  if (code === "contact_opted_out") return "suppressed";
  if (code === "messaging_unavailable") return "workspace_unauthorized";
  if (code === "phone_number_not_ready") return "phone_number_not_ready";
  if (code === "usage_safety_cap_reached") return "safety_cap_reached";
  return "reservation_invalid";
}

/** Sends one manual message through the same fail-closed discipline as campaigns. */
export class ManualMessageSender {
  private readonly now: () => Date;
  private readonly logger: DispatchLogger | undefined;

  constructor(
    private readonly repository: ManualDispatchRepository,
    private readonly provider: SmsProvider,
    options: ManualMessageSenderOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger;
  }

  async send(input: {
    body: string;
    contactId: string;
    phoneNumberId: string;
    requestId: string;
    workspaceId: string;
  }): Promise<{ messageId: string }> {
    const body = input.body.trim();
    if (!body || body.length > 1_600) {
      throw new InboxProductError(body ? "MESSAGE_SEND_FAILED" : "MESSAGE_REQUIRED");
    }
    const estimatedSegments = Math.max(1, estimateSmsCredits(body));
    const claim = await this.repository.claimAndReserve({
      ...input,
      body,
      estimatedSegments,
      now: this.timestamp(),
    });
    this.assertClaimCorrelation(claim, input);

    await this.log(claim, {
      dispatch_state: claim.dispatchState,
      event: "dispatch_claimed",
      provider_message_id: null,
    });

    if (claim.disposition === "already_claimed") {
      if (claim.dispatchState === "accepted") {
        return { messageId: claim.messageId };
      }
      if (claim.dispatchState === "failed") {
        throw new InboxProductError("MESSAGE_SEND_FAILED", {
          canRetryWithNewRequest: true,
        });
      }
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }
    if (claim.dispatchState !== "reserved") {
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }

    const validation = await this.repository.finalValidateAndBeginProviderAttempt({
      claim,
      now: this.timestamp(),
    });
    if (!validation.authorized) {
      await this.log(claim, {
        dispatch_state: "failed",
        event: "dispatch_validation_rejected",
        provider_message_id: null,
        validation_reason: validationReason(validation.code),
      });
      throw productFailureForValidation(validation.code);
    }

    await this.log(claim, {
      dispatch_state: "reserved",
      event: "provider_send_started",
      provider_message_id: null,
    });

    let result: SendMessageResult;
    try {
      result = await this.provider.sendMessage(validation.sendInput);
    } catch (error) {
      if (knownPreAcceptFailure(error)) {
        return this.persistKnownFailure(claim, error.details);
      }
      await this.persistUnknown(
        claim,
        "provider_result_ambiguous",
        error instanceof ProviderOperationError
          ? error.details.providerResourceId
          : null,
        getProviderFailureDetails(error, "sendMessage"),
      );
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }

    if (!acceptedResult(result)) {
      await this.persistUnknown(
        claim,
        "provider_result_ambiguous",
        result.providerMessageId || null,
        null,
      );
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }

    try {
      await this.repository.markAccepted({
        claim,
        result,
        persistedAt: this.timestamp(),
      });
    } catch {
      await this.log(claim, {
        dispatch_state: "dispatch_unknown",
        event: "dispatch_transition_persistence_failed",
        provider_message_id: result.providerMessageId,
        unknown_reason: "post_provider_persistence_failed",
      });
      await this.persistUnknown(
        claim,
        "post_provider_persistence_failed",
        result.providerMessageId,
        null,
      );
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }
    await this.log(claim, {
      dispatch_state: "accepted",
      event: "provider_send_accepted",
      provider_message_id: result.providerMessageId,
    });
    return { messageId: claim.messageId };
  }

  private async persistKnownFailure(
    claim: ManualDispatchClaim,
    failure: ProviderFailureDetails,
  ): Promise<never> {
    try {
      await this.repository.markKnownFailureAndRelease({
        claim,
        failure,
        failedAt: this.timestamp(),
      });
    } catch {
      await this.persistUnknown(
        claim,
        "post_provider_persistence_failed",
        failure.providerResourceId,
        failure,
      );
      throw productFailureForProvider(failure, false);
    }
    await this.log(claim, {
      dispatch_state: "failed",
      event: "provider_send_known_failed",
      provider_message_id: failure.providerResourceId,
      provider_failure_kind: failure.kind,
      provider_code: failure.providerCode,
    });
    throw productFailureForProvider(failure, failure.retryable);
  }

  private async persistUnknown(
    claim: ManualDispatchClaim,
    reason: "provider_result_ambiguous" | "post_provider_persistence_failed",
    providerMessageId: string | null,
    failure: ProviderFailureDetails | null,
  ): Promise<void> {
    try {
      await this.repository.markDispatchUnknown({
        claim,
        failure,
        markedAt: this.timestamp(),
        providerMessageId,
        reason,
      });
    } catch {
      // finalValidateAndBeginProviderAttempt durably fenced the attempt. Even
      // if this transition fails, this request ID can never issue another send.
    }
    await this.log(claim, {
      dispatch_state: "dispatch_unknown",
      event: "dispatch_unknown",
      provider_message_id: providerMessageId,
      provider_failure_kind: failure?.kind,
      provider_code: failure?.providerCode,
      unknown_reason: reason,
    });
  }

  private assertClaimCorrelation(
    claim: ManualDispatchClaim,
    input: { contactId: string; workspaceId: string },
  ): void {
    if (
      claim.workspaceId !== input.workspaceId ||
      claim.contactId !== input.contactId ||
      claim.estimatedSegments < 1
    ) {
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private log(
    claim: ManualDispatchClaim,
    fields: Omit<
      Parameters<typeof writeDispatchLog>[1],
      | "campaign_id"
      | "campaign_recipient_id"
      | "contact_id"
      | "message_id"
      | "timestamp"
      | "workspace_id"
    >,
  ): Promise<void> {
    return writeDispatchLog(this.logger, {
      campaign_id: null,
      campaign_recipient_id: null,
      contact_id: claim.contactId,
      message_id: claim.messageId,
      timestamp: this.timestamp(),
      workspace_id: claim.workspaceId,
      ...fields,
    });
  }
}
