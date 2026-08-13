import "server-only";

import { BillingService } from "@/lib/billing/service";
import { SupabaseBillingRepository } from "@/lib/billing/supabase-repository.server";
import { AutomaticNumberActivationService } from "@/lib/numbers/automatic-activation-service.server";
import { SupabaseAutomaticNumberActivationRepository } from "@/lib/numbers/supabase-automatic-activation-repository.server";
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
 * Number onboarding uses this boundary after the provider purchase is durable
 * and before transitioning the first number to Ready.
 */
export async function ensureWorkspaceSubscriptionActive(
  workspaceId: string,
  promotionCode?: string,
) {
  const priceId = process.env.STRIPE_BASE_PRICE_ID?.trim();
  if (!priceId) throw new Error("Riink billing plan configuration is missing.");
  return billingServiceFromEnvironment().ensureActiveSubscription({
    priceId,
    ...(promotionCode ? { promotionCode } : {}),
    workspaceId,
  });
}

let automaticNumberActivationService: AutomaticNumberActivationService | undefined;

export function automaticNumberActivationServiceFromEnvironment(): AutomaticNumberActivationService {
  automaticNumberActivationService ??= new AutomaticNumberActivationService(
    new SupabaseAutomaticNumberActivationRepository(createServiceRoleClient()),
    ensureWorkspaceSubscriptionActive,
  );
  return automaticNumberActivationService;
}

export { billingSubscriptionServiceFromEnvironment } from "./billing-webhook.server";
