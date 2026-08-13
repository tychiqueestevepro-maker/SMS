// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabaseNumberImportRepository } from "./supabase-import-repository.server";

function client() {
  return { rpc: vi.fn() };
}

describe("SupabaseNumberImportRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps a durable import claim without accepting provider-shaped extras", async () => {
    const supabase = client();
    supabase.rpc.mockResolvedValue({
      data: [{
        disposition: "claimed",
        operation_id: "operation-1",
        phone_number_id: "number-1",
      }],
      error: null,
    });
    const repository = new SupabaseNumberImportRepository(supabase as never);

    await expect(repository.claimImport({
      countryCode: "US",
      operationId: "operation-1",
      phoneNumber: "+15125550192",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      disposition: "claimed",
      operationId: "operation-1",
      phoneNumberId: "number-1",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("claim_phone_number_import", {
      p_country_code: "US",
      p_operation_id: "operation-1",
      p_phone_e164: "+15125550192",
      p_workspace_id: "workspace-1",
    });
  });

  it("returns null for an unknown callback correlation", async () => {
    const supabase = client();
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    const repository = new SupabaseNumberImportRepository(supabase as never);

    await expect(repository.getCallbackContext("import-1")).resolves.toBeNull();
  });

  it("fails closed on malformed private RPC rows", async () => {
    const supabase = client();
    supabase.rpc.mockResolvedValue({
      data: [{
        import_status: "active",
        operation_id: "operation-1",
        phone_number_id: "number-1",
        provider_import_id: "import-1",
        provider_number_id: null,
        workspace_id: "workspace-1",
      }],
      error: null,
    });
    const repository = new SupabaseNumberImportRepository(supabase as never);

    await expect(repository.getImportContext({
      phoneNumberId: "number-1",
      workspaceId: "workspace-1",
    })).resolves.toEqual(expect.objectContaining({ importStatus: "active" }));

    supabase.rpc.mockResolvedValueOnce({
      data: [{
        import_status: "provider-secret-state",
        operation_id: "operation-1",
        phone_number_id: "number-1",
        provider_import_id: "import-1",
        provider_number_id: null,
        workspace_id: "workspace-1",
      }],
      error: null,
    });
    await expect(repository.getImportContext({
      phoneNumberId: "number-1",
      workspaceId: "workspace-1",
    })).rejects.toThrow("persistence");
  });
});
