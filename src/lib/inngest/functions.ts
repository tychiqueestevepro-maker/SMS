import "server-only";

import { cron } from "inngest";

import { runBillingMaintenance } from "@/lib/billing/cron-http.server";
import { inngest } from "@/lib/inngest/client";
import { billingSubscriptionServiceFromEnvironment } from "@/lib/runtime/billing-webhook.server";
import {
  runMessagingMaintenance,
  type MessagingMaintenanceResult,
} from "@/lib/runtime/messaging-maintenance.server";

export const MESSAGING_MAINTENANCE_CRON = "*/3 * * * *";
export const BILLING_MAINTENANCE_CRON = "0 * * * *";

interface MessagingMaintenanceStep {
  run(
    id: string,
    action: () => Promise<MessagingMaintenanceResult>,
  ): Promise<MessagingMaintenanceResult>;
}

interface BillingMaintenanceStep {
  run(
    id: string,
    action: () => Promise<{ expiredGracePeriods: number }>,
  ): Promise<{ expiredGracePeriods: number }>;
}

export async function handleScheduledMessaging(
  step: MessagingMaintenanceStep,
  run = runMessagingMaintenance,
): Promise<MessagingMaintenanceResult> {
  return step.run("run-messaging-maintenance", run);
}

export async function handleScheduledBilling(
  step: BillingMaintenanceStep,
  run = () =>
    runBillingMaintenance({
      service: billingSubscriptionServiceFromEnvironment,
    }),
): Promise<{ expiredGracePeriods: number }> {
  return step.run("run-billing-maintenance", run);
}

export const scheduledMessagingMaintenance = inngest.createFunction(
  {
    id: "scheduled-messaging-maintenance",
    name: "Messaging maintenance",
    triggers: [cron(MESSAGING_MAINTENANCE_CRON)],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => handleScheduledMessaging(step),
);

export const scheduledBillingMaintenance = inngest.createFunction(
  {
    id: "scheduled-billing-maintenance",
    name: "Billing maintenance",
    triggers: [cron(BILLING_MAINTENANCE_CRON)],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => handleScheduledBilling(step),
);

export const inngestFunctions = [
  scheduledMessagingMaintenance,
  scheduledBillingMaintenance,
];
