"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadCampaignLaunchContext } from "@/app/(app)/campaigns/data";
import type {
  CampaignActionResult,
  CampaignDraftPayload,
  CampaignRetryActionResult,
  CampaignTestSendActionResult,
} from "@/components/campaigns/types";
import { campaignLaunchConfirmationKey } from "@/lib/campaigns/launch";
import { loadCustomerBillingCapabilities } from "@/lib/billing/customer-capabilities.server";
import type { CampaignLaunchAssessment } from "@/lib/campaigns/types";
import { renderCampaignTemplate, validateCampaignTemplate } from "@/lib/campaigns/templates";
import { validateCampaignSteps } from "@/lib/campaigns/validation";
import { normalizePhoneNumber } from "@/lib/contacts/phone";
import { messagingRuntimeFromEnvironment } from "@/lib/runtime/messaging.server";
import { createClient } from "@/lib/supabase/server";

const stepSchema = z.object({
  body: z.string().max(1600),
  id: z.string().uuid().optional(),
  waitDaysAfterPrevious: z.number().int().min(0).max(365).nullable(),
});

const draftSchema = z.object({
  campaignId: z.string().uuid().nullable(),
  contactIds: z.array(z.string().uuid()),
  name: z.string().trim().min(1).max(160),
  phoneNumberId: z.string().uuid().nullable(),
  steps: z.array(stepSchema).min(1).max(3),
  timezone: z.string().trim().min(1),
  sendWindowStart: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/),
  sendWindowEnd: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/),
  sendingDays: z.array(z.number().int().min(1).max(7)).min(1),
  dripIntervalMinutes: z.number().int().min(1).max(1440),
}).refine(data => {
  return data.sendWindowStart < data.sendWindowEnd;
}, {
  message: "Start time must be before end time",
  path: ["sendWindowStart"],
});

const campaignTestSendSchema = z.object({
  body: z.string().trim().min(1).max(1600),
  phoneNumberId: z.string().uuid(),
  recipientPhoneNumber: z.string().trim().min(1).max(40),
  requestId: z.string().uuid(),
});

function failure(message: string, code?: CampaignActionResult["code"]): CampaignActionResult {
  return { code, message, ok: false };
}

function confirmationRequired(
  assessment: CampaignLaunchAssessment,
): CampaignActionResult {
  return {
    assessment,
    code: "CONFIRM_CAMPAIGN_IMPACT",
    confirmationKey: campaignLaunchConfirmationKey(assessment),
    message: "Review this campaign before launching.",
    ok: false,
  };
}

async function currentWorkspaceId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, workspaceId: null };
  const { data } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle();
  return { supabase, workspaceId: (data?.id as string | undefined) ?? null };
}

export async function saveCampaignDraftAction(payload: CampaignDraftPayload): Promise<CampaignActionResult> {
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return failure("Check the campaign name, messages, and wait times.");
  const validation = validateCampaignSteps(parsed.data.steps);
  if (!validation.valid) return failure("Every message needs valid content and a wait of 1–365 days.");

  const { supabase, workspaceId } = await currentWorkspaceId();
  if (!workspaceId) return failure("Your workspace isn't ready yet.");

  const { data, error } = await supabase.rpc("save_campaign_draft", {
    p_campaign_id: parsed.data.campaignId,
    p_contact_ids: Array.from(new Set(parsed.data.contactIds)),
    p_name: parsed.data.name,
    p_phone_number_id: parsed.data.phoneNumberId,
    p_steps: parsed.data.steps.map((step, index) => ({
      body: step.body,
      step_order: index + 1,
      wait_days_after_previous: index === 0 ? null : step.waitDaysAfterPrevious,
    })),
    p_workspace_id: workspaceId,
    p_timezone: parsed.data.timezone,
    p_send_window_start: parsed.data.sendWindowStart,
    p_send_window_end: parsed.data.sendWindowEnd,
    p_sending_days: parsed.data.sendingDays,
    p_drip_interval_minutes: parsed.data.dripIntervalMinutes,
  });
  if (error) return failure("We couldn't save this campaign. Please try again.");

  const record = data as string | { id?: string } | null;
  const campaignId = typeof record === "string" ? record : record?.id ?? parsed.data.campaignId ?? undefined;
  if (!campaignId) return failure("We couldn't save this campaign. Please try again.");

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);
  return { campaignId, message: "Draft saved.", ok: true, status: "draft" };
}

