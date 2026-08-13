// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  InboundReconciliationRepositoryError,
  SupabaseInboundReconciliationRepository,
} from "./supabase-inbound-reconciliation.server";

function clientWithRpc(
  implementation: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: implementation(name, args),
    error: null,
  }));
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

function claimRow(provider = "internal-provider") {
  return {
    message_id: "message-1",
    workspace_id: "workspace-1",
    provider,
    provider_message_id: "provider-message-1",
    reconciliation_token: "token-1",
    billing_period_id: "period-1",
    attempt_count: 2,
  };
}

describe("SupabaseInboundReconciliationRepository", () => {
  it("maps the private inbound claim and preserves its original period", async () => {
    const { client } = clientWithRpc(() => [claimRow()]);
    const repository = new SupabaseInboundReconciliationRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.claimNext({
      now: "2026-08-10T12:00:00.000Z",
      workerId: "worker-1",
    })).resolves.toEqual({
      attemptCount: 2,
      billingPeriodId: "period-1",
      messageId: "message-1",
      providerMessageId: "provider-message-1",
      reconciliationToken: "token-1",
      workspaceId: "workspace-1",
    });
  });

  it("fails closed instead of using the wrong adapter", async () => {
    const { client } = clientWithRpc(() => [claimRow("different-provider")]);
    const repository = new SupabaseInboundReconciliationRepository(client, {
      providerName: "internal-provider",
    });

    await expect(repository.claimNext({
      now: "2026-08-10T12:00:00.000Z",
      workerId: "worker-1",
    })).rejects.toBeInstanceOf(InboundReconciliationRepositoryError);
  });

  it("completes only provider cost/segments; customer billing fields are absent", async () => {
    const { client, rpc } = clientWithRpc(() => null);
    const repository = new SupabaseInboundReconciliationRepository(client, {
      providerName: "internal-provider",
    });
    const claim = {
      attemptCount: 1,
      billingPeriodId: "period-1",
      messageId: "message-1",
      providerMessageId: "provider-message-1",
      reconciliationToken: "token-1",
      workspaceId: "workspace-1",
    };

    await repository.complete({
      actualSegments: 2,
      claim,
      providerCostMicroUsd: 7_500,
      providerCostPending: false,
      reconciledAt: "2026-08-10T12:00:00.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("inbound_reconciliation_complete", {
      p_actual_segments: 2,
      p_message_id: "message-1",
      p_provider_cost_micro_usd: 7_500,
      p_provider_cost_pending: false,
      p_reconciled_at: "2026-08-10T12:00:00.000Z",
      p_reconciliation_token: "token-1",
    });
  });
});
