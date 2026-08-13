"use client";

import { useState, useTransition } from "react";

import {
  activateApprovedNumberAction,
  approveAndActivatePendingNumberAction,
} from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function NumberActivationControl({
  approveFirst = false,
  numberId,
  workspaceId,
}: {
  approveFirst?: boolean;
  numberId: string;
  workspaceId?: string;
}) {
  const [isConfirmingApproval, setIsConfirmingApproval] = useState(false);
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function activate() {
    setNotice(null);
    startTransition(async () => {
      const result =
        approveFirst && workspaceId
          ? await approveAndActivatePendingNumberAction(numberId, workspaceId)
          : await activateApprovedNumberAction(numberId);
      setNotice(result);
      if (result.ok) setIsConfirmingApproval(false);
    });
  }

  return (
    <div className="min-w-40">
      {approveFirst && !isConfirmingApproval ? (
        <Button
          disabled={isPending || !workspaceId}
          onClick={() => setIsConfirmingApproval(true)}
          size="sm"
          variant="secondary"
        >
          Approve &amp; activate
        </Button>
      ) : approveFirst ? (
        <div className="max-w-56 rounded-lg border border-[#dfe6e1] bg-white p-2.5">
          <p className="text-xs leading-5 text-[#536159]">
            Confirm that registration is approved and Advanced Opt-Out is enabled for the Messaging Service. This may activate the workspace plan.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={isPending}
              onClick={() => setIsConfirmingApproval(false)}
              size="sm"
              variant="ghost"
            >
              Back
            </Button>
            <Button disabled={isPending} onClick={activate} size="sm">
              {isPending ? "Activating…" : "Confirm"}
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={isPending} onClick={activate} size="sm" variant="secondary">
          {isPending ? "Activating…" : "Activate"}
        </Button>
      )}
      {notice ? (
        <p
          className={`mt-1.5 max-w-48 text-xs ${notice.ok ? "text-[#246b4a]" : "text-[#a33a32]"}`}
          role={notice.ok ? "status" : "alert"}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
