import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

type ConnectionDisposition =
  | "claimed"
  | "completed"
  | "in_progress"
  | "reconciliation_required";

type Row = Record<string, unknown>;

function firstRow(value: unknown): Row {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Configured number persistence is unavailable.");
  }
  return row as Row;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Configured number persistence is unavailable.");
  }
  return value;
}

export class ConfiguredNumberRepository {
  constructor(private readonly client: SupabaseClient) {}

  async claim(input: {
    operationId: string;
    phoneNumber: string;
    providerNumberId: string;
    workspaceId: string;
  }): Promise<{
    disposition: ConnectionDisposition;
    operationId: string;
    phoneNumberId: string;
  }> {
    const { data, error } = await this.client.rpc(
      "claim_configured_number_connection",
      {
        p_operation_id: input.operationId,
        p_phone_e164: input.phoneNumber,
        p_provider_number_id: input.providerNumberId,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) throw new Error("Configured number persistence is unavailable.");
    const row = firstRow(data);
    const disposition = requiredString(row.disposition) as ConnectionDisposition;
    if (
      !["claimed", "completed", "in_progress", "reconciliation_required"].includes(
        disposition,
      )
    ) {
      throw new Error("Configured number persistence is unavailable.");
    }
    return {
      disposition,
      operationId: requiredString(row.operation_id),
      phoneNumberId: requiredString(row.phone_number_id),
    };
  }

  async complete(input: {
    completedAt: string;
    operationId: string;
    providerName: string;
    providerNumberId: string;
    providerStatus: string;
    workspaceId: string;
  }): Promise<{ completed: boolean; phoneNumberId: string }> {
    const { data, error } = await this.client.rpc(
      "complete_configured_number_connection",
      {
        p_completed_at: input.completedAt,
        p_operation_id: input.operationId,
        p_provider: input.providerName,
        p_provider_number_id: input.providerNumberId,
        p_provider_status: input.providerStatus,
        p_workspace_id: input.workspaceId,
      },
    );
    if (error) throw new Error("Configured number persistence is unavailable.");
    const row = firstRow(data);
    if (typeof row.completed !== "boolean") {
      throw new Error("Configured number persistence is unavailable.");
    }
    return {
      completed: row.completed,
      phoneNumberId: requiredString(row.phone_number_id),
    };
  }

  async markUnknown(input: {
    operationId: string;
    providerCode: string | null;
    providerMessage: string;
    workspaceId: string;
  }): Promise<void> {
    await this.client.rpc("mark_configured_number_connection_unknown", {
      p_operation_id: input.operationId,
      p_provider_code: input.providerCode,
      p_provider_message: input.providerMessage,
      p_workspace_id: input.workspaceId,
    });
  }
}
