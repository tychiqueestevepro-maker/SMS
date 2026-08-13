// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureSubscription: vi.fn(),
  log: vi.fn(),
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/admin/authorization.server", () => ({
  requireAdminUser: mocks.requireAdmin,
}));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: mocks.log }));
vi.mock("@/lib/runtime/billing.server", () => ({
  ensureWorkspaceSubscriptionActive: mocks.ensureSubscription,
}));
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import { ProductBillingError } from "@/lib/billing/gateway";

import {
  activateApprovedNumberAction,
  approveAndActivatePendingNumberAction,
} from "./actions";

const NUMBER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

describe("activateApprovedNumberAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      email: "operator@riink.app",
      userId: "33333333-3333-4333-8333-333333333333",
    });
    mocks.ensureSubscription.mockResolvedValue({
      active: true,
      periodEndsAt: "2026-09-10T12:00:00.000Z",
      periodStartsAt: "2026-08-10T12:00:00.000Z",
      subscriptionId: "subscription_1",
    });
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "admin_confirm_workspace_advanced_opt_out") {
        return {
          data: {
            confirmed: true,
            workspace_id: WORKSPACE_ID,
          },
          error: null,
        };
      }
      if (name === "admin_record_phone_number_setup_state") {
        return {
          data: {
            activation_eligible: true,
            number_id: NUMBER_ID,
            recorded: true,
            setup_state: "approved",
            workspace_id: WORKSPACE_ID,
          },
          error: null,
        };
      }
      if (name === "admin_claim_approved_number_activation") {
        return {
          data: {
            activation_id: "activation_1",
            disposition: "claimed",
            number_id: NUMBER_ID,
            workspace_id: WORKSPACE_ID,
          },
          error: null,
        };
      }
      if (name === "admin_complete_approved_number_activation") {
        return {
          data: {
            activated: true,
            activation_id: "activation_1",
            number_id: NUMBER_ID,
            product_status: "ready",
            workspace_id: WORKSPACE_ID,
          },
          error: null,
        };
      }
      if (name === "admin_fail_approved_number_activation") {
        return {
          data: {
            activation_id: "activation_1",
            number_id: NUMBER_ID,
            recorded: true,
            workspace_id: WORKSPACE_ID,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
  });

  it("rechecks admin authorization inside the Server Action", async () => {
    mocks.requireAdmin.mockRejectedValue(new Error("not authorized"));

    await expect(activateApprovedNumberAction(NUMBER_ID)).rejects.toThrow(
      "not authorized",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.ensureSubscription).not.toHaveBeenCalled();
  });

  it("activates only after billing and the correlated completion RPC succeed", async () => {
    await expect(activateApprovedNumberAction(NUMBER_ID)).resolves.toEqual({
      message: "Phone number activated.",
      ok: true,
    });
    expect(mocks.ensureSubscription).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_claim_approved_number_activation",
      "admin_complete_approved_number_activation",
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });

  it("does not call billing when the number is not approved", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        activation_id: null,
        disposition: "not_approved",
        number_id: NUMBER_ID,
        workspace_id: WORKSPACE_ID,
      },
      error: null,
    });

    await expect(activateApprovedNumberAction(NUMBER_ID)).resolves.toMatchObject({
      code: "NUMBER_NOT_APPROVED",
      ok: false,
    });
    expect(mocks.ensureSubscription).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps Pending and records only a stable failure code when billing fails", async () => {
    mocks.ensureSubscription.mockRejectedValue(
      new ProductBillingError("BILLING_ACTIVATION_FAILED"),
    );

    const result = await activateApprovedNumberAction(NUMBER_ID);
    expect(result).toEqual({
      code: "NUMBER_ACTIVATION_FAILED",
      message: "The phone number couldn't be activated. It remains Pending.",
      ok: false,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_claim_approved_number_activation",
      "admin_fail_approved_number_activation",
    ]);
    expect(JSON.stringify(result)).not.toContain("BILLING_ACTIVATION_FAILED");
  });

  it("records explicit setup approval before billing-backed activation", async () => {
    await expect(
      approveAndActivatePendingNumberAction(NUMBER_ID, WORKSPACE_ID),
    ).resolves.toEqual({ message: "Phone number activated.", ok: true });

    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_confirm_workspace_advanced_opt_out",
      "admin_record_phone_number_setup_state",
      "admin_claim_approved_number_activation",
      "admin_complete_approved_number_activation",
    ]);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "admin_record_phone_number_setup_state",
      expect.objectContaining({
        p_a2p_state: "approved",
        p_admin_user_id: "33333333-3333-4333-8333-333333333333",
        p_next_state: "approved",
        p_phone_number_id: NUMBER_ID,
        p_workspace_id: WORKSPACE_ID,
      }),
    );
    expect(mocks.ensureSubscription).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("never reaches billing when approval persistence fails", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { confirmed: true, workspace_id: WORKSPACE_ID },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "SETUP_NOT_APPROVABLE", message: "internal detail" },
      });

    await expect(
      approveAndActivatePendingNumberAction(NUMBER_ID, WORKSPACE_ID),
    ).resolves.toEqual({
      code: "NUMBER_APPROVAL_FAILED",
      message: "Number setup couldn't be approved.",
      ok: false,
    });
    expect(mocks.ensureSubscription).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("never approves setup or reaches billing when compliance confirmation fails", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "COMPLIANCE_NOT_CONFIRMED", message: "internal detail" },
    });

    await expect(
      approveAndActivatePendingNumberAction(NUMBER_ID, WORKSPACE_ID),
    ).resolves.toEqual({
      code: "MESSAGING_COMPLIANCE_CONFIRMATION_FAILED",
      message: "Messaging compliance setup couldn't be confirmed.",
      ok: false,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_confirm_workspace_advanced_opt_out",
    ]);
    expect(mocks.ensureSubscription).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps an approved number Pending when billing activation fails", async () => {
    mocks.ensureSubscription.mockRejectedValue(
      new ProductBillingError("BILLING_ACTIVATION_FAILED"),
    );

    const result = await approveAndActivatePendingNumberAction(
      NUMBER_ID,
      WORKSPACE_ID,
    );

    expect(result).toMatchObject({
      code: "NUMBER_ACTIVATION_FAILED",
      ok: false,
    });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "admin_confirm_workspace_advanced_opt_out",
      "admin_record_phone_number_setup_state",
      "admin_claim_approved_number_activation",
      "admin_fail_approved_number_activation",
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin");
  });
});
