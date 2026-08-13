import { NextResponse } from "next/server";

import { getApplicationOrigin } from "@/lib/application-url";
import { logServerEvent } from "@/lib/observability/logger";
import {
  messagingRuntimeFromEnvironment,
  numberImportServiceFromEnvironment,
} from "@/lib/runtime/messaging.server";
import {
  normalizeNumberImportWebhookRequest,
  readBoundedNumberImportWebhookBody,
} from "@/lib/webhooks/number-import/http";

export const runtime = "nodejs";
export const maxDuration = 15;

function acknowledge() {
  return NextResponse.json({ received: true }, { status: 200 });
}

function unavailable(code: string) {
  logServerEvent(
    "error",
    { event: "number_import_webhook_unavailable" },
    { error_code: code },
  );
  return NextResponse.json({ received: false }, { status: 503 });
}

export async function POST(request: Request) {
  try {
    const rawBody = await readBoundedNumberImportWebhookBody(request);
    if (rawBody === null) return acknowledge();
    const callback = normalizeNumberImportWebhookRequest({
      headers: request.headers,
      rawBody,
    });
    if (!callback) return acknowledge();

    const imports = numberImportServiceFromEnvironment();
    const context = await imports.getCallbackContext(callback.providerImportId);
    if (!context) return unavailable("CALLBACK_CONTEXT_UNAVAILABLE");

    const verification = await messagingRuntimeFromEnvironment().provider.verifyWebhook({
      workspaceId: context.workspaceId,
      url: `${getApplicationOrigin()}/api/webhooks/number-imports`,
      signature: callback.signature,
      parameters: callback.parameters,
    });
    if (!verification.valid) {
      logServerEvent(
        "warn",
        {
          event: "number_import_webhook_signature_rejected",
          workspace_id: context.workspaceId,
          phone_number_id: context.phoneNumberId,
        },
        {},
      );
      return acknowledge();
    }

    await imports.refreshImport(context);
    logServerEvent(
      "info",
      {
        event: "number_import_webhook_processed",
        workspace_id: context.workspaceId,
        phone_number_id: context.phoneNumberId,
      },
      { provider_status: callback.providerStatus },
    );
    return acknowledge();
  } catch {
    return unavailable("INTERNAL_UNAVAILABLE");
  }
}
