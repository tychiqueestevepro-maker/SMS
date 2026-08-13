"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { InboxActionResult } from "@/components/inbox/types";
import { loadCustomerBillingCapabilities } from "@/lib/billing/customer-capabilities.server";
import { InboxProductError, toInboxProductError } from "@/lib/inbox/errors";
import { evaluateManualMessage } from "@/lib/inbox/manual";
import { estimateSmsCredits } from "@/lib/messaging/credits";
import { manualMessageSenderFromEnvironment } from "@/lib/runtime/messaging.server";
import { createClient } from "@/lib/supabase/server";

const manualMessageSchema = z.object({
  body: z.string().trim().min(1).max(1600),
  contactId: z.string().uuid(),
  phoneNumberId: z.string().uuid(),
  requestId: z.string().uuid(),
});

function safeFailure(error: unknown): InboxActionResult {
  const productError = toInboxProductError(error);
  return {
    canRetryWithNewRequest: productError.canRetryWithNewRequest,
    code: productError.code,
    message: productError.message,
    ok: false,
  };
}

async function context() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, workspaceId: null };
  const { data } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle();
  return { supabase, workspaceId: (data?.id as string | undefined) ?? null };
}

export async function sendManualMessageAction(input: {
  body: string;
  contactId: string;
  phoneNumberId: string;
  requestId: string;
}): Promise<InboxActionResult> {
  try {
    const parsed = manualMessageSchema.safeParse(input);
    if (!parsed.success) throw new InboxProductError(input.body.trim() ? "MESSAGE_SEND_FAILED" : "MESSAGE_REQUIRED");

    const { supabase, workspaceId } = await context();
    if (!workspaceId) throw new InboxProductError("MESSAGE_SEND_FAILED");
    const [{ data: contact }, { data: phone }, capabilities] = await Promise.all([
      supabase.from("contacts").select("deleted_at,phone_e164").eq("workspace_id", workspaceId).eq("id", parsed.data.contactId).maybeSingle(),
      supabase.from("phone_numbers").select("status").eq("workspace_id", workspaceId).eq("id", parsed.data.phoneNumberId).maybeSingle(),
      loadCustomerBillingCapabilities(supabase),
    ]);
    if (!contact) throw new InboxProductError("CONTACT_NOT_AVAILABLE");
    if (!capabilities.canSendMessages) {
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }
    if (
      capabilities.effectiveCredits + estimateSmsCredits(parsed.data.body) >
      capabilities.safetyCapCredits
    ) {
      throw new InboxProductError("MESSAGE_SEND_FAILED");
    }

    // Query by the contact's phone only after ownership was established above.
    const { data: activeSuppression } = await supabase
      .from("suppressions")
      .select("phone_e164")
      .eq("workspace_id", workspaceId)
      .eq("phone_e164", contact.phone_e164)
      .maybeSingle();

    const decision = evaluateManualMessage({
      body: parsed.data.body,
      contact: { deletedAt: contact.deleted_at as string | null, isSuppressed: Boolean(activeSuppression) },
      phoneNumber: phone ? { status: phone.status as "pending" | "ready" } : null,
    });
    if (!decision.allowed && decision.error) {
      throw new InboxProductError(decision.error.code as ConstructorParameters<typeof InboxProductError>[0]);
    }

    await manualMessageSenderFromEnvironment().send({
      body: parsed.data.body,
      contactId: parsed.data.contactId,
      phoneNumberId: parsed.data.phoneNumberId,
      requestId: parsed.data.requestId,
      workspaceId,
    });

    revalidatePath("/inbox");
    return { message: "Message sent.", ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function moveInboxContactStageAction(contactId: string, stageId: string): Promise<InboxActionResult> {
  const parsed = z.object({ contactId: z.string().uuid(), stageId: z.string().uuid() }).safeParse({ contactId, stageId });
  if (!parsed.success) return { code: "CONTACT_NOT_AVAILABLE", message: "This contact is no longer available.", ok: false };

  const { supabase, workspaceId } = await context();
  if (!workspaceId) return { code: "CONTACT_NOT_AVAILABLE", message: "This contact is no longer available.", ok: false };
  const { error } = await supabase.rpc("move_contact_to_stage", {
    p_contact_id: parsed.data.contactId,
    p_pipeline_stage_id: parsed.data.stageId,
  });
  if (error) return { code: "CONTACT_NOT_AVAILABLE", message: "This contact is no longer available.", ok: false };

  revalidatePath("/inbox");
  revalidatePath("/contacts");
  return { message: "Pipeline stage updated.", ok: true };
}

export async function saveContactNoteAction(contactId: string, note: string): Promise<InboxActionResult> {
  try {
    const { supabase, workspaceId } = await context();
    if (!workspaceId) throw new InboxProductError("CONTACT_NOT_AVAILABLE");

    const { error } = await supabase
      .from("contacts")
      .update({ notes: note.trim() })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);

    if (error) throw new InboxProductError("CONTACT_NOT_AVAILABLE");

    revalidatePath("/inbox");
    return { canRetryWithNewRequest: false, code: "SUCCESS", message: "Note saved successfully", ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function deleteInboxConversationAction(contactId: string): Promise<InboxActionResult> {
  try {
    const { supabase, workspaceId } = await context();
    if (!workspaceId) throw new InboxProductError("CONTACT_NOT_AVAILABLE");

    const { error } = await supabase
      .from("contacts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", contactId)
      .eq("workspace_id", workspaceId);

    if (error) throw new InboxProductError("CONTACT_NOT_AVAILABLE");

    revalidatePath("/inbox");
    return { canRetryWithNewRequest: false, code: "SUCCESS", message: "Conversation deleted", ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function markConversationReadAction(contactId: string): Promise<InboxActionResult> {
  try {
    const { supabase, workspaceId } = await context();
    if (!workspaceId) throw new InboxProductError("CONTACT_NOT_AVAILABLE");
    
    const { error } = await supabase
      .from("contacts")
      .update({ has_unread_messages: false })
      .eq("workspace_id", workspaceId)
      .eq("id", contactId);
      
    if (error) {
      console.error("Failed to mark conversation as read:", error);
      return { canRetryWithNewRequest: false, code: "SERVER_ERROR", message: "Failed to mark read", ok: false };
    }
    
    revalidatePath("/inbox");
    return { canRetryWithNewRequest: false, code: "SUCCESS", message: "Conversation marked read", ok: true };
  } catch (error) {
    return safeFailure(error);
  }
}
