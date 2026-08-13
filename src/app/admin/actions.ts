"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminUser } from "@/lib/admin/authorization.server";
import {
  AdminNumberActivationError,
  AdminNumberActivationService,
} from "@/lib/numbers/admin-activation-service.server";
import { SupabaseAdminNumberActivationRepository } from "@/lib/numbers/supabase-admin-activation-repository.server";
import { logServerEvent } from "@/lib/observability/logger";
import { ensureWorkspaceSubscriptionActive } from "@/lib/runtime/billing.server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { ADMIN_RPC_NAMES } from "./data";
import type { AdminActionResult } from "./types";

const workspaceIdSchema = z.string().uuid();
const numberIdSchema = z.string().uuid();
const safetyCapSchema = z.coerce.number().int().positive().safe();

type AdminIdentity = Awaited<ReturnType<typeof requireAdminUser>>;

async function activateApprovedNumberForAdmin(
  admin: AdminIdentity,
  numberId: string,
): Promise<AdminActionResult> {
  const service = new AdminNumberActivationService(
    new SupabaseAdminNumberActivationRepository(createServiceRoleClient()),
    ensureWorkspaceSubscriptionActive,
  );
  try {
    const result = await service.activate({
      adminUserId: admin.userId,
      numberId,
    });
    logServerEvent(
      "info",
      {
        event: result.alreadyReady
          ? "admin_number_activation_replayed"
          : "admin_number_activated",
        workspace_id: result.workspaceId,
      },
      {
        admin_user_id: admin.userId,
        number_id: result.numberId,
        subscription_id: result.subscriptionId,
      },
    );
    revalidatePath("/admin");
    return {
      message: result.alreadyReady
        ? "Phone number is already Ready."
        : "Phone number activated.",
      ok: true,
    };
  } catch (error) {
    const activationError =
      error instanceof AdminNumberActivationError
        ? error
        : new AdminNumberActivationError(
            "NUMBER_ACTIVATION_FAILED",
            numberId,
            null,
          );
    logServerEvent(
      "error",
      {
        event: "admin_number_activation_failed",
        ...(activationError.workspaceId
          ? { workspace_id: activationError.workspaceId }
          : {}),
      },
      {
        admin_user_id: admin.userId,
        failure_code: activationError.code,
        number_id: activationError.numberId,
      },
    );
    return {
      code: activationError.code,
      message: activationError.message,
      ok: false,
    };
  }
}

export async function setWorkspaceSafetyCapAction(
  workspaceIdInput: string,
  safetyCapCreditsInput: number,
): Promise<AdminActionResult> {
  const admin = await requireAdminUser();
  const workspaceId = workspaceIdSchema.safeParse(workspaceIdInput);
  const safetyCapCredits = safetyCapSchema.safeParse(safetyCapCreditsInput);
  if (!workspaceId.success || !safetyCapCredits.success) {
    return {
      code: "INVALID_SAFETY_CAP",
      message: "Enter a valid outbound segment safety cap.",
      ok: false,
    };
  }

  const service = createServiceRoleClient();
  const { error } = await service.rpc(ADMIN_RPC_NAMES.setSafetyCap, {
    p_safety_cap_credits: safetyCapCredits.data,
    p_workspace_id: workspaceId.data,
  });
  if (error) {
    logServerEvent(
      "error",
      { event: "admin_safety_cap_update_failed", workspace_id: workspaceId.data },
      { admin_user_id: admin.userId, database_error_code: error.code },
    );
    return {
      code: error.code ?? "SAFETY_CAP_UPDATE_FAILED",
      message: "The safety cap couldn't be updated.",
      ok: false,
    };
  }

  logServerEvent(
    "info",
    { event: "admin_safety_cap_updated", workspace_id: workspaceId.data },
    { admin_user_id: admin.userId, safety_cap_credits: safetyCapCredits.data },
  );
  revalidatePath("/admin");
  return { message: "Safety cap updated.", ok: true };
}

