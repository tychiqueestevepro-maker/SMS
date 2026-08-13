"use client";

import { Settings2 } from "lucide-react";
import { useState } from "react";

import { StageManagerDialog } from "@/components/contacts/stage-manager-dialog";
import type { ContactActionResult, PipelineStageDto } from "@/components/contacts/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function PipelineSettings({ stages }: { stages: PipelineStageDto[] }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function handleResult(result: ContactActionResult) {
    setMessage(result.message);
  }

  return (
    <>
      <div className="space-y-2">
        {stages.map((stage) => (
          <div
            className="flex items-center gap-3 rounded-lg border border-[#e2e7e3] px-4 py-3.5"
            key={stage.id}
          >
            <span className="size-2.5 rounded-full bg-[#4f8d6c]" />
            <span className="flex-1 text-sm font-medium text-[#26342b]">{stage.name}</span>
            <Badge>{stage.contactCount} {stage.contactCount === 1 ? "contact" : "contacts"}</Badge>
            {stage.isDefault ? <Badge tone="success">Default stage</Badge> : null}
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-5 text-[#7a857e]">
          New contacts use the default stage. Reordering never changes it.
        </p>
        <Button onClick={() => setOpen(true)} size="sm" variant="secondary">
          <Settings2 aria-hidden="true" size={14} />
          Manage stages
        </Button>
      </div>
      {message ? <p aria-live="polite" className="mt-3 text-xs font-medium text-[#246b4a]">{message}</p> : null}
      <StageManagerDialog
        onClose={() => setOpen(false)}
        onResult={handleResult}
        open={open}
        stages={stages}
      />
    </>
  );
}
