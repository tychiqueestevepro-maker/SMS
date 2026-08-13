import { NextResponse } from "next/server";

import { getApplicationOrigin } from "@/lib/application-url";
import { logServerEvent } from "@/lib/observability/logger";
import { smsWebhookRuntimeFromEnvironment } from "@/lib/runtime/sms-webhook.server";
import {
  SMS_WEBHOOK_ACKNOWLEDGEMENT,
  SmsWebhookOrchestrator,
  SmsWebhookProcessingError,
} from "@/lib/webhooks/sms/orchestrator";
import { readBoundedSmsWebhookBody } from "@/lib/webhooks/sms/http";
import type { SmsWebhookInternalEvent } from "@/lib/webhooks/sms/types";

export const runtime = "nodejs";
export const maxDuration = 15;

function acknowledge() {
  return NextResponse.json(SMS_WEBHOOK_ACKNOWLEDGEMENT, { status: 200 });
}

function reportInternalEvent(event: SmsWebhookInternalEvent) {
  logServerEvent(
    event.event.includes("failed") || event.event === "signature_rejected"
      ? "warn"
      : "info",
    {
      event: event.event,
      ...(event.workspaceId ? { workspace_id: event.workspaceId } : {}),
      ...(event.providerMessageId
        ? { provider_message_id: event.providerMessageId }
        : {}),
    },
    event.failure
      ? {
          failure_kind: event.failure.kind,
          failure_code: event.failure.providerCode,
        }
      : {},
  );
}

function unavailable(error: unknown) {
  logServerEvent(
    "error",
    { event: "sms_webhook_unavailable" },
    {
      error_code:
        error instanceof SmsWebhookProcessingError
          ? error.code
          : "INTERNAL_UNAVAILABLE",
    },
  );
  return NextResponse.json({ received: false }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedSmsWebhookBody(request);
    if (rawBody === null) return acknowledge();
    const runtimeServices = smsWebhookRuntimeFromEnvironment();
    const normalized = runtimeServices.normalizeRequest({
      rawBody,
      headers: request.headers,
      canonicalUrl: `${getApplicationOrigin()}/api/webhooks/sms`,
      receivedAt: new Date().toISOString(),
    });
    if (!normalized) return acknowledge();

    const orchestrator = new SmsWebhookOrchestrator(
      runtimeServices.repository,
      runtimeServices.provider,
      { reportInternalEvent },
    );
    await orchestrator.handle(normalized);
    return acknowledge();
  } catch (error) {
    return unavailable(error);
  }
}
