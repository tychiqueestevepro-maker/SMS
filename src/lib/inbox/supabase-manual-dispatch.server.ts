import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProviderFailureDetails } from "../messaging/errors";
import type {
  ManualDispatchClaim,
  ManualDispatchRepository,
  ManualDispatchState,
  ManualFinalValidationResult,
} from "./manual-dispatch";

type UnknownRow = Record<string, unknown>;

export class ManualDispatchRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Manual message persistence is temporarily unavailable.");
    this.name = "ManualDispatchRepositoryError";
  }
}

function fail(operation: string): never {
  throw new ManualDispatchRepositoryError(operation);
}

function row(value: unknown, operation: string): UnknownRow {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return fail(operation);
  }
  return candidate as UnknownRow;
}

function exactKeys(
  value: UnknownRow,
  expected: readonly string[],
  operation: string,
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (
    actual.length !== allowed.length ||
    actual.some((key, index) => key !== allowed[index])
  ) {
    fail(operation);
  }
}

function string(value: unknown, operation: string): string {
  if (typeof value !== "string" || !value.trim()) return fail(operation);
  return value;
}

function integer(value: unknown, operation: string): number {
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    return fail(operation);
  }
  return parsed;
}

function state(value: unknown, operation: string): ManualDispatchState {
  if (
    value !== "reserved" &&
    value !== "accepted" &&
    value !== "failed" &&
    value !== "dispatch_unknown"
  ) {
    return fail(operation);
  }
  return value;
}

function failureFields(failure: ProviderFailureDetails | null) {
  return {
    p_provider_error_code: failure?.providerCode ?? null,
    p_provider_error_message: failure?.providerMessage ?? null,
  };
}

export class SupabaseManualDispatchRepository
  implements ManualDispatchRepository
{
  private readonly providerName: string;

  constructor(
    private readonly client: SupabaseClient,
    private readonly options: {
      providerName: string;
      statusCallbackUrl?: string;
    },
  ) {
    this.providerName = options.providerName.trim();
    if (!this.providerName) throw new RangeError("Provider name is required.");
  }

  async claimAndReserve(
    input: Parameters<ManualDispatchRepository["claimAndReserve"]>[0],
  ): Promise<ManualDispatchClaim> {
    const operation = "manual_claim_and_reserve";
    const { data, error } = await this.client.rpc(
      "manual_message_claim_and_reserve",
      {
        p_body: input.body,
        p_contact_id: input.contactId,
        p_estimated_segments: input.estimatedSegments,
        p_now: input.now,
        p_phone_number_id: input.phoneNumberId,
        p_request_id: input.requestId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return fail(operation);
    const result = row(data, operation);
    exactKeys(
      result,
      [
        "claim_token",
        "contact_id",
        "dispatch_state",
        "disposition",
        "estimated_segments",
        "message_id",
        "reservation_id",
        "workspace_id",
      ],
      operation,
    );
    if (
      result.disposition !== "claimed" &&
      result.disposition !== "already_claimed"
    ) {
      return fail(operation);
    }
    return {
      claimToken: string(result.claim_token, operation),
      contactId: string(result.contact_id, operation),
      dispatchState: state(result.dispatch_state, operation),
      disposition: result.disposition,
      estimatedSegments: integer(result.estimated_segments, operation),
      messageId: string(result.message_id, operation),
      reservationId: string(result.reservation_id, operation),
      workspaceId: string(result.workspace_id, operation),
    };
  }

  async finalValidateAndBeginProviderAttempt(
    input: Parameters<
      ManualDispatchRepository["finalValidateAndBeginProviderAttempt"]
    >[0],
  ): Promise<ManualFinalValidationResult> {
    const operation = "manual_final_validate";
    const { data, error } = await this.client.rpc(
      "manual_message_final_validate_and_begin_attempt",
      {
        p_claim_token: input.claim.claimToken,
        p_message_id: input.claim.messageId,
        p_now: input.now,
        p_workspace_id: input.claim.workspaceId,
      },
    );
    if (error) return fail(operation);
    const result = row(data, operation);
    if (typeof result.authorized !== "boolean") return fail(operation);
    if (!result.authorized) {
      exactKeys(result, ["authorized", "code"], operation);
      switch (result.code) {
        case "contact_unavailable":
        case "contact_opted_out":
        case "messaging_unavailable":
        case "phone_number_not_ready":
        case "reservation_invalid":
        case "usage_safety_cap_reached":
          return { authorized: false, code: result.code };
        default:
          return fail(operation);
      }
    }

    exactKeys(
      result,
      [
        "authorized",
        "body",
        "contact_id",
        "from",
        "message_id",
        "to",
        "workspace_id",
      ],
      operation,
    );

    const correlation = {
      contactId: string(result.contact_id, operation),
      messageId: string(result.message_id, operation),
      workspaceId: string(result.workspace_id, operation),
    };
    if (
      correlation.contactId !== input.claim.contactId ||
      correlation.messageId !== input.claim.messageId ||
      correlation.workspaceId !== input.claim.workspaceId
    ) {
      return fail("manual_correlation_mismatch");
    }

    return {
      authorized: true,
      sendInput: {
        body: string(result.body, operation),
        from: string(result.from, operation),
        idempotencyKey: input.claim.claimToken,
        messageId: input.claim.messageId,
        ...(this.options.statusCallbackUrl
          ? { statusCallbackUrl: this.options.statusCallbackUrl }
          : {}),
        to: string(result.to, operation),
        workspaceId: input.claim.workspaceId,
      },
    };
  }

  async markAccepted(
    input: Parameters<ManualDispatchRepository["markAccepted"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("manual_message_mark_accepted", {
      p_accepted_at: input.result.acceptedAt,
      p_claim_token: input.claim.claimToken,
      p_message_id: input.claim.messageId,
      p_persisted_at: input.persistedAt,
      p_provider: this.providerName,
      p_provider_message_id: input.result.providerMessageId,
    });
    if (error) return fail("manual_mark_accepted");
  }

  async markKnownFailureAndRelease(
    input: Parameters<
      ManualDispatchRepository["markKnownFailureAndRelease"]
    >[0],
  ): Promise<void> {
    const { error } = await this.client.rpc(
      "manual_message_mark_known_failure_and_release",
      {
        p_claim_token: input.claim.claimToken,
        p_failed_at: input.failedAt,
        p_message_id: input.claim.messageId,
        p_provider: this.providerName,
        p_provider_message_id: input.failure.providerResourceId,
        ...failureFields(input.failure),
      },
    );
    if (error) return fail("manual_mark_known_failure");
  }

  async markDispatchUnknown(
    input: Parameters<ManualDispatchRepository["markDispatchUnknown"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("manual_message_mark_unknown", {
      p_claim_token: input.claim.claimToken,
      p_marked_at: input.markedAt,
      p_message_id: input.claim.messageId,
      p_provider: this.providerName,
      p_provider_message_id: input.providerMessageId,
      p_unknown_reason: input.reason,
      ...failureFields(input.failure),
    });
    if (error) return fail("manual_mark_unknown");
  }
}
