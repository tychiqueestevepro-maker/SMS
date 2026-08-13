import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  InboundReconciliationClaim,
  InboundReconciliationRepository,
} from "./inbound-reconciliation";

type UnknownRow = Record<string, unknown>;

export class InboundReconciliationRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Inbound message reconciliation is temporarily unavailable.");
    this.name = "InboundReconciliationRepositoryError";
  }
}

function fail(operation: string): never {
  throw new InboundReconciliationRepositoryError(operation);
}

function firstRow(value: unknown): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as UnknownRow)
    : null;
}

function requiredString(
  row: UnknownRow,
  key: string,
  operation: string,
): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) return fail(operation);
  return value;
}

function positiveInteger(
  row: UnknownRow,
  key: string,
  operation: string,
): number {
  const value = row[key];
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

export class SupabaseInboundReconciliationRepository
  implements InboundReconciliationRepository
{
  private readonly providerName: string;

  constructor(
    private readonly client: SupabaseClient,
    options: { providerName: string },
  ) {
    this.providerName = options.providerName.trim();
    if (!this.providerName) throw new RangeError("Provider name is required.");
  }

  async claimNext(input: {
    now: string;
    workerId: string;
  }): Promise<InboundReconciliationClaim | null> {
    const operation = "claim_inbound_reconciliation";
    const { data, error } = await this.client.rpc(
      "inbound_reconciliation_claim_next",
      { p_now: input.now, p_worker_id: input.workerId },
    );
    if (error) return fail(operation);
    const row = firstRow(data);
    if (!row) return null;
    const expected = [
      "attempt_count",
      "billing_period_id",
      "message_id",
      "provider",
      "provider_message_id",
      "reconciliation_token",
      "workspace_id",
    ].sort();
    const actual = Object.keys(row).sort();
    if (
      actual.length !== expected.length ||
      actual.some((key, index) => key !== expected[index])
    ) {
      return fail("invalid_claim_response");
    }

    if (requiredString(row, "provider", operation) !== this.providerName) {
      return fail("provider_mismatch");
    }
    return {
      attemptCount: positiveInteger(row, "attempt_count", operation),
      billingPeriodId: requiredString(row, "billing_period_id", operation),
      messageId: requiredString(row, "message_id", operation),
      providerMessageId: requiredString(
        row,
        "provider_message_id",
        operation,
      ),
      reconciliationToken: requiredString(
        row,
        "reconciliation_token",
        operation,
      ),
      workspaceId: requiredString(row, "workspace_id", operation),
    };
  }

  async complete(
    input: Parameters<InboundReconciliationRepository["complete"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("inbound_reconciliation_complete", {
      p_actual_segments: input.actualSegments,
      p_message_id: input.claim.messageId,
      p_provider_cost_micro_usd: input.providerCostMicroUsd,
      p_provider_cost_pending: input.providerCostPending,
      p_reconciled_at: input.reconciledAt,
      p_reconciliation_token: input.claim.reconciliationToken,
    });
    if (error) return fail("complete_inbound_reconciliation");
  }

  async defer(
    input: Parameters<InboundReconciliationRepository["defer"]>[0],
  ): Promise<void> {
    const { error } = await this.client.rpc("inbound_reconciliation_defer", {
      p_deferred_at: input.deferredAt,
      p_error_code: input.errorCode,
      p_message_id: input.claim.messageId,
      p_next_attempt_at: input.nextAttemptAt,
      p_reconciliation_token: input.claim.reconciliationToken,
    });
    if (error) return fail("defer_inbound_reconciliation");
  }
}
