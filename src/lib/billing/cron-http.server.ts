import "server-only";

import { logServerEvent } from "@/lib/observability/logger";
import { isAuthorizedCronRequest } from "@/lib/runtime/cron-auth.server";

export interface BillingGraceExpirationService {
  expireGracePeriods(limit?: number): Promise<{ expiredCount: number }>;
}

export interface BillingCronRuntime {
  service: () => BillingGraceExpirationService;
}

const GRACE_EXPIRATION_BATCH_SIZE = 250;

export async function processBillingCronRequest(
  request: Request,
  runtime: BillingCronRuntime,
  configuredSecret = process.env.CRON_SECRET,
): Promise<Response> {
  if (
    !isAuthorizedCronRequest(
      request.headers.get("authorization"),
      configuredSecret,
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runtime.service().expireGracePeriods(
      GRACE_EXPIRATION_BATCH_SIZE,
    );
    logServerEvent(
      "info",
      { event: "billing_cron_completed" },
      { expired_grace_periods: result.expiredCount },
    );
    return Response.json({ expiredGracePeriods: result.expiredCount });
  } catch (error) {
    const failureCode =
      error &&
      typeof error === "object" &&
      "operation" in error &&
      typeof (error as { operation?: unknown }).operation === "string"
        ? (error as { operation: string }).operation
        : "billing_maintenance_failed";
    logServerEvent(
      "error",
      { event: "billing_cron_failed" },
      { failure_code: failureCode },
    );
    return Response.json(
      { error: "Billing maintenance couldn't be completed." },
      { status: 503 },
    );
  }
}
