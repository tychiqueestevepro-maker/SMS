"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { loadNumberServerContext } from "@/app/(app)/settings/numbers-data";
import type { NumberActionResult } from "@/components/numbers/types";
import { ProductMessagingError } from "@/lib/messaging/errors";
import { assertUsAreaCode } from "@/lib/numbers/area-code";
import { validateBusinessVerification, type BusinessVerificationInput } from "@/lib/numbers/business";
import { NumberProductError } from "@/lib/numbers/errors";
import { evaluateNumberCapacity, evaluateNumberRemoval } from "@/lib/numbers/policy";
import { numberProvisioningServiceFromEnvironment, numberImportServiceFromEnvironment } from "@/lib/runtime/messaging.server";
import { ensureWorkspaceSubscriptionActive } from "@/lib/runtime/billing.server";

function failure(error: unknown): NumberActionResult {
  if (error instanceof NumberProductError || error instanceof ProductMessagingError) {
    return { code: error.code, message: error.message, ok: false };
  }
  const safe = new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
  return { code: safe.code, message: safe.message, ok: false };
}

export async function searchAvailableNumbersAction(
  areaCodeInput: string,
  requestIdInput: string,
): Promise<NumberActionResult> {
  try {
    const areaCode = assertUsAreaCode(areaCodeInput);
    const requestId = z.string().uuid().parse(requestIdInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");

    const candidates = await numberProvisioningServiceFromEnvironment().searchNumbers({
      areaCode,
      limit: 10,
      requestId,
      workspaceId: context.workspaceId,
    });
    return { candidates, message: candidates.length ? "Choose a phone number." : "No phone numbers were found for this area code.", ok: true };
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

/**
 * Called from the onboarding dialog when the user has entered both business
 * details AND payment information. Activates the Stripe subscription first,
 * then starts number provisioning.
 */
export async function startNumberOnboardingWithPaymentAction(
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

    // Ensure subscription is active before provisioning the number.
    await ensureWorkspaceSubscriptionActive(context.workspaceId);

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

/** Step 1 of import flow: verify the number is eligible and return an eligibility token. */
export async function checkNumberImportEligibilityAction(
  phoneNumberInput: string,
  countryCode: "US" | "CA" = "US",
): Promise<NumberActionResult> {
  try {
    const phoneNumber = z.string().trim().min(1).max(25).parse(phoneNumberInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");

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

/** Step 2 of import flow: activate subscription if needed, then start the hosted number import. */
export async function startNumberImportWithPaymentAction(
  eligibilityTokenInput: string,
  ownerEmailInput: string,
): Promise<NumberActionResult> {
  try {
    const eligibilityToken = z.string().trim().min(1).max(4_000).parse(eligibilityTokenInput);
    const ownerEmail = z.string().trim().email().parse(ownerEmailInput);
    const context = await loadNumberServerContext();
    if (!context) throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");

    // Activate subscription before importing.
    await ensureWorkspaceSubscriptionActive(context.workspaceId);

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
