// @vitest-environment node
import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { CredentialVault } from "@/lib/security/credential-vault";

import {
  createWorkspaceMessagingCredentialsResolver,
  MessagingRuntimeConfigurationError,
} from "./messaging.server";

describe("workspace messaging credential resolution", () => {
  it("decrypts a workspace-bound token from the service-role RPC", async () => {
    const vault = new CredentialVault(randomBytes(32).toString("base64"));
    const workspaceId = "workspace-1";
    const encrypted = vault.encrypt(
      "secret-auth-token",
      `workspace:${workspaceId}:messaging-auth-token`,
    );
    const rpc = vi.fn(async () => ({
      data: {
        account_id: "AC-account",
        encrypted_auth_token: encrypted,
        messaging_service_id: "MG-service",
      },
      error: null,
    }));
    const resolve = createWorkspaceMessagingCredentialsResolver({
      client: { rpc } as unknown as SupabaseClient,
      vault,
    });

    await expect(resolve(workspaceId)).resolves.toEqual({
      accountSid: "AC-account",
      authToken: "secret-auth-token",
      messagingServiceSid: "MG-service",
    });
    expect(rpc).toHaveBeenCalledWith("messaging_get_workspace_credentials", {
      p_workspace_id: workspaceId,
    });
  });

  it("fails closed for missing or differently-bound credentials", async () => {
    const vault = new CredentialVault(randomBytes(32).toString("base64"));
    const encrypted = vault.encrypt(
      "secret-auth-token",
      "workspace:other-workspace:messaging-auth-token",
    );
    const resolve = createWorkspaceMessagingCredentialsResolver({
      client: {
        rpc: vi.fn(async () => ({
          data: {
            account_id: "AC-account",
            encrypted_auth_token: encrypted,
            messaging_service_id: "MG-service",
          },
          error: null,
        })),
      } as unknown as SupabaseClient,
      vault,
    });

    await expect(resolve("workspace-1")).rejects.toBeInstanceOf(
      MessagingRuntimeConfigurationError,
    );
  });
});
