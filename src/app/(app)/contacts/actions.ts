"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ContactActionResult } from "@/components/contacts/types";
import {
  CONTACT_IMPORT_LIMIT_MESSAGE,
  MAX_CONTACT_IMPORT_ROWS,
} from "@/lib/contacts/import-policy";
import { normalizePhoneNumber, parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";
import { createClient } from "@/lib/supabase/server";

const contactFieldsSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  company: z.string().trim().max(160),
  jobTitle: z.string().trim().max(100).optional(),
  phone: z.string().trim().min(1).max(40),
  stageId: z.string().uuid().optional(),
});

const importOperationSchema = z.object({
  action: z.enum(["create", "restore"]),
  existingContactId: z.string().uuid().nullable(),
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  jobTitle: z.string().trim().max(100).optional().nullable(),
  company: z.string().trim().max(160),
  phoneE164: z.string().max(40),
  countryCode: z.string(),
  isSuppressed: z.boolean(),
  preserveSuppression: z.literal(true),
});

function result(ok: boolean, message: string, imported?: number): ContactActionResult {
  return { ok, message, ...(imported === undefined ? {} : { imported }) };
}

function safeContactError(code?: string) {
  if (code === "23505") return "A contact with this phone number already exists.";
  if (code === "42501") return "You don't have permission to make this change.";
  return "We couldn't save this contact. Please try again.";
}

async function getWorkspace() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, workspaceId: null };

  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  return { supabase, workspaceId: data?.id ?? null };
}

function parseContactForm(formData: FormData) {
  const parsed = contactFieldsSchema.safeParse({
    company: formData.get("company") ?? "",
    jobTitle: formData.get("jobTitle") ?? "",
    firstName: formData.get("firstName") ?? "",
    lastName: formData.get("lastName") ?? "",
    phone: formData.get("phone") ?? "",
    stageId: formData.get("stageId") || undefined,
  });
  if (!parsed.success) return null;

  const result = parseAndNormalizePhoneNumber(parsed.data.phone);
  return result ? { ...parsed.data, phoneE164: result.phoneE164, countryCode: result.countryCode } : null;
}

export async function createContactAction(formData: FormData): Promise<ContactActionResult> {
  const contact = parseContactForm(formData);
  if (!contact) return result(false, "Enter a valid US or French phone number (premium numbers are not allowed) and check each field.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("create_contact", {
    p_company: contact.company,
    p_job_title: contact.jobTitle ?? "",
    p_first_name: contact.firstName,
    p_last_name: contact.lastName,
    p_phone_e164: contact.phoneE164,
    p_country_code: contact.countryCode,
    p_pipeline_stage_id: contact.stageId ?? null,
    p_workspace_id: workspaceId,
  });

  if (error) return result(false, safeContactError(error.code));
  revalidatePath("/contacts");
  return result(true, "Contact added.");
}

export async function updateContactAction(formData: FormData): Promise<ContactActionResult> {
  const contactId = z.string().uuid().safeParse(formData.get("contactId"));
  const contact = parseContactForm(formData);
  if (!contactId.success || !contact) {
    return result(false, "Enter a valid US or French phone number (premium numbers are not allowed) and check each field.");
  }

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("update_contact", {
    p_company: contact.company,
    p_job_title: contact.jobTitle ?? "",
    p_contact_id: contactId.data,
    p_first_name: contact.firstName,
    p_last_name: contact.lastName,
    p_phone_e164: contact.phoneE164,
    p_country_code: contact.countryCode,
    p_pipeline_stage_id: contact.stageId ?? null,
  });

  if (error) return result(false, safeContactError(error.code));
  revalidatePath("/contacts");
  return result(true, "Contact updated.");
}

export async function deleteContactAction(contactId: string): Promise<ContactActionResult> {
  const parsedId = z.string().uuid().safeParse(contactId);
  if (!parsedId.success) return result(false, "This contact couldn't be found.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("soft_delete_contact", { p_contact_id: parsedId.data });
  if (error) return result(false, safeContactError(error.code));

  revalidatePath("/contacts");
  return result(true, "Contact deleted.");
}

export async function moveContactAction(contactId: string, stageId: string): Promise<ContactActionResult> {
  const parsed = z.object({ contactId: z.string().uuid(), stageId: z.string().uuid() }).safeParse({ contactId, stageId });
  if (!parsed.success) return result(false, "This contact couldn't be moved.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("move_contact_to_stage", {
    p_contact_id: parsed.data.contactId,
    p_pipeline_stage_id: parsed.data.stageId,
  });
  if (error) return result(false, "We couldn't move this contact. Please try again.");

  revalidatePath("/contacts");
  return result(true, "Contact moved.");
}

