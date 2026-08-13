"use server";

import { revalidatePath } from "next/cache";

import type {
  BillingActivationActionResult,
  BillingActionFailure,
  BillingCancellationActionResult,
  BillingPortalActionResult,
  BillingSetupActionResult,
} from "@/components/billing/types";
import { getApplicationOrigin } from "@/lib/application-url";
import { ProductBillingError } from "@/lib/billing/gateway";
import {
  isConfiguredExistingNumberOwner,
} from "@/lib/numbers/configured-existing-number.server";
import { SupabaseBillingRuntimeRepository } from "@/lib/billing/supabase-runtime-repository.server";
import { logServerEvent } from "@/lib/observability/logger";
import {
  billingPublishableKeyFromEnvironment,
  billingServiceFromEnvironment,
  billingSubscriptionServiceFromEnvironment,
  ensureWorkspaceSubscriptionActive,
} from "@/lib/runtime/billing.server";
import { stripeBillingGatewayFromEnvironment } from "@/lib/providers/stripe/server";
import { configuredNumberServiceFromEnvironment } from "@/lib/runtime/messaging.server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";


type BillingActionContext = {
  ownerEmail: string;
  ownerName: string | null;
  ownerUserId: string;
  workspaceId: string;
};

function failure(message = "Billing setup is temporarily unavailable. Please try again later."): BillingActionFailure {
  return { code: "BILLING_SESSION_UNAVAILABLE", message, ok: false };
}

