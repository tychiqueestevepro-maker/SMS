"use client";

import { useState, useTransition } from "react";

import { setWorkspaceSafetyCapAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";

export function SafetyCapControl({
  currentCredits,
  includedCredits,
  workspaceId,
}: {
  currentCredits: number;
  includedCredits: number;
  workspaceId: string;
}) {
  const [value, setValue] = useState(String(currentCredits));
  const [notice, setNotice] = useState<{ message: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setNotice(null);
    startTransition(async () => {
      const result = await setWorkspaceSafetyCapAction(workspaceId, Number(value));
      setNotice(result);
    });
  }

  return (
    <div className="min-w-56">
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`safety-cap-${workspaceId}`}>
          Outbound segment safety cap
        </label>
        <input
          className="h-9 w-28 rounded-lg border border-[#d7dfd9] bg-white px-3 text-sm text-[#26342b] outline-none focus:border-[#78a58b] focus:ring-2 focus:ring-[#dbece1]"
          id={`safety-cap-${workspaceId}`}
          min={Math.max(1, includedCredits)}
          onChange={(event) => setValue(event.target.value)}
          step={1}
          type="number"
          value={value}
        />
        <Button disabled={isPending || value === String(currentCredits)} onClick={submit} size="sm" variant="secondary">
          Save
        </Button>
      </div>
      {notice ? (
        <p className={`mt-1.5 text-xs ${notice.ok ? "text-[#246b4a]" : "text-[#a33a32]"}`} role={notice.ok ? "status" : "alert"}>
          {notice.message}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-[#7a857e]">Minimum {includedCredits.toLocaleString("en-US")}</p>
      )}
    </div>
  );
}
