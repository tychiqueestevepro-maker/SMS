import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderFailureDetails } from "../messaging/errors";
import type { DispatchRepository } from "./repository";
import type {
  DispatchClaim,
  FinalValidationFailureReason,
  FinalValidationResult,
  ReconciliationClaim,
} from "./types";

type UnknownRow = Record<string, unknown>;

export interface SupabaseDispatchRepositoryOptions {
  /** Internal adapter label persisted only in private operational tables. */
  providerName: string;
  statusCallbackUrl?: string;
}

export class DispatchRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Messaging persistence is temporarily unavailable.");
    this.name = "DispatchRepositoryError";
  }
}

function asRow(value: unknown): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as UnknownRow)
    : null;
}

function requiredString(row: UnknownRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DispatchRepositoryError("invalid_rpc_response");
  }
  return value;
}

function nullableString(row: UnknownRow, key: string): string | null {
  return row[key] === null ? null : requiredString(row, key);
}

function safeInteger(row: UnknownRow, key: string, positive = false): number {
  const value = row[key];
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < (positive ? 1 : 0)
  ) {
    throw new DispatchRepositoryError("invalid_rpc_response");
  }
  return parsed;
}

function rpcFailure(operation: string): DispatchRepositoryError {
  return new DispatchRepositoryError(operation);
}

function mapValidationReason(code: unknown): FinalValidationFailureReason {
  switch (code) {
    case "campaign_unavailable":
    case "campaign_paused":
      return "campaign_inactive";
    case "recipient_stopped":
      return "recipient_inactive";
    case "contact_unavailable":
      return "contact_inactive";
    case "contact_opted_out":
      return "suppressed";
    case "messaging_unavailable":
      return "workspace_unauthorized";
    case "phone_number_not_ready":
      return "phone_number_not_ready";
    case "outside_send_window":
      return "outside_send_window";
    case "usage_safety_cap_reached":
      return "safety_cap_reached";
    default:
      return "reservation_invalid";
  }
}

function stoppedByValidation(code: unknown): boolean {
  return (
    code === "campaign_unavailable" ||
    code === "recipient_stopped" ||
    code === "contact_unavailable" ||
    code === "contact_opted_out"
  );
}

function releasedByValidation(code: unknown): boolean {
  return (
    code !== "message_not_found" &&
    code !== "dispatch_already_started" &&
    code !== "reservation_not_valid"
  );
}

function rawFailureFields(failure: ProviderFailureDetails | null) {
  return {
    p_provider_error_code: failure?.providerCode ?? null,
    p_provider_error_message: failure?.providerMessage ?? null,
  };
}

/**
 * Service-role implementation of the dispatch persistence boundary.
 *
 * Every mutation calls one SECURITY DEFINER RPC. The public wrappers are
 * executable only by `service_role`; workspace sessions cannot claim work or
 * inspect the provider details accepted by these methods.
 */
export class SupabaseDispatchRepository implements DispatchRepository {
  private readonly providerName: string;

  constructor(
    private readonly client: SupabaseClient,
    private readonly options: SupabaseDispatchRepositoryOptions,
  ) {
    this.providerName = options.providerName.trim();
    if (!this.providerName) throw new RangeError("Provider name is required.");
  }

  async claimAndReserveNext(input: {
    workerId: string;
    now: string;
  }): Promise<DispatchClaim | null> {
    const { data, error } = await this.client.rpc(
      "dispatch_claim_and_reserve_next",
      { p_worker_id: input.workerId, p_now: input.now },
    );
    if (error) throw rpcFailure("claim_and_reserve");
    const row = asRow(data);
    if (!row) return null;

    return {
      campaignId: requiredString(row, "campaign_id"),
      campaignRecipientId: requiredString(row, "campaign_recipient_id"),
      claimToken: requiredString(row, "claim_token"),
      contactId: requiredString(row, "contact_id"),
      estimatedSegments: safeInteger(row, "estimated_segments", true),
      messageId: requiredString(row, "message_id"),
      reservationId: requiredString(row, "reservation_id"),
      workspaceId: requiredString(row, "workspace_id"),
    };
  }

  async finalValidateAndBeginProviderAttempt(input: {
    claim: DispatchClaim;
    now: string;
  }): Promise<FinalValidationResult> {
    const { data, error } = await this.client.rpc(
      "dispatch_final_validate_and_begin_attempt",
      {
        p_claim_token: input.claim.claimToken,
        p_message_id: input.claim.messageId,
        p_now: input.now,
      },
    );
    if (error) throw rpcFailure("final_validate");
    const row = asRow(data);
    if (!row || typeof row.authorized !== "boolean") {
      throw rpcFailure("invalid_rpc_response");
    }

    if (!row.authorized) {
      return {
        ok: false,
        reason: mapValidationReason(row.code),
        recipientStopped: stoppedByValidation(row.code),
        reservationReleased: releasedByValidation(row.code),
      };
    }

    const returnedCorrelation = {
      campaignId: requiredString(row, "campaign_id"),
      campaignRecipientId: requiredString(row, "campaign_recipient_id"),
      contactId: requiredString(row, "contact_id"),
      messageId: requiredString(row, "message_id"),
      workspaceId: requiredString(row, "workspace_id"),
    };
    if (
      returnedCorrelation.campaignId !== input.claim.campaignId ||
      returnedCorrelation.campaignRecipientId !==
        input.claim.campaignRecipientId ||
      returnedCorrelation.contactId !== input.claim.contactId ||
      returnedCorrelation.messageId !== input.claim.messageId ||
      returnedCorrelation.workspaceId !== input.claim.workspaceId
    ) {
      throw rpcFailure("correlation_mismatch");
    }

    return {
      ok: true,
      sendInput: {
        body: requiredString(row, "body"),
        from: requiredString(row, "from"),
        idempotencyKey: input.claim.claimToken,
        messageId: input.claim.messageId,
        ...(this.options.statusCallbackUrl
          ? { statusCallbackUrl: this.options.statusCallbackUrl }
          : {}),
        to: requiredString(row, "to"),
        workspaceId: input.claim.workspaceId,
      },
    };
  }