async function authenticatedBillingContext(): Promise<BillingActionContext | BillingActionFailure> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      code: "AUTH_REQUIRED",
      message: "Sign in to manage billing.",
      ok: false,
    };
  }
  const [{ data: workspace }, { data: profile }] = await Promise.all([
    supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const email = user.email || (user.phone ? `${user.phone}@riink.app` : null);
  if (!workspace?.id || !email) {
    console.error("authenticatedBillingContext failed:", {
      workspaceId: workspace?.id,
      hasEmail: !!user.email,
      hasPhone: !!user.phone,
    });
    return failure("User email or phone is required for billing.");
  }
  return {
    ownerEmail: email,
    ownerName: typeof profile?.display_name === "string" ? profile.display_name : null,
    ownerUserId: user.id,
    workspaceId: workspace.id as string,
  };
}

export async function activateConfiguredAccountSubscription(): Promise<BillingActivationActionResult> {
  const context = await authenticatedBillingContext();
  if ("ok" in context) return context;
  if (
    !isConfiguredExistingNumberOwner({
      email: context.ownerEmail,
      userId: context.ownerUserId,
    })
  ) {
    return {
      code: "BILLING_ACTIVATION_FAILED",
      message: "This subscription cannot be activated directly.",
      ok: false,
    };
  }

  try {
    await configuredNumberServiceFromEnvironment().connect(context.workspaceId);
    await ensureWorkspaceSubscriptionActive(context.workspaceId);
    logServerEvent(
      "info",
      {
        event: "configured_account_subscription_activated",
        workspace_id: context.workspaceId,
      },
    );
    revalidatePath("/settings");
    return {
      kind: "activation",
      message: "Your Riink subscription is active.",
      ok: true,
    };
  } catch (error) {
    const productError =
      error instanceof ProductBillingError
        ? error
        : new ProductBillingError("BILLING_ACTIVATION_FAILED");
    return {
      code: "BILLING_ACTIVATION_FAILED",
      message: productError.message,
      ok: false,
    };
  }
}

export async function createBillingSetupSession(): Promise<BillingSetupActionResult> {
  const context = await authenticatedBillingContext();
  if ("ok" in context) return context;
  try {
    const setup = await billingServiceFromEnvironment().startPaymentSetup({
      ownerEmail: context.ownerEmail,
      ownerName: context.ownerName,
      requestId: crypto.randomUUID(),
      workspaceId: context.workspaceId,
    });
    const pubKey = billingPublishableKeyFromEnvironment();
    console.log("createBillingSetupSession SUCCESS:", {
      clientSecret: setup.clientSecret ? "***" : "EMPTY",
      publishableKey: pubKey ? "***" : "EMPTY",
      setupIntentId: setup.setupIntentId
    });
    return {
      clientSecret: setup.clientSecret,
      kind: "setup",
      ok: true,
      publishableKey: pubKey,
    };
  } catch (error) {
    console.error("Error in createBillingSetupSession:", error);
    return failure(
      error instanceof Error ? error.message : "An unknown error occurred"
    );
  }
}

export async function createBillingPortalSession(): Promise<BillingPortalActionResult> {
  const context = await authenticatedBillingContext();
  if ("ok" in context) return context;
  try {
    const portal = await billingServiceFromEnvironment().createPortalSession(
      context.workspaceId,
      `${getApplicationOrigin()}/settings`,
    );
    return { kind: "portal", ok: true, redirectUrl: portal.url };
  } catch (error) {
    return failure(
      error instanceof ProductBillingError
        ? error.message
        : "Billing settings couldn't be opened. Please try again later.",
    );
  }
}

export async function requestBillingCancellation(): Promise<BillingCancellationActionResult> {
  const context = await authenticatedBillingContext();
  if ("ok" in context) return context;

  try {
    const result = await billingSubscriptionServiceFromEnvironment().requestCancellation(
      context.workspaceId,
    );
    logServerEvent(
      "info",
      {
        event: result.alreadyScheduled
          ? "billing_cancellation_action_replayed"
          : "billing_cancellation_action_succeeded",
        workspace_id: context.workspaceId,
      },
    );
    revalidatePath("/settings");
    return {
      alreadyScheduled: result.alreadyScheduled,
      kind: "cancellation",
      message: result.alreadyScheduled
        ? "Cancellation is already scheduled."
        : "Cancellation scheduled.",
      ok: true,
    };
  } catch (error) {
    const productError =
      error instanceof ProductBillingError
        ? error
        : new ProductBillingError("BILLING_CANCELLATION_FAILED");
    logServerEvent(
      "error",
      {
        event: "billing_cancellation_action_failed",
        workspace_id: context.workspaceId,
      },
      { failure_code: productError.code },
    );
    return {
      code: "BILLING_CANCELLATION_FAILED",
      message: productError.message,
      ok: false,
    };
  }
}

export type ConfirmPaymentSetupResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Called immediately after stripe.confirmSetup() on the client.
 * Retrieves the confirmed SetupIntent from Stripe and saves the payment method
 * directly to our DB — without waiting for the async webhook.
 * This guarantees defaultPaymentMethodId is set before ensureActiveSubscription runs.
 */
export async function confirmPaymentSetupAction(
  setupIntentId: string,
): Promise<ConfirmPaymentSetupResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Sign in to confirm payment." };

    const gateway = stripeBillingGatewayFromEnvironment();
    const intent = await gateway.retrieveConfirmedSetupIntent(setupIntentId);

    const repository = new SupabaseBillingRuntimeRepository(createServiceRoleClient());

    // applyPaymentMethodSaved is idempotent: calling it directly mirrors what
    // the webhook does, but synchronously — no timing dependency.
    await repository.applyPaymentMethodSaved({
      claimToken: `direct:${setupIntentId}`,
      customerId: intent.customerId,
      eventId: `direct:${setupIntentId}`,
      occurredAt: new Date().toISOString(),
      paymentMethodId: intent.paymentMethodId,
      setupIntentId,
      workspaceIdHint: intent.workspaceId,
    });

    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Payment method could not be confirmed. Please try again.",
    };
  }
}
  
export async function updateSafetyCapAction(credits: number): Promise<{ ok: boolean; message?: string }> {
  const context = await authenticatedBillingContext();
  if ("ok" in context) return { ok: false, message: context.message };

  const adminClient = createServiceRoleClient();
  const { error } = await adminClient.rpc("admin_set_workspace_safety_cap", {
    p_safety_cap_credits: credits,
    p_workspace_id: context.workspaceId,
  });

  if (error) {
    console.error("Failed to update safety cap:", error);
    return { ok: false, message: error.message };
  }

  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}
