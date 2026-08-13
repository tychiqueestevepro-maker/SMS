// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AdminNumberActivationRepositoryError,
  SupabaseAdminNumberActivationRepository,
} from "./supabase-admin-activation-repository.server";

function withRpc(data: unknown) {
  const rpc = vi.fn(async () => ({ data, error: null }));
  return {
    repository: new SupabaseAdminNumberActivationRepository(
      { rpc } as unknown as SupabaseClient,
    ),
    rpc,
  };
}

describe("SupabaseAdminNumberActivationRepository", () => {
  it("claims an exact approved Pending number with an auditable admin ID", async () => {
    const { repository, rpc } = withRpc({
      activation_id: "activation_1",
      disposition: "claimed",
      number_id: "number_1",
      workspace_id: "workspace_1",
    });

    await expect(repository.claimApprovedNumber({
      adminUserId: "admin_1",
      numberId: "number_1",
      requestedAt: "2026-08-10T12:00:00.000Z",
    })).resolves.toEqual({
      activationId: "activation_1",
      disposition: "claimed",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith("admin_claim_approved_number_activation", {
      p_admin_user_id: "admin_1",
      p_number_id: "number_1",
      p_requested_at: "2026-08-10T12:00:00.000Z",
    });
  });

  it("fails closed on a mismatched number correlation", async () => {
    const { repository } = withRpc({
      activation_id: "activation_1",
      disposition: "claimed",
      number_id: "number_other",
      workspace_id: "workspace_1",
    });

    await expect(repository.claimApprovedNumber({
      adminUserId: "admin_1",
      numberId: "number_1",
      requestedAt: "2026-08-10T12:00:00.000Z",
    })).rejects.toBeInstanceOf(AdminNumberActivationRepositoryError);
  });

  it("completes with the exact active subscription period and correlation", async () => {
    const { repository, rpc } = withRpc({
      activated: true,
      activation_id: "activation_1",
      number_id: "number_1",
      product_status: "ready",
      workspace_id: "workspace_1",
    });

    await repository.completeApprovedNumber({
      activationId: "activation_1",
      adminUserId: "admin_1",
      completedAt: "2026-08-10T12:00:00.000Z",
      numberId: "number_1",
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      subscriptionId: "subscription_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "admin_complete_approved_number_activation",
      {
        p_activation_id: "activation_1",
        p_admin_user_id: "admin_1",
        p_completed_at: "2026-08-10T12:00:00.000Z",
        p_number_id: "number_1",
        p_period_end: "2026-09-10T12:00:00.000Z",
        p_period_start: "2026-08-10T12:00:00.000Z",
        p_subscription_id: "subscription_1",
        p_workspace_id: "workspace_1",
      },
    );
  });

  it("records activation failure without changing product state", async () => {
    const { repository, rpc } = withRpc({
      activation_id: "activation_1",
      number_id: "number_1",
      recorded: true,
      workspace_id: "workspace_1",
    });

    await repository.failApprovedNumber({
      activationId: "activation_1",
      adminUserId: "admin_1",
      failedAt: "2026-08-10T12:00:00.000Z",
      failureCode: "BILLING_ACTIVATION_FAILED",
      numberId: "number_1",
      workspaceId: "workspace_1",
    });
    expect(rpc).toHaveBeenCalledWith(
      "admin_fail_approved_number_activation",
      expect.objectContaining({
        p_failure_code: "BILLING_ACTIVATION_FAILED",
        p_number_id: "number_1",
      }),
    );
  });
});
