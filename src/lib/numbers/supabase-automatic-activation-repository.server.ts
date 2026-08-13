import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AutomaticNumberActivationClaim,
  AutomaticNumberActivationRepository,
} from "./automatic-activation-repository";

type UnknownRow = Record<string, unknown>;

export class AutomaticNumberActivationRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Automatic number activation persistence is temporarily unavailable.");
    this.name = "AutomaticNumberActivationRepositoryError";
  }
}

function failure(operation: string): never {
  throw new AutomaticNumberActivationRepositoryError(operation);
}

function row(value: unknown, operation: string): UnknownRow {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return failure(operation);
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
    failure(operation);
  }
}

function requiredString(value: unknown, operation: string): string {
  if (typeof value !== "string" || !value.trim()) return failure(operation);
  return value;
}

function nullableString(value: unknown, operation: string): string | null {
  return value === null ? null : requiredString(value, operation);
}

function boolean(value: unknown, operation: string): boolean {
  if (typeof value !== "boolean") return failure(operation);
  return value;
}

export class SupabaseAutomaticNumberActivationRepository
  implements AutomaticNumberActivationRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claimPurchasedNumber(input: {
    numberId: string;
    requestedAt: string;
    workspaceId: string;
  }): Promise<AutomaticNumberActivationClaim> {
    const operation = "claim_automatic_number_activation";
    const { data, error } = await this.client.rpc(operation, {
      p_number_id: input.numberId,
      p_requested_at: input.requestedAt,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const result = row(data, operation);
    exactKeys(
      result,
      ["activation_id", "disposition", "number_id", "workspace_id"],
      operation,
    );
    const numberId = requiredString(result.number_id, operation);
    const workspaceId = requiredString(result.workspace_id, operation);
    if (numberId !== input.numberId || workspaceId !== input.workspaceId) {
      return failure("automatic_activation_correlation_mismatch");
    }
    const disposition = requiredString(result.disposition, operation);
    if (
      disposition !== "claimed" &&
      disposition !== "already_ready" &&
      disposition !== "provider_not_ready" &&
      disposition !== "in_progress"
    ) {
      return failure(operation);
    }
    const activationId = nullableString(result.activation_id, operation);
    if (
      (disposition === "claimed" || disposition === "in_progress") !==
      Boolean(activationId)
    ) {
      return failure(operation);
    }
    return { activationId, disposition, numberId, workspaceId };
  }

  async completePurchasedNumber(
    input: Parameters<AutomaticNumberActivationRepository["completePurchasedNumber"]>[0],
  ): Promise<void> {
    const operation = "complete_automatic_number_activation";
    const { data, error } = await this.client.rpc(operation, {
      p_activation_id: input.activationId,
      p_completed_at: input.completedAt,
      p_number_id: input.numberId,
      p_period_end: input.periodEndsAt,
      p_period_start: input.periodStartsAt,
      p_subscription_id: input.subscriptionId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const result = row(data, operation);
    exactKeys(
      result,
      ["activated", "activation_id", "number_id", "product_status", "workspace_id"],
      operation,
    );
    if (
      requiredString(result.activation_id, operation) !== input.activationId ||
      requiredString(result.number_id, operation) !== input.numberId ||
      requiredString(result.workspace_id, operation) !== input.workspaceId ||
      requiredString(result.product_status, operation) !== "ready" ||
      boolean(result.activated, operation) !== true
    ) {
      return failure("automatic_activation_correlation_mismatch");
    }
  }

  async failPurchasedNumber(
    input: Parameters<AutomaticNumberActivationRepository["failPurchasedNumber"]>[0],
  ): Promise<void> {
    const operation = "fail_automatic_number_activation";
    const { data, error } = await this.client.rpc(operation, {
      p_activation_id: input.activationId,
      p_failed_at: input.failedAt,
      p_failure_code: input.failureCode,
      p_number_id: input.numberId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const result = row(data, operation);
    exactKeys(
      result,
      ["activation_id", "number_id", "recorded", "workspace_id"],
      operation,
    );
    if (
      requiredString(result.activation_id, operation) !== input.activationId ||
      requiredString(result.number_id, operation) !== input.numberId ||
      requiredString(result.workspace_id, operation) !== input.workspaceId ||
      boolean(result.recorded, operation) !== true
    ) {
      return failure("automatic_activation_correlation_mismatch");
    }
  }
}
