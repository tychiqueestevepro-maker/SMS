// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NumberProvisioningRepositoryError,
  SupabaseNumberProvisioningRepository,
} from "./supabase-provisioning-repository.server";

function clientWithRpc(
  implementation: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: implementation(name, args),
    error: null,
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("SupabaseNumberProvisioningRepository", () => {
  it("claims a number search before calling provider infrastructure", async () => {
    const { client, rpc } = clientWithRpc(() => [{
      allowed: true,
      replayed: false,
      retry_after_seconds: 0,
    }]);
    const repository = new SupabaseNumberProvisioningRepository(client);

    await expect(repository.claimNumberSearchAttempt({
      requestId: "11111111-1111-4111-8111-111111111111",
      requestedAt: "2026-08-10T12:00:00.000Z",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      allowed: true,
      replayed: false,
      retryAfterSeconds: 0,
    });
    expect(rpc).toHaveBeenCalledWith("messaging_claim_number_search", {
      p_request_id: "11111111-1111-4111-8111-111111111111",
      p_requested_at: "2026-08-10T12:00:00.000Z",
      p_workspace_id: "workspace-1",
    });
  });

  it("claims workspace setup using only the durable operation correlation", async () => {
    const { client, rpc } = clientWithRpc(() => [{
      disposition: "claimed",
      operation_id: "operation-1",
    }]);
    const repository = new SupabaseNumberProvisioningRepository(client);

    await expect(repository.claimWorkspaceSetup({
      operationId: "operation-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      disposition: "claimed",
      operationId: "operation-1",
    });
    expect(rpc).toHaveBeenCalledWith("messaging_claim_workspace_setup", {
      p_operation_id: "operation-1",
      p_workspace_id: "workspace-1",
    });
  });

  it("stores an uncertain purchase with internal diagnostics only", async () => {
    const { client, rpc } = clientWithRpc(() => [{ recorded: true }]);
    const repository = new SupabaseNumberProvisioningRepository(client);

    await expect(repository.markNumberPurchaseUnknown({
      failure: {
        providerCode: "TECHNICAL_CODE",
        providerMessage: "Technical message",
        providerResourceId: "number-resource-1",
      },
      operationId: "operation-1",
      workspaceId: "workspace-1",
    })).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      "mark_phone_number_purchase_unknown",
      {
        p_operation_id: "operation-1",
        p_provider_code: "TECHNICAL_CODE",
        p_provider_message: "Technical message",
        p_provider_resource_id: "number-resource-1",
        p_workspace_id: "workspace-1",
      },
    );
  });

  it("fails closed when a service-role RPC response adds an unexpected field", async () => {
    const { client } = clientWithRpc(() => [{
      disposition: "ready",
      operation_id: "operation-1",
      raw_external_account: "must-not-cross",
    }]);
    const repository = new SupabaseNumberProvisioningRepository(client);

    await expect(repository.claimWorkspaceSetup({
      operationId: "operation-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(NumberProvisioningRepositoryError);
  });
});
