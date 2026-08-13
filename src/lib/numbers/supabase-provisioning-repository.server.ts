import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NumberProvisioningRepository,
  NumberPurchaseClaim,
  NumberPurchaseDisposition,
  NumberReleaseClaim,
  NumberReleaseDisposition,
  WorkspaceSetupClaim,
  WorkspaceSetupDisposition,
} from "./provisioning-repository";

type UnknownRow = Record<string, unknown>;

export class NumberProvisioningRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Phone number setup persistence is temporarily unavailable.");
    this.name = "NumberProvisioningRepositoryError";
  }
}

function failure(operation: string): never {
  throw new NumberProvisioningRepositoryError(operation);
}

function firstRow(value: unknown, operation: string): UnknownRow {
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

function booleanValue(value: unknown, operation: string): boolean {
  if (typeof value !== "boolean") return failure(operation);
  return value;
}

function disposition<T extends string>(
  value: unknown,
  allowed: readonly T[],
  operation: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return failure(operation);
  }
  return value as T;
}

export class SupabaseNumberProvisioningRepository
  implements NumberProvisioningRepository
{
  constructor(private readonly client: SupabaseClient) {}

  async claimNumberSearchAttempt(
    input: Parameters<NumberProvisioningRepository["claimNumberSearchAttempt"]>[0],
  ) {
    const operation = "claim_number_search_attempt";
    const { data, error } = await this.client.rpc(
      "messaging_claim_number_search",
      {
        p_request_id: input.requestId,
        p_requested_at: input.requestedAt,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["allowed", "replayed", "retry_after_seconds"], operation);
    const retryAfterSeconds = row.retry_after_seconds;
    if (!Number.isSafeInteger(retryAfterSeconds) || (retryAfterSeconds as number) < 0) {
      return failure(operation);
    }
    return {
      allowed: booleanValue(row.allowed, operation),
      replayed: booleanValue(row.replayed, operation),
      retryAfterSeconds: retryAfterSeconds as number,
    };
  }

  async claimWorkspaceSetup(input: {
    operationId: string;
    workspaceId: string;
  }): Promise<WorkspaceSetupClaim> {
    const operation = "claim_workspace_setup";
    const { data, error } = await this.client.rpc(
      "messaging_claim_workspace_setup",
      {
        p_operation_id: input.operationId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["disposition", "operation_id"], operation);
    return {
      disposition: disposition<WorkspaceSetupDisposition>(
        row.disposition,
        ["claimed", "ready", "in_progress", "reconciliation_required"],
        operation,
      ),
      operationId: requiredString(row.operation_id, operation),
    };
  }

  async recordWorkspaceAccount(input: {
    encryptedCredential: string;
    operationId: string;
    providerAccountId: string;
    providerName: string;
    workspaceId: string;
  }): Promise<boolean> {
    const operation = "record_workspace_account";
    const { data, error } = await this.client.rpc(
      "messaging_record_workspace_account",
      {
        p_encrypted_auth_token: input.encryptedCredential,
        p_operation_id: input.operationId,
        p_provider: input.providerName,
        p_provider_account_id: input.providerAccountId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["recorded"], operation);
    return booleanValue(row.recorded, operation);
  }

  async completeWorkspaceSetup(input: {
    messagingServiceId: string;
    operationId: string;
    workspaceId: string;
  }): Promise<boolean> {
    const operation = "complete_workspace_setup";
    const { data, error } = await this.client.rpc(
      "messaging_complete_workspace_setup",
      {
        p_messaging_service_id: input.messagingServiceId,
        p_operation_id: input.operationId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["completed"], operation);
    return booleanValue(row.completed, operation);
  }

  async markWorkspaceSetupUnknown(
    input: Parameters<NumberProvisioningRepository["markWorkspaceSetupUnknown"]>[0],
  ): Promise<boolean> {
    const operation = "mark_workspace_setup_unknown";
    const { data, error } = await this.client.rpc(
      "messaging_mark_workspace_setup_unknown",
      {
        p_operation_id: input.operationId,
        p_provider_code: input.failure.providerCode,
        p_provider_message: input.failure.providerMessage,
        p_provider_resource_id: input.failure.providerResourceId,
        p_step: input.step,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["recorded"], operation);
    return booleanValue(row.recorded, operation);
  }

  async claimNumberPurchase(
    input: Parameters<NumberProvisioningRepository["claimNumberPurchase"]>[0],
  ): Promise<NumberPurchaseClaim> {
    const operation = "claim_number_purchase";
    const { data, error } = await this.client.rpc(
      "claim_phone_number_purchase",
      {
        p_business_verification: input.businessVerification,
        p_operation_id: input.operationId,
        p_phone_e164: input.phoneNumber,
        p_selection_nonce: input.selectionNonce,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(
      row,
      ["disposition", "operation_id", "phone_number_id"],
      operation,
    );
    return {
      disposition: disposition<NumberPurchaseDisposition>(
        row.disposition,
        ["claimed", "already_started", "in_progress", "reconciliation_required"],
        operation,
      ),
      operationId: requiredString(row.operation_id, operation),
      phoneNumberId: nullableString(row.phone_number_id, operation),
    };
  }

  async completeNumberPurchase(
    input: Parameters<NumberProvisioningRepository["completeNumberPurchase"]>[0],
  ): Promise<{ completed: boolean; phoneNumberId: string }> {
    const operation = "complete_number_purchase";
    const { data, error } = await this.client.rpc(
      "complete_phone_number_purchase",
      {
        p_operation_id: input.operationId,
        p_provider: input.providerName,
        p_provider_number_id: input.providerNumberId,
        p_provider_status: input.providerStatus,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["completed", "phone_number_id"], operation);
    return {
      completed: booleanValue(row.completed, operation),
      phoneNumberId: requiredString(row.phone_number_id, operation),
    };
  }

  async markNumberPurchaseUnknown(
    input: Parameters<NumberProvisioningRepository["markNumberPurchaseUnknown"]>[0],
  ): Promise<boolean> {
    const operation = "mark_number_purchase_unknown";
    const { data, error } = await this.client.rpc(
      "mark_phone_number_purchase_unknown",
      {
        p_operation_id: input.operationId,
        p_provider_code: input.failure.providerCode,
        p_provider_message: input.failure.providerMessage,
        p_provider_resource_id: input.failure.providerResourceId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["recorded"], operation);
    return booleanValue(row.recorded, operation);
  }

  async claimNumberRelease(
    input: Parameters<NumberProvisioningRepository["claimNumberRelease"]>[0],
  ): Promise<NumberReleaseClaim> {
    const operation = "claim_number_release";
    const { data, error } = await this.client.rpc(
      "claim_phone_number_release",
      {
        p_operation_id: input.operationId,
        p_phone_number_id: input.phoneNumberId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(
      row,
      ["disposition", "operation_id", "provider_number_id"],
      operation,
    );
    return {
      disposition: disposition<NumberReleaseDisposition>(
        row.disposition,
        [
          "claimed",
          "already_released",
          "in_progress",
          "reconciliation_required",
          "blocked_active_campaign",
        ],
        operation,
      ),
      operationId: requiredString(row.operation_id, operation),
      providerNumberId: nullableString(row.provider_number_id, operation),
    };
  }

  async completeNumberRelease(
    input: Parameters<NumberProvisioningRepository["completeNumberRelease"]>[0],
  ): Promise<boolean> {
    const operation = "complete_number_release";
    const { data, error } = await this.client.rpc(
      "complete_phone_number_release",
      {
        p_operation_id: input.operationId,
        p_phone_number_id: input.phoneNumberId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["completed"], operation);
    return booleanValue(row.completed, operation);
  }

  async markNumberReleaseUnknown(
    input: Parameters<NumberProvisioningRepository["markNumberReleaseUnknown"]>[0],
  ): Promise<boolean> {
    const operation = "mark_number_release_unknown";
    const { data, error } = await this.client.rpc(
      "mark_phone_number_release_unknown",
      {
        p_operation_id: input.operationId,
        p_phone_number_id: input.phoneNumberId,
        p_provider_code: input.failure.providerCode,
        p_provider_message: input.failure.providerMessage,
        p_provider_resource_id: input.failure.providerResourceId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) return failure(operation);
    const row = firstRow(data, operation);
    exactKeys(row, ["recorded"], operation);
    return booleanValue(row.recorded, operation);
  }
}