export async function importContactsAction(serializedOperations: string): Promise<ContactActionResult> {
  let rawOperations: unknown;
  try {
    rawOperations = JSON.parse(serializedOperations);
  } catch {
    return result(false, "This import preview is no longer valid.");
  }

  if (
    Array.isArray(rawOperations) &&
    rawOperations.length > MAX_CONTACT_IMPORT_ROWS
  ) {
    return result(false, CONTACT_IMPORT_LIMIT_MESSAGE);
  }

  const operations = z
    .array(importOperationSchema)
    .min(1)
    .max(MAX_CONTACT_IMPORT_ROWS)
    .safeParse(rawOperations);
  if (!operations.success || operations.data.some((entry) => normalizePhoneNumber(entry.phoneE164) !== entry.phoneE164)) {
    return result(false, "This import contains invalid contact data.");
  }

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("bulk_upsert_contacts", {
    p_contacts: operations.data,
    p_workspace_id: workspaceId,
  });
  if (error) return result(false, "We couldn't import these contacts. No contacts were changed.");

  revalidatePath("/contacts");
  return result(true, `${operations.data.length.toLocaleString("en-US")} contacts imported.`, operations.data.length);
}

export async function createStageAction(name: string): Promise<ContactActionResult> {
  const parsedName = z.string().trim().min(1).max(80).safeParse(name);
  if (!parsedName.success) return result(false, "Enter a stage name.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("create_pipeline_stage", {
    p_name: parsedName.data,
    p_workspace_id: workspaceId,
  });
  if (error) return result(false, error.code === "23505" ? "A stage with this name already exists." : "We couldn't add this stage.");

  revalidatePath("/contacts");
  return result(true, "Stage added.");
}

export async function renameStageAction(stageId: string, name: string): Promise<ContactActionResult> {
  const parsed = z.object({ name: z.string().trim().min(1).max(80), stageId: z.string().uuid() }).safeParse({ name, stageId });
  if (!parsed.success) return result(false, "Enter a valid stage name.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("rename_pipeline_stage", {
    p_name: parsed.data.name,
    p_stage_id: parsed.data.stageId,
  });
  if (error) return result(false, error.code === "23505" ? "A stage with this name already exists." : "We couldn't rename this stage.");

  revalidatePath("/contacts");
  return result(true, "Stage renamed.");
}

export async function setDefaultStageAction(stageId: string): Promise<ContactActionResult> {
  const parsedId = z.string().uuid().safeParse(stageId);
  if (!parsedId.success) return result(false, "This stage couldn't be found.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("set_default_pipeline_stage", { p_stage_id: parsedId.data });
  if (error) return result(false, "We couldn't change the default stage.");

  revalidatePath("/contacts");
  revalidatePath("/settings");
  return result(true, "Default stage updated.");
}

export async function reorderStagesAction(stageIds: string[]): Promise<ContactActionResult> {
  const parsedIds = z.array(z.string().uuid()).min(1).safeParse(stageIds);
  if (!parsedIds.success || new Set(parsedIds.data).size !== parsedIds.data.length) {
    return result(false, "The stage order is invalid.");
  }

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("reorder_pipeline_stages", {
    p_stage_ids: parsedIds.data,
    p_workspace_id: workspaceId,
  });
  if (error) return result(false, "We couldn't reorder these stages.");

  revalidatePath("/contacts");
  return result(true, "Stages reordered.");
}

export async function deleteStageAction(stageId: string, destinationStageId: string | null): Promise<ContactActionResult> {
  const parsed = z
    .object({ destinationStageId: z.string().uuid().nullable(), stageId: z.string().uuid() })
    .safeParse({ destinationStageId, stageId });
  if (!parsed.success) return result(false, "Choose a valid destination stage.");

  const { supabase, workspaceId } = await getWorkspace();
  if (!workspaceId) return result(false, "Your workspace isn't ready yet. Please try again shortly.");

  const { error } = await supabase.rpc("delete_pipeline_stage", {
    p_reassign_to_stage_id: parsed.data.destinationStageId,
    p_stage_id: parsed.data.stageId,
  });
  if (error) {
    const message = error.code === "23503"
      ? "Choose another stage for these contacts before deleting."
      : "We couldn't delete this stage.";
    return result(false, message);
  }

  revalidatePath("/contacts");
  revalidatePath("/settings");
  return result(true, "Stage deleted.");
}
