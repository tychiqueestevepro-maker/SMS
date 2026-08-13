import "server-only";

import { BillingSubscriptionService } from "@/lib/billing/subscription-service";
import { SupabaseBillingRuntimeRepository } from "@/lib/billing/supabase-runtime-repository.server";
import {
  BillingWebhookService,
  type BillingWebhookInternalEvent,
} from "@/lib/billing/webhook-service";
import { logServerEvent } from "@/lib/observability/logger";
import { stripeBillingGatewayFromEnvironment } from "@/lib/providers/stripe/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export interface BillingWebhookRuntime {
  service: BillingWebhookService;
  webhookSecret: string;
}

let runtime: BillingWebhookRuntime | undefined;
let subscriptionService: BillingSubscriptionService | undefined;

function reportInternalEvent(event: BillingWebhookInternalEvent): void {
  const level = event.event.includes("failed")
    ? "error"
    : event.event.includes("busy")
      ? "warn"
      : "info";
  logServerEvent(
    level,
    {
      event: event.event,
      stripe_event_id: event.stripeEventId,
      ...(event.workspaceId ? { workspace_id: event.workspaceId } : {}),
    },
    event.details ? { ...event.details } : {},
  );
}

function repositoryFromEnvironment(): SupabaseBillingRuntimeRepository {
  return new SupabaseBillingRuntimeRepository(createServiceRoleClient());
}

export function billingWebhookRuntimeFromEnvironment(): BillingWebhookRuntime {
  if (runtime) return runtime;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    throw new Error("Riink billing webhook configuration is missing.");
  }
  runtime = Object.freeze({
    service: new BillingWebhookService(
      repositoryFromEnvironment(),
      stripeBillingGatewayFromEnvironment(),
      { reportInternalEvent },
    ),
    webhookSecret,
  });
  return runtime;
}

export function billingSubscriptionServiceFromEnvironment(): BillingSubscriptionService {
  subscriptionService ??= new BillingSubscriptionService(
    repositoryFromEnvironment(),
    stripeBillingGatewayFromEnvironment(),
    {
      reportInternalEvent: (event) => {
        logServerEvent(
          event.event.includes("failed") ? "error" : "info",
          {
            event: event.event,
            ...(event.workspaceId ? { workspace_id: event.workspaceId } : {}),
          },
          event.details ? { ...event.details } : {},
        );
      },
    },
  );
  return subscriptionService;
}
