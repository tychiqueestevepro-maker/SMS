// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutomaticNumberActivationRepositoryError,
  SupabaseAutomaticNumberActivationRepository,
} from "./supabase-automatic-activation-repository.server";

function withRpc(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  return {
    repository: new SupabaseAutomaticNumberActivationRepository(
      { rpc } as unknown as SupabaseClient,
    ),
    rpc,
  };
}

describe("SupabaseAutomaticNumberActivationRepository", () => {
  it("claims only the provider correlated number", async () => {
    const { repository, rpc } = withRpc({
      activation_id: "activation_1",
      disposition: "claimed",
      number_id: "number_1",
      workspace_id: "workspace_1",
    });

    await expect(
      repository.claimPurchasedNumber({
        numberId: "number_1",
        requestedAt: "2026-08-13T16:00:00.000Z",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      activationId: "activation_1",
      disposition: "claimed",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith("claim_automatic_number_activation", {
      p_number_id: "number_1",
      p_requested_at: "2026-08-13T16:00:00.000Z",
      p_workspace_id: "workspace_1",
    });
  });

  it("fails closed when the workspace correlation differs", async () => {
    const { repository } = withRpc({
      activation_id: "activation_1",
      disposition: "claimed",
      number_id: "number_1",
      workspace_id: "workspace_other",
    });

    await expect(
      repository.claimPurchasedNumber({
        numberId: "number_1",
        requestedAt: "2026-08-13T16:00:00.000Z",
        workspaceId: "workspace_1",
      }),
    ).rejects.toBeInstanceOf(AutomaticNumberActivationRepositoryError);
  });

  it("completes with the exact active subscription correlation", async () => {
    const { repository, rpc } = withRpc({
      activated: true,
      activation_id: "activation_1",
      number_id: "number_1",
      product_status: "ready",
      workspace_id: "workspace_1",
    });

    await repository.completePurchasedNumber({
      activationId: "activation_1",
      completedAt: "2026-08-13T16:00:00.000Z",
      numberId: "number_1",
      periodEndsAt: "2026-09-13T16:00:00.000Z",
      periodStartsAt: "2026-08-13T16:00:00.000Z",
      subscriptionId: "subscription_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith("complete_automatic_number_activation", {
      p_activation_id: "activation_1",
      p_completed_at: "2026-08-13T16:00:00.000Z",
      p_number_id: "number_1",
      p_period_end: "2026-09-13T16:00:00.000Z",
      p_period_start: "2026-08-13T16:00:00.000Z",
      p_subscription_id: "subscription_1",
      p_workspace_id: "workspace_1",
    });
  });

  it("records a failed attempt while the product number stays Pending", async () => {
    const { repository, rpc } = withRpc({
      activation_id: "activation_1",
      number_id: "number_1",
      recorded: true,
      workspace_id: "workspace_1",
    });

    await repository.failPurchasedNumber({
      activationId: "activation_1",
      failedAt: "2026-08-13T16:00:00.000Z",
      failureCode: "BILLING_ACTIVATION_FAILED",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "fail_automatic_number_activation",
      expect.objectContaining({
        p_failure_code: "BILLING_ACTIVATION_FAILED",
        p_number_id: "number_1",
      }),
    );
  });
});
