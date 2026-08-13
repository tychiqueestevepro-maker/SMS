// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  log: vi.fn(),
  requestCancellation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/observability/logger", () => ({ logServerEvent: mocks.log }));
vi.mock("@/lib/runtime/billing.server", () => ({
  billingPublishableKeyFromEnvironment: vi.fn(),
  billingServiceFromEnvironment: vi.fn(),
  billingSubscriptionServiceFromEnvironment: () => ({
    requestCancellation: mocks.requestCancellation,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { ProductBillingError } from "@/lib/billing/gateway";

import { requestBillingCancellation } from "./billing-actions";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

function authenticatedClient() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            email: "owner@example.com",
            id: "11111111-1111-4111-8111-111111111111",
          },
        },
      }),
    },
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              table === "workspaces"
                ? { id: WORKSPACE_ID }
                : { display_name: "Owner" },
          }),
        })),
      })),
    })),
  };
}

describe("requestBillingCancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue(authenticatedClient());
    mocks.requestCancellation.mockResolvedValue({ alreadyScheduled: false });
  });

  it("derives the workspace from the signed-in user and schedules cancellation", async () => {
    await expect(requestBillingCancellation()).resolves.toEqual({
      alreadyScheduled: false,
      kind: "cancellation",
      message: "Cancellation scheduled.",
      ok: true,
    });

    expect(mocks.requestCancellation).toHaveBeenCalledWith(WORKSPACE_ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
    expect(mocks.log).toHaveBeenCalledWith(
      "info",
      {
        event: "billing_cancellation_action_succeeded",
        workspace_id: WORKSPACE_ID,
      },
    );
  });

  it("is idempotent when cancellation was already scheduled", async () => {
    mocks.requestCancellation.mockResolvedValue({ alreadyScheduled: true });

    await expect(requestBillingCancellation()).resolves.toMatchObject({
      alreadyScheduled: true,
      message: "Cancellation is already scheduled.",
      ok: true,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("does not expose internal cancellation failures", async () => {
    mocks.requestCancellation.mockRejectedValue(
      new ProductBillingError("BILLING_CANCELLATION_FAILED"),
    );

    const result = await requestBillingCancellation();

    expect(result).toEqual({
      code: "BILLING_CANCELLATION_FAILED",
      message: "Cancellation couldn't be scheduled. Please try again later.",
      ok: false,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("subscription_");
  });

  it("requires authentication before accessing billing runtime", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    await expect(requestBillingCancellation()).resolves.toEqual({
      code: "AUTH_REQUIRED",
      message: "Sign in to manage billing.",
      ok: false,
    });
    expect(mocks.requestCancellation).not.toHaveBeenCalled();
  });
});
