import {
  getProviderFailureDetails,
  ProviderOperationError,
  type ProviderFailureDetails,
} from "../messaging/errors";
import type { SmsProvider } from "../messaging/provider";
import type { SendMessageResult } from "../messaging/types";
import { correlationLogFields, writeDispatchLog } from "./logging";
import type { DispatchRepository } from "./repository";
import type {
  DispatchClaim,
  DispatchLogger,
  DispatchRunResult,
  DispatchUnknownReason,
} from "./types";

export interface DispatchWorkerOptions {
  workerId: string;
  now?: () => Date;
  logger?: DispatchLogger;
}

export class DispatchTransitionPersistenceError extends Error {
  constructor(readonly messageId: string) {
    super("A terminal dispatch transition could not be persisted.");
    this.name = "DispatchTransitionPersistenceError";
  }
}

function validAcceptedResult(result: SendMessageResult): boolean {
  return (
    result.status === "accepted" &&
    typeof result.providerMessageId === "string" &&
    result.providerMessageId.trim().length > 0 &&
    typeof result.acceptedAt === "string" &&
    Number.isFinite(Date.parse(result.acceptedAt))
  );
}

function isKnownPreAcceptFailure(error: unknown): error is ProviderOperationError {
  return (
    error instanceof ProviderOperationError &&
    error.details.operation === "sendMessage" &&
    error.details.kind !== "ambiguous_result"
  );
}

/** Dispatches at most one claimed message and never retries a provider call. */
export class DispatchWorker {
  private readonly now: () => Date;

  constructor(
    private readonly repository: DispatchRepository,
    private readonly provider: SmsProvider,
    private readonly options: DispatchWorkerOptions,
  ) {
    if (!options.workerId.trim()) throw new RangeError("Worker ID is required.");
    this.now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<DispatchRunResult> {
    const claim = await this.repository.claimAndReserveNext({
      workerId: this.options.workerId,
      now: this.timestamp(),
    });
    if (!claim) return { outcome: "idle" };

    await this.log(claim, {
      event: "dispatch_claimed",
      dispatch_state: "reserved",
      provider_message_id: null,
    });

    const validation = await this.repository.finalValidateAndBeginProviderAttempt({
      claim,
      now: this.timestamp(),
    });
    if (!validation.ok) {
      await this.log(claim, {
        event: "dispatch_validation_rejected",
        dispatch_state: "failed",
        provider_message_id: null,
        validation_reason: validation.reason,
      });
      return {
        outcome: "blocked",
        messageId: claim.messageId,
        reason: validation.reason,
      };
    }

    await this.log(claim, {
      event: "provider_send_started",
      dispatch_state: "reserved",
      provider_message_id: null,
    });

    let result: SendMessageResult;
    try {
      result = await this.provider.sendMessage(validation.sendInput);
    } catch (error) {
      if (isKnownPreAcceptFailure(error)) {
        return this.persistKnownFailure(claim, error.details);
      }
      return this.persistUnknown(
        claim,
        "provider_result_ambiguous",
        error instanceof ProviderOperationError
          ? error.details.providerResourceId
          : null,
        getProviderFailureDetails(error, "sendMessage"),
      );
    }

    if (!validAcceptedResult(result)) {
      return this.persistUnknown(
        claim,
        "provider_result_ambiguous",
        result.providerMessageId || null,
        null,
      );
    }

    try {
      await this.repository.markAccepted({
        claim,
        result,
        persistedAt: this.timestamp(),
      });
    } catch {
      await this.log(claim, {
        event: "dispatch_transition_persistence_failed",
        dispatch_state: "dispatch_unknown",
        provider_message_id: result.providerMessageId,
        unknown_reason: "post_provider_persistence_failed",
      });
      return this.persistUnknown(
        claim,
        "post_provider_persistence_failed",
        result.providerMessageId,
        null,
      );
    }

    await this.log(claim, {
      event: "provider_send_accepted",
      dispatch_state: "accepted",
      provider_message_id: result.providerMessageId,
    });
    return {
      outcome: "accepted",
      messageId: claim.messageId,
      providerMessageId: result.providerMessageId,
    };
  }

  private async persistKnownFailure(
    claim: DispatchClaim,
    failure: ProviderFailureDetails,
  ): Promise<DispatchRunResult> {
    try {
      await this.repository.markKnownFailureAndRelease({
        claim,
        failure,
        failedAt: this.timestamp(),
      });
    } catch {
      await this.log(claim, {
        event: "dispatch_transition_persistence_failed",
        dispatch_state: "dispatch_unknown",
        provider_message_id: failure.providerResourceId,
        unknown_reason: "post_provider_persistence_failed",
        provider_failure_kind: failure.kind,
        provider_code: failure.providerCode,
      });
      return this.persistUnknown(
        claim,
        "post_provider_persistence_failed",
        failure.providerResourceId,
        failure,
      );
    }

    await this.log(claim, {
      event: "provider_send_known_failed",
      dispatch_state: "failed",
      provider_message_id: failure.providerResourceId,
      provider_failure_kind: failure.kind,
      provider_code: failure.providerCode,
    });
    return {
      outcome: "known_failed",
      messageId: claim.messageId,
      failureKind: failure.kind,
    };
  }

  private async persistUnknown(
    claim: DispatchClaim,
    reason: DispatchUnknownReason,
    providerMessageId: string | null,
    failure: ProviderFailureDetails | null,
  ): Promise<DispatchRunResult> {
    try {
      await this.repository.markDispatchUnknownAndStop({
        claim,
        reason,
        providerMessageId,
        failure,
        markedAt: this.timestamp(),
      });
    } catch {
      await this.log(claim, {
        event: "dispatch_transition_persistence_failed",
        dispatch_state: "dispatch_unknown",
        provider_message_id: providerMessageId,
        unknown_reason: reason,
        provider_failure_kind: failure?.kind,
        provider_code: failure?.providerCode,
      });
      // The repository contract has already durably fenced this provider
      // attempt during final validation, so throwing cannot permit a resend.
      throw new DispatchTransitionPersistenceError(claim.messageId);
    }

    await this.log(claim, {
      event: "dispatch_unknown",
      dispatch_state: "dispatch_unknown",
      provider_message_id: providerMessageId,
      unknown_reason: reason,
      provider_failure_kind: failure?.kind,
      provider_code: failure?.providerCode,
    });
    return {
      outcome: "dispatch_unknown",
      messageId: claim.messageId,
      reason,
    };
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private log(
    claim: DispatchClaim,
    fields: Omit<
      Parameters<typeof writeDispatchLog>[1],
      | "workspace_id"
      | "campaign_id"
      | "campaign_recipient_id"
      | "contact_id"
      | "message_id"
      | "timestamp"
    >,
  ): Promise<void> {
    return writeDispatchLog(this.options.logger, {
      ...correlationLogFields(claim),
      ...fields,
      timestamp: this.timestamp(),
    });
  }
}
