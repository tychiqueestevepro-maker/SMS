import "server-only";

import { BillingService } from "@/lib/billing/service";
import { SupabaseBillingRepository } from "@/lib/billing/supabase-repository.server";
import { stripeBillingGatewayFromEnvironment } from "@/lib/providers/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

let service: BillingService | undefined;

export function billingServiceFromEnvironment(): BillingService {
  service ??= new BillingService(
    new SupabaseBillingRepository(createServiceRoleClient()),
    stripeBillingGatewayFromEnvironment(),
  );
  return service;
}

export function billingPublishableKeyFromEnvironment(): string {
  const value = process.env.STRIPE_PUBLISHABLE_KEY?.trim();
  if (!value) throw new Error("Riink billing client configuration is missing.");
  return value;
}

/**
 * Number onboarding uses this boundary before transitioning an approved first
 * number to Ready. The transition must happen only after this promise resolves.
 */
export async function ensureWorkspaceSubscriptionActive(workspaceId: string) {
  const priceId = process.env.STRIPE_BASE_PRICE_ID?.trim();
  if (!priceId) throw new Error("Riink billing plan configuration is missing.");
  return billingServiceFromEnvironment().ensureActiveSubscription({
    priceId,
    workspaceId,
  });
}

export { billingSubscriptionServiceFromEnvironment } from "./billing-webhook.server";
