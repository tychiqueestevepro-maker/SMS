import "server-only";

import { getApplicationOrigin } from "@/lib/application-url";
import { DispatchReconciler } from "@/lib/dispatch/reconciliation";
import {
  InboundMessageReconciler,
  type InboundReconciliationLogEvent,
} from "@/lib/dispatch/inbound-reconciliation";
import { SupabaseInboundReconciliationRepository } from "@/lib/dispatch/supabase-inbound-reconciliation.server";
import { SupabaseDispatchRepository } from "@/lib/dispatch/supabase-repository";
import type { DispatchLogEvent } from "@/lib/dispatch/types";
import { DispatchWorker } from "@/lib/dispatch/worker";
import { logServerEvent } from "@/lib/observability/logger";
import { messagingRuntimeFromEnvironment } from "@/lib/runtime/messaging.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const MAX_DISPATCH_PER_RUN = 50;
const MAX_RECONCILIATIONS_PER_RUN = 50;
const MAX_INBOUND_RECONCILIATIONS_PER_RUN = 50;

export interface MessagingMaintenanceResult {
  dispatched: number;
  inboundReconciled: number;
  reconciled: number;
}

export class MessagingMaintenanceError extends Error {
  readonly code = "MESSAGING_MAINTENANCE_FAILED";

  constructor() {
    super("Messaging maintenance could not be completed.");
    this.name = "MessagingMaintenanceError";
  }
}

function workerId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function structuredDispatchLogger(event: DispatchLogEvent) {
  const {
    event: eventName,
    workspace_id,
    campaign_id,
    campaign_recipient_id,
    contact_id,
    message_id,
    provider_message_id,
    dispatch_state,
    timestamp: sourceTimestamp,
    ...details
  } = event;
  logServerEvent(
    eventName.includes("failed") || eventName.includes("unknown")
      ? "warn"
      : "info",
    {
      event: eventName,
      ...(workspace_id ? { workspace_id } : {}),
      ...(campaign_id ? { campaign_id } : {}),
      ...(campaign_recipient_id ? { campaign_recipient_id } : {}),
      ...(contact_id ? { contact_id } : {}),
      ...(message_id ? { message_id } : {}),
      ...(provider_message_id ? { provider_message_id } : {}),
      ...(dispatch_state ? { dispatch_state } : {}),
    },
    { source_timestamp: sourceTimestamp, ...details },
  );
}

function structuredInboundReconciliationLogger(
  event: InboundReconciliationLogEvent,
) {
  const {
    event: eventName,
    workspace_id,
    message_id,
    provider_message_id,
    timestamp: sourceTimestamp,
    ...details
  } = event;
  logServerEvent(
    eventName.includes("failed") ? "warn" : "info",
    {
      event: eventName,
      workspace_id,
      message_id,
      provider_message_id,
    },
    { source_timestamp: sourceTimestamp, ...details },
  );
}

/**
 * Runs one bounded, idempotent messaging maintenance batch. Both the protected
 * operator route and Inngest call this function directly.
 */
export async function runMessagingMaintenance(): Promise<MessagingMaintenanceResult> {
  try {
    const runtime = messagingRuntimeFromEnvironment();
    const repository = new SupabaseDispatchRepository(
      createServiceRoleClient(),
      {
        providerName: runtime.providerName,
        statusCallbackUrl: `${getApplicationOrigin()}/api/webhooks/sms`,
      },
    );
    const dispatchWorker = new DispatchWorker(repository, runtime.provider, {
      logger: structuredDispatchLogger,
      workerId: workerId("dispatch"),
    });
    const reconciler = new DispatchReconciler(repository, runtime.provider, {
      logger: structuredDispatchLogger,
      workerId: workerId("reconciliation"),
    });
    const inboundReconciler = new InboundMessageReconciler(
      new SupabaseInboundReconciliationRepository(createServiceRoleClient(), {
        providerName: runtime.providerName,
      }),
      runtime.provider,
      {
        logger: structuredInboundReconciliationLogger,
        workerId: workerId("inbound-reconciliation"),
      },
    );

    let dispatched = 0;
    for (let index = 0; index < MAX_DISPATCH_PER_RUN; index += 1) {
      const result = await dispatchWorker.runOnce();
      if (result.outcome === "idle") break;
      dispatched += 1;
      if (result.outcome === "blocked") break;
    }

    let reconciled = 0;
    for (let index = 0; index < MAX_RECONCILIATIONS_PER_RUN; index += 1) {
      const result = await reconciler.runOnce();
      if (result.outcome === "idle") break;
      reconciled += 1;
    }

    let inboundReconciled = 0;
    for (
      let index = 0;
      index < MAX_INBOUND_RECONCILIATIONS_PER_RUN;
      index += 1
    ) {
      const result = await inboundReconciler.runOnce();
      if (result.outcome === "idle") break;
      inboundReconciled += 1;
    }

    return { dispatched, inboundReconciled, reconciled };
  } catch {
    logServerEvent(
      "error",
      { event: "messaging_cron_failed" },
      { failure_code: "MESSAGING_MAINTENANCE_FAILED" },
    );
    throw new MessagingMaintenanceError();
  }
}