  async markAccepted(input: Parameters<DispatchRepository["markAccepted"]>[0]) {
    const { error } = await this.client.rpc("dispatch_mark_accepted", {
      p_accepted_at: input.result.acceptedAt,
      p_claim_token: input.claim.claimToken,
      p_message_id: input.claim.messageId,
      p_provider: this.providerName,
      p_provider_message_id: input.result.providerMessageId,
    });
    if (error) throw rpcFailure("mark_accepted");
  }

  async markKnownFailureAndRelease(
    input: Parameters<DispatchRepository["markKnownFailureAndRelease"]>[0],
  ) {
    const { error } = await this.client.rpc(
      "dispatch_mark_known_failure_and_release",
      {
        p_claim_token: input.claim.claimToken,
        p_failed_at: input.failedAt,
        p_message_id: input.claim.messageId,
        p_provider: this.providerName,
        p_provider_message_id: input.failure.providerResourceId,
        ...rawFailureFields(input.failure),
      },
    );
    if (error) throw rpcFailure("mark_known_failure");
  }

  async markDispatchUnknownAndStop(
    input: Parameters<DispatchRepository["markDispatchUnknownAndStop"]>[0],
  ) {
    const { error } = await this.client.rpc(
      "dispatch_mark_unknown_and_stop",
      {
        p_claim_token: input.claim.claimToken,
        p_message_id: input.claim.messageId,
        p_provider: this.providerName,
        p_provider_message_id: input.providerMessageId,
        p_unknown_reason: input.reason,
        ...rawFailureFields(input.failure),
      },
    );
    if (error) throw rpcFailure("mark_dispatch_unknown");
  }

  async claimNextReconciliation(input: {
    workerId: string;
    now: string;
  }): Promise<ReconciliationClaim | null> {
    const { data, error } = await this.client.rpc("reconciliation_claim_next", {
      p_now: input.now,
      p_worker_id: input.workerId,
    });
    if (error) throw rpcFailure("claim_reconciliation");
    const row = asRow(data);
    if (!row) return null;

    return {
      billingPeriodId: requiredString(row, "billing_period_id"),
      campaignId: nullableString(row, "campaign_id"),
      campaignRecipientId: nullableString(row, "campaign_recipient_id"),
      contactId: requiredString(row, "contact_id"),
      messageId: requiredString(row, "message_id"),
      providerMessageId: requiredString(row, "provider_message_id"),
      reconciliationToken: requiredString(row, "reconciliation_token"),
      reservationId: requiredString(row, "reservation_id"),
      usagePosition: safeInteger(row, "usage_position", true),
      workspaceId: requiredString(row, "workspace_id"),
    };
  }

  async completeReconciliation(
    input: Parameters<DispatchRepository["completeReconciliation"]>[0],
  ) {
    const { error } = await this.client.rpc("reconciliation_complete", {
      p_actual_segments: input.actualSegments,
      p_message_id: input.claim.messageId,
      p_provider_cost_micro_usd: input.providerCostMicroUsd,
      p_provider_cost_pending: input.providerCostPending,
      p_reconciled_at: input.reconciledAt,
      p_reconciliation_token: input.claim.reconciliationToken,
    });
    if (error) throw rpcFailure("complete_reconciliation");
  }

  async recordReconciledDeliveryState(
    input: Parameters<DispatchRepository["recordReconciledDeliveryState"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "reconciliation_record_delivery_state",
      {
        p_delivery_state: input.deliveryState,
        p_message_id: input.claim.messageId,
        p_observed_at: input.observedAt,
        p_reconciliation_token: input.claim.reconciliationToken,
      },
    );
    if (error) throw rpcFailure("record_reconciled_delivery_state");
  }

  async recordReconciledProviderCost(
    input: Parameters<DispatchRepository["recordReconciledProviderCost"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "reconciliation_record_provider_cost",
      {
        p_message_id: input.claim.messageId,
        p_observed_at: input.observedAt,
        p_provider_cost_micro_usd: input.providerCostMicroUsd,
        p_provider_cost_pending: input.providerCostPending,
        p_reconciliation_token: input.claim.reconciliationToken,
      },
    );
    if (error) throw rpcFailure("record_reconciled_provider_cost");
  }

  async deferReconciliation(
    input: Parameters<DispatchRepository["deferReconciliation"]>[0],
  ) {
    const { error } = await this.client.rpc("reconciliation_defer", {
      p_deferred_at: input.deferredAt,
      p_message_id: input.claim.messageId,
      p_next_attempt_at: null,
      p_reason: input.reason,
      p_reconciliation_token: input.claim.reconciliationToken,
    });
    if (error) throw rpcFailure("defer_reconciliation");
  }
}
