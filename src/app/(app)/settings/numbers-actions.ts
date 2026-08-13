"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadNumberServerContext } from "@/app/(app)/settings/numbers-data";
import type { NumberActionResult } from "@/components/numbers/types";
import { ProductMessagingError } from "@/lib/messaging/errors";
import { assertUsAreaCode } from "@/lib/numbers/area-code";
import { parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";
import {
  canConnectConfiguredExistingNumber,
  CONFIGURED_EXISTING_NUMBER,
} from "@/lib/numbers/configured-existing-number.server";
import { validateBusinessVerification, type BusinessVerificationInput } from "@/lib/numbers/business";
import { NumberProductError } from "@/lib/numbers/errors";
import { evaluateNumberCapacity, evaluateNumberRemoval } from "@/lib/numbers/policy";
import {
  configuredNumberServiceFromEnvironment,
  numberProvisioningServiceFromEnvironment,
  numberImportServiceFromEnvironment,
} from "@/lib/runtime/messaging.server";

function failure(error: unknown): NumberActionResult {
  if (error instanceof NumberProductError || error instanceof ProductMessagingError) {
    return { code: error.code, message: error.message, ok: false };
  }
  const safe = new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
  return { code: safe.code, message: safe.message, ok: false };
}

export async function searchAvailableNumbersAction(
  countryCodeInput: "US" | "CA" | "FR",
  areaCodeInput: string,
  requestIdInput: string,
): Promise<NumberActionResult> {
  try {
    const countryCode = z.enum(["US", "CA", "FR"]).parse(countryCodeInput);
    const areaCode = countryCode !== "FR" ? assertUsAreaCode(areaCodeInput) : undefined;
    const requestId = z.string().uuid().parse(requestIdInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    const candidates = await numberProvisioningServiceFromEnvironment().searchNumbers({
      areaCode,
      countryCode,
      limit: 10,
      requestId,
      workspaceId: context.workspaceId,
    });
    return {
      candidates,
      message: candidates.length
        ? "Choose a phone number."
        : countryCode === "FR"
          ? "No French SMS numbers are currently available."
          : countryCode === "CA"
            ? "No Canadian SMS numbers were found for this area code."
          : "No phone numbers were found for this area code.",
      ok: true,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function connectConfiguredExistingNumberAction(): Promise<NumberActionResult> {
  try {
    const context = await loadNumberServerContext();
    if (
      !context ||
      !canConnectConfiguredExistingNumber({
        email: context.ownerEmail,
        userId: context.ownerUserId,
      })
    ) {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
    if (!context.numberAcquisitionAllowed) {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
    const capacity = evaluateNumberCapacity(context.records, {
      maxPhoneNumbers: context.maxPhoneNumbers,
    });
    if (!capacity.allowed) throw new NumberProductError("PHONE_NUMBER_LIMIT_REACHED");

    await configuredNumberServiceFromEnvironment().connect(context.workspaceId);
    revalidatePath("/settings");
    revalidatePath("/campaigns");
    revalidatePath("/campaigns/new");
    return {
      message: "Your French number is connected and ready to use.",
      ok: true,
      phoneNumber: CONFIGURED_EXISTING_NUMBER.phoneNumber,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function startNumberOnboardingAction(
  selectionIdInput: string,
  businessInput: BusinessVerificationInput,
): Promise<NumberActionResult> {
  try {
    const selectionId = z.string().trim().min(1).max(2_000).parse(selectionIdInput);
    const verification = validateBusinessVerification(businessInput);
    if (!verification.valid) {
      return {
        code: "NUMBER_SETUP_INVALID",
        fieldErrors: Array.from(new Set(verification.issues.map((issue) => issue.field))),
        message: "Some business verification details need your attention.",
        ok: false,
      };
    }

    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    if (!context.paymentMethodSaved) throw new NumberProductError("PAYMENT_METHOD_REQUIRED");
    if (!context.numberAcquisitionAllowed) {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
    const capacity = evaluateNumberCapacity(context.records, { maxPhoneNumbers: context.maxPhoneNumbers });
    if (!capacity.allowed) throw new NumberProductError("PHONE_NUMBER_LIMIT_REACHED");

    await numberProvisioningServiceFromEnvironment().startNumberOnboarding({
      businessVerification: verification.value,
      selectionToken: selectionId,
      workspaceId: context.workspaceId,
    });

    revalidatePath("/settings");
    revalidatePath("/campaigns/new");
    return { message: "Number setup started.", ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function removePhoneNumberAction(phoneNumberIdInput: string): Promise<NumberActionResult> {
  try {
    const phoneNumberId = z.string().uuid().parse(phoneNumberIdInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    const record = context.records.find((number) => number.id === phoneNumberId);
    if (
      record?.phoneNumber === CONFIGURED_EXISTING_NUMBER.phoneNumber &&
      canConnectConfiguredExistingNumber({
        email: context.ownerEmail,
        userId: context.ownerUserId,
      })
    ) {
      throw new NumberProductError("CONNECTED_NUMBER_CANNOT_BE_REMOVED");
    }

    const { data: campaignData } = await context.supabase
      .from("campaigns")
      .select("id,phone_number_id,status")
      .eq("workspace_id", context.workspaceId)
      .eq("phone_number_id", phoneNumberId)
      .is("deleted_at", null);
    const removal = evaluateNumberRemoval(
      phoneNumberId,
      (campaignData ?? []).map((campaign) => ({
        id: campaign.id as string,
        phoneNumberId: campaign.phone_number_id as string,
        state: campaign.status as "draft" | "active" | "paused" | "finished" | "deleted",
      })),
    );
    if (!removal.allowed) throw new NumberProductError("PHONE_NUMBER_IN_ACTIVE_CAMPAIGN");

    await numberProvisioningServiceFromEnvironment().releaseNumber({
      phoneNumberId,
      workspaceId: context.workspaceId,
    });

    revalidatePath("/settings");
    revalidatePath("/campaigns");
    return { message: "Phone number removed.", ok: true };
  } catch (error) {
    return failure(error);
  }
}

/** Step 1 of import flow: verify the number is eligible and return an eligibility token. */
export async function checkNumberImportEligibilityAction(
  phoneNumberInput: string,
  countryCode: "US" | "CA" | "FR" = "US",
): Promise<NumberActionResult> {
  try {
    const phoneNumber = z.string().trim().min(1).max(25).parse(phoneNumberInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");

    if (countryCode === "FR") {
      const normalized = parseAndNormalizePhoneNumber(phoneNumber);
      if (!normalized || normalized.countryCode !== "FR") {
        throw new NumberProductError("INVALID_IMPORT_PHONE_NUMBER");
      }
      return {
        countryCode: "FR",
        manualImport: true,
        message: "This French number can be submitted for manual porting review.",
        ok: true,
        phoneNumber: normalized.phoneE164,
      };
    }

    const result = await numberImportServiceFromEnvironment().checkEligibility({
      countryCode,
      phoneNumber,
      requestId: crypto.randomUUID(),
      workspaceId: context.workspaceId,
    });
    if (!result.eligible) {
      return {
        code: "NUMBER_IMPORT_NOT_ELIGIBLE",
        message: "This number is not eligible for import to Riink.",
        ok: false,
        phoneNumber: result.phoneNumber,
      };
    }
    return {
      eligibilityToken: result.eligibilityToken ?? undefined,
      message: "This number is eligible for import.",
      ok: true,
      phoneNumber: result.phoneNumber,
    };
  } catch (error) {
    return failure(error);
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!,
  );
}

async function sendPortingEmail(
  apiKey: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<Response> {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

/** Creates a support-backed manual porting request because Hosted Numbers only supports US/CA. */
export async function requestFrenchNumberImportAction(
  phoneNumberInput: string,
  ownerEmailInput: string,
): Promise<NumberActionResult> {
  try {
    const normalized = parseAndNormalizePhoneNumber(
      z.string().trim().min(1).max(25).parse(phoneNumberInput),
    );
    if (!normalized || normalized.countryCode !== "FR") {
      throw new NumberProductError("INVALID_IMPORT_PHONE_NUMBER");
    }
    const ownerEmail = z.string().trim().email().max(320).parse(ownerEmailInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    if (!context.ownerEmail) throw new NumberProductError("NUMBER_IMPORT_EMAIL_REQUIRED");

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();
    const supportTo = process.env.SUPPORT_FORWARD_TO_EMAIL?.trim();
    if (!apiKey || !from || !supportTo) {
      throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    }

    const fingerprint = createHash("sha256")
      .update(`${context.workspaceId}|${normalized.phoneE164}|${ownerEmail.toLowerCase()}`)
      .digest("hex")
      .slice(0, 24);
    const safePhone = escapeHtml(normalized.phoneE164);
    const safeEmail = escapeHtml(ownerEmail);
    const supportResponse = await sendPortingEmail(
      apiKey,
      {
        from,
        to: [supportTo],
        reply_to: ownerEmail,
        subject: `French number porting request: ${normalized.phoneE164}`,
        html: `<div style="font-family:Arial,sans-serif;color:#0a0d0a;line-height:1.6"><h1>French number porting request</h1><p><strong>Number:</strong> ${safePhone}</p><p><strong>Contact:</strong> ${safeEmail}</p><p><strong>Workspace:</strong> ${escapeHtml(context.workspaceId)}</p><p>This request requires the provider's manual French porting process.</p></div>`,
        text: `French number porting request\nNumber: ${normalized.phoneE164}\nContact: ${ownerEmail}\nWorkspace: ${context.workspaceId}\n\nThis request requires the provider's manual French porting process.`,
      },
      `fr-port/${fingerprint}`,
    );
    if (!supportResponse.ok) throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");

    await sendPortingEmail(
      apiKey,
      {
        from,
        to: [context.ownerEmail],
        reply_to: "support@riink.app",
        subject: "Your French number porting request",
        html: `<div style="font-family:Arial,sans-serif;color:#0a0d0a;line-height:1.6"><h1>We received your request</h1><p>We will review the porting options for <strong>${safePhone}</strong> and contact you with the documents required.</p><p>Keep the number active with your current carrier until the transfer is complete.</p></div>`,
        text: `We received your request to port ${normalized.phoneE164}. We will contact you with the documents required. Keep the number active with your current carrier until the transfer is complete.`,
      },
      `fr-port-confirmation/${fingerprint}`,
    );

    return {
      message: "French number porting request sent. We will contact you with the required documents.",
      ok: true,
      phoneNumber: normalized.phoneE164,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Step 2 of import flow: verify the saved card, then start the hosted number import. */
export async function startNumberImportAction(
  eligibilityTokenInput: string,
  ownerEmailInput: string,
): Promise<NumberActionResult> {
  try {
    const eligibilityToken = z.string().trim().min(1).max(4_000).parse(eligibilityTokenInput);
    const ownerEmail = z.string().trim().email().parse(ownerEmailInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    if (!context.paymentMethodSaved) throw new NumberProductError("PAYMENT_METHOD_REQUIRED");

    await numberImportServiceFromEnvironment().startImport({
      eligibilityToken,
      ownerEmail,
      workspaceId: context.workspaceId,
    });

    revalidatePath("/settings");
    return { message: "Number import started. This process may take a few days.", ok: true };
  } catch (error) {
    return failure(error);
  }
}