export async function activateApprovedNumberAction(
  numberIdInput: string,
): Promise<AdminActionResult> {
  // Server Actions are public mutation entry points. Authorization must be
  // repeated here even though the control is rendered only inside /admin.
  const admin = await requireAdminUser();
  const numberId = numberIdSchema.safeParse(numberIdInput);
  if (!numberId.success) {
    return {
      code: "INVALID_PHONE_NUMBER",
      message: "Select a valid phone number.",
      ok: false,
    };
  }

  return activateApprovedNumberForAdmin(admin, numberId.data);
}

export async function approveAndActivatePendingNumberAction(
  numberIdInput: string,
  workspaceIdInput: string,
): Promise<AdminActionResult> {
  const admin = await requireAdminUser();
  const numberId = numberIdSchema.safeParse(numberIdInput);
  const workspaceId = workspaceIdSchema.safeParse(workspaceIdInput);
  if (!numberId.success || !workspaceId.success) {
    return {
      code: "INVALID_PHONE_NUMBER",
      message: "Select a valid phone number.",
      ok: false,
    };
  }

  const service = createServiceRoleClient();
  const confirmedAt = new Date().toISOString();
  const { data: optOutData, error: optOutError } = await service.rpc(
    ADMIN_RPC_NAMES.confirmAdvancedOptOut,
    {
      p_admin_user_id: admin.userId,
      p_confirmed_at: confirmedAt,
      p_workspace_id: workspaceId.data,
    },
  );
  const optOutRow = Array.isArray(optOutData) ? optOutData[0] : optOutData;
  const optOutConfirmed =
    !optOutError &&
    optOutRow &&
    typeof optOutRow === "object" &&
    (optOutRow as Record<string, unknown>).confirmed === true &&
    (optOutRow as Record<string, unknown>).workspace_id === workspaceId.data;
  if (!optOutConfirmed) {
    logServerEvent(
      "error",
      {
        event: "admin_advanced_opt_out_confirmation_failed",
        workspace_id: workspaceId.data,
      },
      {
        admin_user_id: admin.userId,
        database_error_code:
          optOutError?.code ?? "INVALID_COMPLIANCE_CONFIRMATION_RESPONSE",
        number_id: numberId.data,
      },
    );
    return {
      code: "MESSAGING_COMPLIANCE_CONFIRMATION_FAILED",
      message: "Messaging compliance setup couldn't be confirmed.",
      ok: false,
    };
  }

  logServerEvent(
    "info",
    {
      event: "admin_advanced_opt_out_confirmed",
      workspace_id: workspaceId.data,
    },
    { admin_user_id: admin.userId, number_id: numberId.data },
  );

  const { data, error } = await service.rpc(
    ADMIN_RPC_NAMES.recordNumberSetupState,
    {
      p_a2p_state: "approved",
      p_admin_user_id: admin.userId,
      p_changed_at: confirmedAt,
      p_next_state: "approved",
      p_phone_number_id: numberId.data,
      p_provider_error_code: null,
      p_provider_error_message: null,
      p_provider_status: null,
      p_workspace_id: workspaceId.data,
    },
  );
  const row = Array.isArray(data) ? data[0] : data;
  const approvalRecorded =
    !error &&
    row &&
    typeof row === "object" &&
    (row as Record<string, unknown>).recorded === true &&
    (row as Record<string, unknown>).activation_eligible === true &&
    (row as Record<string, unknown>).number_id === numberId.data &&
    (row as Record<string, unknown>).workspace_id === workspaceId.data &&
    (row as Record<string, unknown>).setup_state === "approved";
  if (!approvalRecorded) {
    logServerEvent(
      "error",
      {
        event: "admin_number_setup_approval_failed",
        workspace_id: workspaceId.data,
      },
      {
        admin_user_id: admin.userId,
        database_error_code: error?.code ?? "INVALID_APPROVAL_RESPONSE",
        number_id: numberId.data,
      },
    );
    return {
      code: "NUMBER_APPROVAL_FAILED",
      message: "Number setup couldn't be approved.",
      ok: false,
    };
  }

  logServerEvent(
    "info",
    {
      event: "admin_number_setup_approved",
      workspace_id: workspaceId.data,
    },
    { admin_user_id: admin.userId, number_id: numberId.data },
  );
  // Approval is durable even if billing activation fails. Refreshing makes a
  // retry available without asking the operator to approve a second time.
  revalidatePath("/admin");
  return activateApprovedNumberForAdmin(admin, numberId.data);
}
