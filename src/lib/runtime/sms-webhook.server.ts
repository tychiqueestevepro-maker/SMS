import "server-only";

import type { SmsProvider } from "@/lib/messaging/provider";
import { normalizeTwilioSmsWebhookRequest } from "@/lib/providers/twilio/webhook";
import type { NormalizeSmsWebhookHttpRequest } from "@/lib/webhooks/sms/http";
import type { SmsWebhookRepository } from "@/lib/webhooks/sms/repository";
import { SupabaseSmsWebhookRepository } from "@/lib/webhooks/sms/supabase-repository";

import { messagingRuntimeFromEnvironment } from "./messaging.server";
import { createServiceRoleClient } from "../supabase/service-role";

export type SmsWebhookRuntime = Readonly<{
  provider: SmsProvider;
  normalizeRequest: NormalizeSmsWebhookHttpRequest;
  repository: SmsWebhookRepository;
}>;

let runtime: SmsWebhookRuntime | undefined;

/** Keeps the application route independent from the active SMS adapter. */
export function smsWebhookRuntimeFromEnvironment(): SmsWebhookRuntime {
  if (runtime) return runtime;
  runtime = Object.freeze({
    provider: messagingRuntimeFromEnvironment().provider,
    normalizeRequest: normalizeTwilioSmsWebhookRequest,
    repository: new SupabaseSmsWebhookRepository(createServiceRoleClient()),
  });
  return runtime;
}

