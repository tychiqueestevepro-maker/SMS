import { processBillingCronRequest } from "@/lib/billing/cron-http.server";
import { billingSubscriptionServiceFromEnvironment } from "@/lib/runtime/billing-webhook.server";

export const maxDuration = 30;
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return processBillingCronRequest(request, {
    service: billingSubscriptionServiceFromEnvironment,
  });
}