export async function launchCampaignAction(
  campaignId: string,
  confirmationKey: string | null,
  consentConfirmed: boolean,
): Promise<CampaignActionResult> {
  const parsedId = z.string().uuid().safeParse(campaignId);
  if (!parsedId.success) return failure("This campaign couldn't be found.");
  const parsedConfirmation = z.string().max(256).nullable().safeParse(confirmationKey);
  if (!parsedConfirmation.success) return failure("Review this campaign before launching.");
  if (consentConfirmed !== true) return failure("Confirm that these contacts agreed to receive messages.");

  const context = await loadCampaignLaunchContext(parsedId.data);
  if (!context) return failure("This draft is no longer available.");
  if (!context.campaign.messagingAvailable) {
    return context.campaign.safetyCapReached
      ? failure(
          "Sending is paused because your SMS credit safety limit has been reached.",
          "SAFETY_CAP_REACHED",
        )
      : failure(
          "Messaging is currently unavailable. Check Billing in Settings.",
          "MESSAGING_UNAVAILABLE",
        );
  }
  const readyNumber = context.campaign.phoneNumbers.some(
    (phone) => phone.id === context.campaign.phoneNumberId && phone.status === "ready",
  );
  if (!readyNumber) return failure("This phone number isn't ready for messaging yet.", "NO_READY_NUMBER");

  const assessment = context.assessment;
  if (assessment.eligibleRecipientCount === 0) {
    return failure("No selected contacts are currently eligible.", "NO_ELIGIBLE_RECIPIENTS");
  }

  const currentConfirmationKey = campaignLaunchConfirmationKey(assessment);
  const impactReviewed = parsedConfirmation.data === currentConfirmationKey;
  const confirmedLargeLaunch = assessment.requiresConfirmation && impactReviewed;
  if (!impactReviewed) {
    return confirmationRequired(assessment);
  }

  const { supabase, workspaceId } = await currentWorkspaceId();
  if (!workspaceId) return failure("Your workspace isn't ready yet.");
  const { error } = await supabase.rpc("launch_campaign", {
    p_campaign_id: parsedId.data,
    p_confirmed_assessment: confirmedLargeLaunch
      ? {
          current_effective_usage_credits: assessment.currentEffectiveUsageCredits,
          eligible_recipient_count: assessment.eligibleRecipientCount,
          estimated_first_step_credits: assessment.estimatedFirstStepCredits,
          estimated_maximum_sequence_credits:
            assessment.estimatedMaximumSequenceCredits,
          estimated_maximum_new_overage_credits:
            assessment.estimatedMaximumNewOverageCredits,
          estimated_maximum_additional_charge_micro_usd:
            assessment.estimatedMaximumAdditionalChargeMicroUsd,
          estimated_provider_cost_minimum_micro_usd:
            context.providerCostImpact.minimumMicroUsd,
          estimated_provider_cost_maximum_micro_usd:
            context.providerCostImpact.maximumMicroUsd,
          provider_cost_by_destination:
            context.providerCostImpact.byDestination,
          provider_pricing_complete:
            context.providerCostImpact.pricingComplete,
          maximum_segments_per_message: assessment.maximumSegmentsPerMessage,
          uses_unicode: assessment.usesUnicode,
          estimated_new_overage_credits: assessment.estimatedNewOverageCredits,
          included_credits: assessment.includedCredits,
          included_credits_remaining: assessment.includedCreditsRemaining,
          projected_usage_credits: assessment.projectedUsageCredits,
          reasons: assessment.reasons,
          requires_confirmation: assessment.requiresConfirmation,
        }
      : null,
    p_confirmed_contact_count: assessment.eligibleRecipientCount,
    p_confirmed_large_launch: confirmedLargeLaunch,
    p_consent_confirmed: true,
  });
  if (error) {
    if (impactReviewed) {
      const refreshed = await loadCampaignLaunchContext(parsedId.data);
      if (
        refreshed &&
        campaignLaunchConfirmationKey(refreshed.assessment) !== currentConfirmationKey
      ) {
        return confirmationRequired(refreshed.assessment);
      }
    }
    return failure("We couldn't launch this campaign. Please review it and try again.");
  }

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${parsedId.data}`);
  return { campaignId: parsedId.data, message: "Campaign launched.", ok: true, status: "active" };
}

async function transitionCampaign(
  campaignId: string,
  rpcName: "pause_campaign" | "resume_campaign" | "delete_campaign",
  successMessage: string,
  status?: "active" | "paused",
  requireMessaging = false,
): Promise<CampaignActionResult> {
  const parsedId = z.string().uuid().safeParse(campaignId);
  if (!parsedId.success) return failure("This campaign couldn't be found.");
  const { supabase, workspaceId } = await currentWorkspaceId();
  if (!workspaceId) return failure("Your workspace isn't ready yet.");
  if (requireMessaging) {
    const capabilities = await loadCustomerBillingCapabilities(supabase);
    if (!capabilities.canSendMessages) {
      return capabilities.safetyCapReached
        ? failure(
            "Sending is paused because your SMS credit safety limit has been reached.",
            "SAFETY_CAP_REACHED",
          )
        : failure(
            "Messaging is currently unavailable. Check Billing in Settings.",
            "MESSAGING_UNAVAILABLE",
          );
    }
  }
  const { error } = await supabase.rpc(rpcName, { p_campaign_id: parsedId.data });
  if (error) return failure("We couldn't update this campaign. Please try again.");
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${parsedId.data}`);
  return { campaignId: parsedId.data, message: successMessage, ok: true, status };
}

export async function pauseCampaignAction(campaignId: string) {
  return transitionCampaign(campaignId, "pause_campaign", "Campaign paused.", "paused");
}

