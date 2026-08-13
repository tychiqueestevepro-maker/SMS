import { processBillingWebhookRequest } from "@/lib/billing/webhook-http";
import { logServerEvent } from "@/lib/observability/logger";
import { billingWebhookRuntimeFromEnvironment } from "@/lib/runtime/billing-webhook.server";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await processBillingWebhookRequest(
      request,
      billingWebhookRuntimeFromEnvironment(),
    );
    if (response.status >= 400) {
      logServerEvent(
        response.status >= 500 ? "error" : "warn",
        { event: "billing_webhook_rejected" },
        { http_status: response.status },
      );
    }
    return response;
  } catch {
    logServerEvent("error", { event: "billing_webhook_runtime_unavailable" });
    return Response.json({ received: false }, { status: 503 });
  }
}
