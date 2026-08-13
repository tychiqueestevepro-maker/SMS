"use client";

import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, Star, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  createStageAction,
  deleteStageAction,
  renameStageAction,
  reorderStagesAction,
  setDefaultStageAction,
} from "@/app/(app)/contacts/actions";
import { Modal } from "@/components/contacts/modal";
import type { ContactActionResult, PipelineStageDto } from "@/components/contacts/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StageManagerDialogProps = {
  onClose: () => void;
  onResult: (result: ContactActionResult) => void;
  open: boolean;
  stages: PipelineStageDto[];
};

const inputClass =
  "h-9 min-w-0 rounded-lg border border-[#dbe2dd] bg-white px-3 text-sm text-[#26342b] shadow-sm focus:border-[#2e7d57] focus:outline-none focus:ring-3 focus:ring-[#d8ebe0]";

export function StageManagerDialog({ onClose, onResult, open, stages }: StageManagerDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null);
  const [destinationStageId, setDestinationStageId] = useState("");
  const deletingStage = stages.find((stage) => stage.id === deletingStageId) ?? null;

  function close() {
    if (isPending) return;
    setError(null);
    setDeletingStageId(null);
    setDestinationStageId("");
    onClose();
  }

  function run(action: () => Promise<ContactActionResult>, afterSuccess?: () => void) {
    setError(null);
    startTransition(async () => {
      const actionResult = await action();
      if (!actionResult.ok) {
        setError(actionResult.message);
        return;
      }
      afterSuccess?.();
      onResult(actionResult);
      router.refresh();
    });
  }

  function addStage(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    run(() => createStageAction(name), () => {
      const form = document.getElementById("add-stage-form") as HTMLFormElement | null;
      form?.reset();
    });
  }

  function renameStage(stageId: string, formData: FormData) {
    run(() => renameStageAction(stageId, String(formData.get("name") ?? "")));
  }

  function moveStage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stages.length) return;
    const ids = stages.map((stage) => stage.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => reorderStagesAction(ids));
  }

  function confirmDelete() {
    if (!deletingStage) return;
    const destination = deletingStage.contactCount > 0 ? destinationStageId || null : null;
    run(() => deleteStageAction(deletingStage.id, destination), () => {
      setDeletingStageId(null);
      setDestinationStageId("");
    });
  }

  return (
    <Modal
      description="Rename, reorder, and choose where new contacts begin."
      onClose={close}
      open={open}
      title="Manage pipeline stages"
      width="lg"
    >
      <div className="p-5 sm:p-6">
        <div className="space-y-2">
          {stages.map((stage, index) => {
            const cannotDelete = stage.isDefault || stages.length === 1;
            return (
              <div className="rounded-xl border border-[#e2e7e3] bg-white p-3" key={stage.id}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      aria-label={`Move ${stage.name} up`}
                      className="grid size-8 place-items-center rounded-lg text-[#738078] hover:bg-[#f1f4f1] disabled:opacity-30"
                      disabled={index === 0 || isPending}
                      onClick={() => moveStage(index, -1)}
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={15} />
                    </button>
                    <button
                      aria-label={`Move ${stage.name} down`}
                      className="grid size-8 place-items-center rounded-lg text-[#738078] hover:bg-[#f1f4f1] disabled:opacity-30"
                      disabled={index === stages.length - 1 || isPending}
                      onClick={() => moveStage(index, 1)}
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={15} />
                    </button>
                  </div>
                  <form action={renameStage.bind(null, stage.id)} className="flex min-w-0 flex-1 gap-2">
                    <input aria-label={`${stage.name} stage name`} className={`${inputClass} w-full`} defaultValue={stage.name} maxLength={80} name="name" />
                    <Button disabled={isPending} size="sm" type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                  <div className="flex items-center justify-between gap-2 sm:justify-end">
                    <Badge>{stage.contactCount} {stage.contactCount === 1 ? "contact" : "contacts"}</Badge>
                    {stage.isDefault ? (
                      <Badge tone="success">
                        <Check aria-hidden="true" className="mr-1" size={12} />
                        Default
                      </Badge>
                    ) : (
                      <button
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#536159] hover:bg-[#edf3ef] hover:text-[#246b4a]"
                        disabled={isPending}
                        onClick={() => run(() => setDefaultStageAction(stage.id))}
                        type="button"
                      >
                        <Star aria-hidden="true" size={13} />
                        Set as default
                      </button>
                    )}
                    <button
                      aria-label={`Delete ${stage.name}`}
                      className="grid size-8 place-items-center rounded-lg text-[#879189] hover:bg-[#fff0ee] hover:text-[#b33b32] disabled:cursor-not-allowed disabled:opacity-30"
                      disabled={cannotDelete || isPending}
                      onClick={() => {
                        setDeletingStageId(stage.id);
                        setDestinationStageId("");
                      }}
                      title={stage.isDefault ? "Set another stage as default before deleting this one." : stages.length === 1 ? "The final stage can't be deleted." : "Delete stage"}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  </div>
                </div>

                {deletingStageId === stage.id ? (
                  <div className="mt-3 rounded-lg border border-[#f0d0cc] bg-[#fff7f5] p-3">
                    <p className="text-sm font-semibold text-[#7d322d]">Delete “{stage.name}”?</p>
                    {stage.contactCount > 0 ? (
                      <div className="mt-2">
                        <label className="mb-1.5 block text-xs font-medium text-[#77504d]" htmlFor={`destination-${stage.id}`}>
                          Move {stage.contactCount === 1 ? "this contact" : `these ${stage.contactCount} contacts`} to
                        </label>
                        <select
                          className={`${inputClass} w-full sm:max-w-xs`}
                          id={`destination-${stage.id}`}
                          onChange={(event) => setDestinationStageId(event.target.value)}
                          value={destinationStageId}
                        >
                          <option value="">Choose a stage</option>
                          {stages.filter((candidate) => candidate.id !== stage.id).map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="mt-1 text-xs leading-5 text-[#805b57]">This stage is empty and can be safely removed.</p>
                    )}
                    <div className="mt-3 flex justify-end gap-2">
                      <Button disabled={isPending} onClick={() => setDeletingStageId(null)} size="sm" variant="secondary">Cancel</Button>
                      <Button disabled={isPending || (stage.contactCount > 0 && !destinationStageId)} onClick={confirmDelete} size="sm" variant="danger">
                        {isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={14} /> : null}
                        Delete stage
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <form action={addStage} className="mt-5 flex gap-2" id="add-stage-form">
          <input aria-label="New stage name" className={`${inputClass} flex-1`} maxLength={80} name="name" placeholder="New stage name" required />
          <Button disabled={isPending} size="sm" type="submit">
            <Plus aria-hidden="true" size={15} />
            Add stage
          </Button>
        </form>

        {error ? <p className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]" role="alert">{error}</p> : null}
      </div>
      <div className="flex justify-end border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
        <Button disabled={isPending} onClick={close} variant="secondary">Done</Button>
      </div>
    </Modal>
  );
}
