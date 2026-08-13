import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  NumberImportClaimDisposition,
  NumberImportDisconnectDisposition,
  NumberImportProductStatus,
  NumberImportRepository,
} from "./import-repository";

type UnknownRow = Record<string, unknown>;

export class NumberImportRepositoryError extends Error {
  constructor(readonly operation: string) {
    super("Number import persistence is temporarily unavailable.");
    this.name = "NumberImportRepositoryError";
  }
}

function failure(operation: string): never {
  throw new NumberImportRepositoryError(operation);
}

function optionalRow(value: unknown, operation: string): UnknownRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === null || candidate === undefined) return null;
  if (typeof candidate !== "object" || Array.isArray(candidate)) {
    return failure(operation);
  }
  return candidate as UnknownRow;
}

function requiredRow(value: unknown, operation: string): UnknownRow {
  return optionalRow(value, operation) ?? failure(operation);
}

function requiredString(value: unknown, operation: string): string {
  if (typeof value !== "string" || value.trim() === "") return failure(operation);
  return value;
}

function nullableString(value: unknown, operation: string): string | null {
  return value === null ? null : requiredString(value, operation);
}

function booleanValue(value: unknown, operation: string): boolean {
  if (typeof value !== "boolean") return failure(operation);
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  operation: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return failure(operation);
  }
  return value as T;
}

const IMPORT_STATUSES = [
  "verification",
  "pending",
  "importing",
  "action_required",
  "active",
  "failed",
] as const satisfies readonly NumberImportProductStatus[];

export class SupabaseNumberImportRepository implements NumberImportRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claimImport(
    input: Parameters<NumberImportRepository["claimImport"]>[0],
  ) {
    const operation = "claim_phone_number_import";
    const { data, error } = await this.client.rpc(operation, {
      p_country_code: input.countryCode,
      p_operation_id: input.operationId,
      p_phone_e164: input.phoneNumber,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const row = requiredRow(data, operation);
    return {
      disposition: enumValue<NumberImportClaimDisposition>(
        row.disposition,
        ["claimed", "already_started", "in_progress", "reconciliation_required"],
        operation,
      ),
      operationId: requiredString(row.operation_id, operation),
      phoneNumberId: requiredString(row.phone_number_id, operation),
    };
  }

  async recordImportStarted(
    input: Parameters<NumberImportRepository["recordImportStarted"]>[0],
  ) {
    const operation = "record_phone_number_import_started";
    const { data, error } = await this.client.rpc(operation, {
      p_import_status: input.importStatus,
      p_operation_id: input.operationId,
      p_provider: input.providerName,
      p_provider_import_id: input.providerImportId,
      p_provider_status: input.providerStatus,
      p_verification_code: input.verificationCode,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const row = requiredRow(data, operation);
    return {
      phoneNumberId: requiredString(row.phone_number_id, operation),
      recorded: booleanValue(row.recorded, operation),
    };
  }

  async markImportUnknown(
    input: Parameters<NumberImportRepository["markImportUnknown"]>[0],
  ): Promise<boolean> {
    const operation = "mark_phone_number_import_unknown";
    const { data, error } = await this.client.rpc(operation, {
      p_operation_id: input.operationId,
      p_provider_code: input.failure.providerCode,
      p_provider_message: input.failure.providerMessage,
      p_provider_resource_id: input.failure.providerResourceId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    return booleanValue(requiredRow(data, operation).recorded, operation);
  }

  async getImportContext(
    input: Parameters<NumberImportRepository["getImportContext"]>[0],
  ) {
    const operation = "get_phone_number_import_context";
    const { data, error } = await this.client.rpc(operation, {
      p_phone_number_id: input.phoneNumberId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const row = optionalRow(data, operation);
    if (!row) return null;
    return {
      importStatus: enumValue(row.import_status, IMPORT_STATUSES, operation),
      operationId: requiredString(row.operation_id, operation),
      phoneNumberId: requiredString(row.phone_number_id, operation),
      providerImportId: requiredString(row.provider_import_id, operation),
      providerNumberId: nullableString(row.provider_number_id, operation),
      workspaceId: requiredString(row.workspace_id, operation),
    };
  }

  async getCallbackContext(providerImportId: string) {
    const operation = "get_phone_number_import_callback_context";
    const { data, error } = await this.client.rpc(operation, {
      p_provider_import_id: providerImportId,
    });
    if (error) return failure(operation);
    const row = optionalRow(data, operation);
    if (!row) return null;
    return {
      phoneNumberId: requiredString(row.phone_number_id, operation),
      workspaceId: requiredString(row.workspace_id, operation),
    };
  }

  async updateImportStatus(
    input: Parameters<NumberImportRepository["updateImportStatus"]>[0],
  ): Promise<boolean> {
    const operation = "update_phone_number_import_status";
    const { data, error } = await this.client.rpc(operation, {
      p_import_status: input.importStatus,
      p_observed_at: input.observedAt,
      p_phone_number_id: input.phoneNumberId,
      p_provider_number_id: input.providerNumberId,
      p_provider_status: input.providerStatus,
      p_usable: input.usable,
      p_verification_code: input.verificationCode,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    return booleanValue(requiredRow(data, operation).updated, operation);
  }

  async claimDisconnect(
    input: Parameters<NumberImportRepository["claimDisconnect"]>[0],
  ) {
    const operation = "claim_phone_number_import_disconnect";
    const { data, error } = await this.client.rpc(operation, {
      p_operation_id: input.operationId,
      p_phone_number_id: input.phoneNumberId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    const row = requiredRow(data, operation);
    return {
      disposition: enumValue<NumberImportDisconnectDisposition>(
        row.disposition,
        ["claimed", "already_disconnected", "in_progress", "reconciliation_required"],
        operation,
      ),
      operationId: requiredString(row.operation_id, operation),
      providerImportId: nullableString(row.provider_import_id, operation),
      providerNumberId: nullableString(row.provider_number_id, operation),
    };
  }

  async completeDisconnect(
    input: Parameters<NumberImportRepository["completeDisconnect"]>[0],
  ): Promise<boolean> {
    const operation = "complete_phone_number_import_disconnect";
    const { data, error } = await this.client.rpc(operation, {
      p_operation_id: input.operationId,
      p_phone_number_id: input.phoneNumberId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    return booleanValue(requiredRow(data, operation).completed, operation);
  }

  async markDisconnectUnknown(
    input: Parameters<NumberImportRepository["markDisconnectUnknown"]>[0],
  ): Promise<boolean> {
    const operation = "mark_phone_number_import_disconnect_unknown";
    const { data, error } = await this.client.rpc(operation, {
      p_operation_id: input.operationId,
      p_phone_number_id: input.phoneNumberId,
      p_provider_code: input.failure.providerCode,
      p_provider_message: input.failure.providerMessage,
      p_provider_resource_id: input.failure.providerResourceId,
      p_workspace_id: input.workspaceId,
    });
    if (error) return failure(operation);
    return booleanValue(requiredRow(data, operation).recorded, operation);
  }
}
