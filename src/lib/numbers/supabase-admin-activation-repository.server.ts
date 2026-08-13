import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AdminNumberActivationRepository,
  ApprovedNumberActivationClaim,
} from "./admin-activation-repository";

type UnknownRow = Record<string, unknown>;

export class AdminNumberActivationRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Number activation persistence is temporarily unavailable.");
    this.name = "AdminNumberActivationRepositoryError";
  }
}

function failure(operation: string): never {
  throw new AdminNumberActivationRepositoryError(operation);
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

export class SupabaseAdminNumberActivationRepository
  implements AdminNumberActivationRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claimApprovedNumber(input: {
    adminUserId: string;
    numberId: string;
    requestedAt: string;
  }): Promise<ApprovedNumberActivationClaim> {
    const operation = "claim_approved_number_activation";
    const { data, error } = await this.client.rpc(
      "admin_claim_approved_number_activation",
      {
        p_admin_user_id: input.adminUserId,
        p_number_id: input.numberId,
        p_requested_at: input.requestedAt,
      },
    );
    if (error) return failure(operation);
    const result = row(data, operation);
    exactKeys(
      result,
      ["activation_id", "disposition", "number_id", "workspace_id"],
      operation,
    );
    const numberId = requiredString(result.number_id, operation);
    if (numberId !== input.numberId) return failure("number_correlation_mismatch");
    const disposition = requiredString(result.disposition, operation);
    if (
      disposition !== "claimed" &&
      disposition !== "already_ready" &&
      disposition !== "not_approved" &&
      disposition !== "in_progress"
    ) {
      return failure(operation);
    }
    const activationId = nullableString(result.activation_id, operation);
    if (disposition === "claimed" && !activationId) return failure(operation);
    if (disposition !== "claimed" && activationId) return failure(operation);
    return {
      activationId,
      disposition,
      numberId,
      workspaceId: requiredString(result.workspace_id, operation),
    };
  }

  async completeApprovedNumber(
    input: Parameters<AdminNumberActivationRepository["completeApprovedNumber"]>[0],
  ): Promise<void> {
    const operation = "complete_approved_number_activation";
    const { data, error } = await this.client.rpc(
      "admin_complete_approved_number_activation",
      {
        p_activation_id: input.activationId,
        p_admin_user_id: input.adminUserId,
        p_completed_at: input.completedAt,
        p_number_id: input.numberId,
        p_period_end: input.periodEndsAt,
        p_period_start: input.periodStartsAt,
        p_subscription_id: input.subscriptionId,
        p_workspace_id: input.workspaceId,
      },
    );
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
      return failure("activation_correlation_mismatch");
    }
  }

  async failApprovedNumber(
    input: Parameters<AdminNumberActivationRepository["failApprovedNumber"]>[0],
  ): Promise<void> {
    const operation = "fail_approved_number_activation";
    const { data, error } = await this.client.rpc(
      "admin_fail_approved_number_activation",
      {
        p_activation_id: input.activationId,
        p_admin_user_id: input.adminUserId,
        p_failed_at: input.failedAt,
        p_failure_code: input.failureCode,
        p_number_id: input.numberId,
        p_workspace_id: input.workspaceId,
      },
    );
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
      return failure("activation_correlation_mismatch");
    }
  }
}
