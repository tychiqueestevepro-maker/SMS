// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ManualDispatchRepositoryError,
  SupabaseManualDispatchRepository,
} from "./supabase-manual-dispatch.server";

function clientWithRpc(
  implementation: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: implementation(name, args),
    error: null,
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "claimed",
    message_id: "message-1",
    workspace_id: "workspace-1",
    contact_id: "contact-1",
    claim_token: "claim-1",
    reservation_id: "reservation-1",
    estimated_segments: 2,
    dispatch_state: "reserved",
    ...overrides,
  };
}

describe("SupabaseManualDispatchRepository", () => {
  it("uses the exact transactional reservation RPC contract", async () => {
    const { client, rpc } = clientWithRpc(() => [claimRow()]);
    const repository = new SupabaseManualDispatchRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.claimAndReserve({
      body: "Long message",
      contactId: "contact-1",
      estimatedSegments: 2,
      now: "2026-08-10T12:00:00.000Z",
      phoneNumberId: "number-1",
      requestId: "request-1",
      workspaceId: "workspace-1",
    })).resolves.toMatchObject({
      disposition: "claimed",
      dispatchState: "reserved",
      estimatedSegments: 2,
    });
    expect(rpc).toHaveBeenCalledWith("manual_message_claim_and_reserve", {
      p_body: "Long message",
      p_contact_id: "contact-1",
      p_estimated_segments: 2,
      p_now: "2026-08-10T12:00:00.000Z",
      p_phone_number_id: "number-1",
      p_request_id: "request-1",
      p_workspace_id: "workspace-1",
    });
  });

  it("builds send input only from the locked final validation response", async () => {
    const { client } = clientWithRpc(() => ({
      authorized: true,
      message_id: "message-1",
      workspace_id: "workspace-1",
      contact_id: "contact-1",
      body: "Stored body",
      from: "+15125550101",
      to: "+15125550199",
    }));
    const repository = new SupabaseManualDispatchRepository(client, {
      providerName: "internal-provider",
      statusCallbackUrl: "https://www.riink.app/api/webhooks/sms",
    });

    await expect(repository.finalValidateAndBeginProviderAttempt({
      claim: {
        claimToken: "claim-1",
        contactId: "contact-1",
        dispatchState: "reserved",
        disposition: "claimed",
        estimatedSegments: 1,
        messageId: "message-1",
        reservationId: "reservation-1",
        workspaceId: "workspace-1",
      },
      now: "2026-08-10T12:00:00.000Z",
    })).resolves.toEqual({
      authorized: true,
      sendInput: {
        body: "Stored body",
        from: "+15125550101",
        idempotencyKey: "claim-1",
        messageId: "message-1",
        statusCallbackUrl: "https://www.riink.app/api/webhooks/sms",
        to: "+15125550199",
        workspaceId: "workspace-1",
      },
    });
  });

  it("rejects any unexpected technical field in a claim response", async () => {
    const { client } = clientWithRpc(() => [
      claimRow({ raw_external_id: "must-not-cross" }),
    ]);
    const repository = new SupabaseManualDispatchRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.claimAndReserve({
      body: "Hello",
      contactId: "contact-1",
      estimatedSegments: 1,
      now: "2026-08-10T12:00:00.000Z",
      phoneNumberId: "number-1",
      requestId: "request-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(ManualDispatchRepositoryError);
  });
});
