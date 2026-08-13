// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import { dispatchClaim } from "./test-fixtures";
import {
  DispatchRepositoryError,
  SupabaseDispatchRepository,
} from "./supabase-repository";

function clientWithRpc(
  implementation: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: implementation(name, args),
    error: null,
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("SupabaseDispatchRepository", () => {
  it("maps the service-role dispatch claim", async () => {
    const { client } = clientWithRpc(() => [{
      message_id: "message-1",
      workspace_id: "workspace-1",
      campaign_id: "campaign-1",
      campaign_recipient_id: "recipient-1",
      contact_id: "contact-1",
      claim_token: "claim-1",
      reservation_id: "reservation-1",
      estimated_segments: 2,
    }]);

    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });
    await expect(repository.claimAndReserveNext({
      now: "2026-08-10T12:00:00.000Z",
      workerId: "worker-1",
    })).resolves.toEqual({
      campaignId: "campaign-1",
      campaignRecipientId: "recipient-1",
      claimToken: "claim-1",
      contactId: "contact-1",
      estimatedSegments: 2,
      messageId: "message-1",
      reservationId: "reservation-1",
      workspaceId: "workspace-1",
    });
  });

  it("uses only values returned by the locked final validation", async () => {
    const claim = dispatchClaim();
    const { client, rpc } = clientWithRpc(() => ({
      authorized: true,
      message_id: claim.messageId,
      workspace_id: claim.workspaceId,
      campaign_id: claim.campaignId,
      campaign_recipient_id: claim.campaignRecipientId,
      contact_id: claim.contactId,
      body: "Rendered body",
      from: "+12025550101",
      to: "+12025550199",
    }));
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
      statusCallbackUrl: "https://www.riink.app/api/webhooks/sms/status",
    });

    await expect(repository.finalValidateAndBeginProviderAttempt({
      claim,
      now: "2026-08-10T12:00:00.000Z",
    })).resolves.toEqual({
      ok: true,
      sendInput: {
        body: "Rendered body",
        from: "+12025550101",
        idempotencyKey: claim.claimToken,
        messageId: claim.messageId,
        statusCallbackUrl: "https://www.riink.app/api/webhooks/sms/status",
        to: "+12025550199",
        workspaceId: claim.workspaceId,
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "dispatch_final_validate_and_begin_attempt",
      expect.objectContaining({ p_claim_token: claim.claimToken }),
    );
  });

  it("maps temporary send-window rejection without exposing DB detail", async () => {
    const { client } = clientWithRpc(() => ({
      authorized: false,
      code: "outside_send_window",
    }));
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.finalValidateAndBeginProviderAttempt({
      claim: dispatchClaim(),
      now: "2026-08-10T03:00:00.000Z",
    })).resolves.toEqual({
      ok: false,
      reason: "outside_send_window",
      recipientStopped: false,
      reservationReleased: true,
    });
  });

  it("fails closed if the RPC changes the claimed correlation", async () => {
    const claim = dispatchClaim();
    const { client } = clientWithRpc(() => ({
      authorized: true,
      message_id: "different-message",
      workspace_id: claim.workspaceId,
      campaign_id: claim.campaignId,
      campaign_recipient_id: claim.campaignRecipientId,
      contact_id: claim.contactId,
      body: "Body",
      from: "+12025550101",
      to: "+12025550199",
    }));
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.finalValidateAndBeginProviderAttempt({
      claim,
      now: "2026-08-10T12:00:00.000Z",
    })).rejects.toBeInstanceOf(DispatchRepositoryError);
  });

  it("stores raw failure details only through the private worker RPC", async () => {
    const { client, rpc } = clientWithRpc(() => null);
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });
    await repository.markKnownFailureAndRelease({
      claim: dispatchClaim(),
      failedAt: "2026-08-10T12:00:00.000Z",
      failure: {
        kind: "invalid_recipient",
        operation: "sendMessage",
        providerCode: "RAW_CODE",
        providerMessage: "Raw technical detail",
        providerResourceId: null,
        retryable: false,
      },
    });

    expect(rpc).toHaveBeenCalledWith(
      "dispatch_mark_known_failure_and_release",
      expect.objectContaining({
        p_provider_error_code: "RAW_CODE",
        p_provider_error_message: "Raw technical detail",
      }),
    );
  });

  it("claims accepted manual messages for the same real-usage reconciliation", async () => {
    const { client } = clientWithRpc(() => [{
      message_id: "manual-message-1",
      workspace_id: "workspace-1",
      campaign_id: null,
      campaign_recipient_id: null,
      contact_id: "contact-1",
      reconciliation_token: "reconcile-1",
      reservation_id: "reservation-1",
      provider_message_id: "provider-message-1",
      billing_period_id: "period-1",
      usage_position: 7,
    }]);
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.claimNextReconciliation({
      now: "2026-08-10T12:00:00.000Z",
      workerId: "worker-1",
    })).resolves.toMatchObject({
      campaignId: null,
      campaignRecipientId: null,
      contactId: "contact-1",
      messageId: "manual-message-1",
    });
  });

  it("records provider cost independently from real segment availability", async () => {
    const { client, rpc } = clientWithRpc(() => null);
    const repository = new SupabaseDispatchRepository(client, {
      providerName: "internal-provider",
    });
    const claim = {
      ...dispatchClaim(),
      reconciliationToken: "reconcile-1",
      providerMessageId: "provider-message-1",
      billingPeriodId: "period-1",
      usagePosition: 1,
    };

    await repository.recordReconciledProviderCost({
      claim,
      providerCostMicroUsd: 9_500,
      providerCostPending: false,
      observedAt: "2026-08-10T12:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith(
      "reconciliation_record_provider_cost",
      {
        p_message_id: "message-1",
        p_observed_at: "2026-08-10T12:00:00.000Z",
        p_provider_cost_micro_usd: 9_500,
        p_provider_cost_pending: false,
        p_reconciliation_token: "reconcile-1",
      },
    );
  });
});