export async function resumeCampaignAction(campaignId: string) {
  return transitionCampaign(
    campaignId,
    "resume_campaign",
    "Campaign resumed.",
    "active",
    true,
  );
}

export async function retryFailedCampaignMessagesAction(
  campaignId: string,
): Promise<CampaignRetryActionResult> {
  const parsedId = z.string().uuid().safeParse(campaignId);
  if (!parsedId.success) return { message: "This campaign couldn't be found.", ok: false };

  const { supabase, workspaceId } = await currentWorkspaceId();
  if (!workspaceId) return { message: "Your workspace isn't ready yet.", ok: false };

  const capabilities = await loadCustomerBillingCapabilities(supabase);
  if (!capabilities.canSendMessages) {
    return {
      message: capabilities.safetyCapReached
        ? "Retry is unavailable because your SMS credit safety limit has been reached."
        : "Retry is unavailable. Check Billing in Settings.",
      ok: false,
    };
  }

  const { data, error } = await supabase.rpc("retry_failed_campaign_messages", {
    p_campaign_id: parsedId.data,
    p_now: new Date().toISOString(),
  });
  if (error) {
    return { message: "We couldn't queue these messages. Please try again.", ok: false };
  }

  const result = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {};
  const queuedCount = Number.isSafeInteger(result.queuedCount) && Number(result.queuedCount) >= 0
    ? Number(result.queuedCount)
    : 0;
  const protectedCount = Number.isSafeInteger(result.protectedCount) && Number(result.protectedCount) >= 0
    ? Number(result.protectedCount)
    : 0;

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${parsedId.data}`);

  return {
    message: queuedCount > 0
      ? `${queuedCount} failed ${queuedCount === 1 ? "message" : "messages"} queued. Sending will follow the campaign interval.`
      : "No message can be retried safely. Uncertain or provider-accepted sends stay protected.",
    ok: queuedCount > 0,
    protectedCount,
    queuedCount,
  };
}

export async function deleteCampaignAction(campaignId: string) {
  return transitionCampaign(campaignId, "delete_campaign", "Campaign deleted.");
}

export async function sendCampaignTestMessageAction(input: {
  body: string;
  phoneNumberId: string;
  recipientPhoneNumber: string;
  requestId: string;
}): Promise<CampaignTestSendActionResult> {
  const parsed = campaignTestSendSchema.safeParse(input);
  if (!parsed.success) {
    return { message: "Enter a valid phone number and first message.", ok: false };
  }

  const templateIssues = validateCampaignTemplate(parsed.data.body);
  if (templateIssues.length > 0) {
    return { message: "Fix the variables in the first message before testing it.", ok: false };
  }

  const recipientPhoneE164 = normalizePhoneNumber(parsed.data.recipientPhoneNumber);
  if (!recipientPhoneE164) {
    return { message: "Enter a valid French, US, or Canadian phone number.", ok: false };
  }

  const renderedBody = renderCampaignTemplate(parsed.data.body, {
    company: "Riink",
    firstName: "Test",
    lastName: "Contact",
  }).trim();
  if (!renderedBody) {
    return { message: "The first message is empty after personalization.", ok: false };
  }

  const { supabase, workspaceId } = await currentWorkspaceId();
  if (!workspaceId) return { message: "Your workspace isn't ready yet.", ok: false };

  const capabilities = await loadCustomerBillingCapabilities(supabase);
  if (!capabilities.canSendMessages) {
    return {
      message: capabilities.safetyCapReached
        ? "Sending is paused because your SMS credit safety limit has been reached."
        : "Messaging is currently unavailable. Check Billing in Settings.",
      ok: false,
    };
  }

  const { data, error } = await supabase.rpc("claim_campaign_test_send", {
    p_body: renderedBody,
    p_now: new Date().toISOString(),
    p_phone_number_id: parsed.data.phoneNumberId,
    p_recipient_phone_e164: recipientPhoneE164,
    p_request_id: parsed.data.requestId,
  });
  if (error) {
    return {
      message:
        error.code === "54000"
          ? "You have reached the test send limit. Try again in one hour."
          : "The test message couldn't be sent. Check the sending number and try again.",
      ok: false,
    };
  }

  const claim = Array.isArray(data) ? data[0] : data;
  if (!claim || typeof claim.source_phone_e164 !== "string") {
    return { message: "The test message couldn't be prepared. Please try again.", ok: false };
  }
  if (claim.disposition === "already_claimed") {
    return {
      message: "This test request was already accepted.",
      ok: true,
      phoneNumber: recipientPhoneE164,
    };
  }

  try {
    await messagingRuntimeFromEnvironment().provider.sendMessage({
      body: renderedBody,
      from: claim.source_phone_e164,
      idempotencyKey: parsed.data.requestId,
      messageId: parsed.data.requestId,
      to: recipientPhoneE164,
      workspaceId,
    });
  } catch {
    return {
      message: "Twilio couldn't accept the test message. Check the number and try again.",
      ok: false,
    };
  }

  return {
    message: "Test message accepted for delivery.",
    ok: true,
    phoneNumber: recipientPhoneE164,
  };
}
