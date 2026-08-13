"use client";

import { FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { importContactsAction } from "@/app/(app)/contacts/actions";
import { Modal } from "@/components/contacts/modal";
import type { ContactActionResult } from "@/components/contacts/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buildContactImportOperations, previewContactCsv } from "@/lib/contacts/csv-import";
import type { ContactImportPreview, ExistingContactMatch } from "@/lib/contacts/types";

type CsvImportDialogProps = {
  existingContacts: ExistingContactMatch[];
  onClose: () => void;
  onResult: (result: ContactActionResult) => void;
  open: boolean;
};

function issueLabel(issue: string | null) {
  if (issue === "invalid_phone") return "Invalid phone";
  if (issue === "active_duplicate") return "Already exists";
  if (issue === "csv_duplicate") return "Duplicate row";
  if (issue === "invalid_headers") return "Invalid headers";
  return "Ready";
}

export function CsvImportDialog({ existingContacts, onClose, onResult, open }: CsvImportDialogProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetAndClose() {
    if (isPending) return;
    setFilename(null);
    setPreview(null);
    setError(null);
    onClose();
  }

  async function readFile(file: File | undefined) {
    setError(null);
    setPreview(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose a CSV file smaller than 5 MB.");
      return;
    }
    try {
      const csv = await file.text();
      const nextPreview = previewContactCsv(csv, { existingContacts });
      setFilename(file.name);
      setPreview(nextPreview);
      if (nextPreview.headerIssues.length > 0) {
        setError("Your CSV needs one phone column and no duplicate mapped headers.");
      }
    } catch {
      setError("We couldn't read this CSV file.");
    }
  }

  function importContacts() {
    if (!preview?.canImport) return;
    const operations = buildContactImportOperations(preview);
    setError(null);
    startTransition(async () => {
      const actionResult = await importContactsAction(JSON.stringify(operations));
      if (!actionResult.ok) {
        setError(actionResult.message);
        return;
      }
      router.refresh();
      onResult(actionResult);
      resetAndClose();
    });
  }

  return (
    <Modal
      description="Upload a CSV, review every row, then confirm the import."
      onClose={resetAndClose}
      open={open}
      title="Import contacts"
      width="xl"
    >
      <div className="p-5 sm:p-6">
        {!preview ? (
          <button
            className="grid min-h-52 w-full place-items-center rounded-xl border border-dashed border-[#cfd9d2] bg-[#fafbfa] p-8 text-center transition-colors hover:border-[#89aa96] hover:bg-[#f5f9f6]"
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <span>
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#eaf3ed] text-[#246b4a]">
                <Upload aria-hidden="true" size={20} />
              </span>
              <span className="mt-4 block text-sm font-semibold text-[#26342b]">Choose a CSV file</span>
              <span className="mt-1.5 block text-xs leading-5 text-[#738078]">
                Use headers such as first_name, last_name, company, and phone.
              </span>
            </span>
          </button>
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#edf3ef] text-[#246b4a]">
                  <FileSpreadsheet aria-hidden="true" size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[#26342b]">{filename}</p>
                  <button className="mt-0.5 text-xs font-medium text-[#246b4a] hover:text-[#19543a]" onClick={() => inputRef.current?.click()} type="button">
                    Choose another file
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">{preview.counts.ready} ready</Badge>
                <Badge>{preview.counts.duplicates} duplicates</Badge>
                <Badge tone={preview.counts.invalid ? "warning" : "neutral"}>{preview.counts.invalid} invalid</Badge>
                {preview.counts.restorations ? <Badge tone="success">{preview.counts.restorations} restorations</Badge> : null}
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-[#e2e7e3]">
              <div className="max-h-[340px] overflow-auto">
                <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-[#f6f8f6] text-xs font-semibold uppercase tracking-wide text-[#68736c]">
                    <tr>
                      <th className="px-4 py-3">Row</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Company</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf0ee]">
                    {preview.rows.slice(0, 100).map((row) => (
                      <tr className="bg-white" key={row.rowNumber}>
                        <td className="px-4 py-3 text-xs text-[#7a857e]">{row.rowNumber}</td>
                        <td className="px-4 py-3 font-medium text-[#344139]">
                          {row.values ? `${row.values.firstName} ${row.values.lastName}`.trim() || "—" : "—"}
                        </td>
                        <td className="px-4 py-3 text-[#68736c]">{row.values?.company || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-[#536159]">{row.values?.phoneE164 ?? row.rawPhone}</td>
                        <td className="px-4 py-3">
                          <Badge tone={row.disposition === "ready" ? "success" : row.disposition === "invalid" ? "warning" : "neutral"}>
                            {row.action === "restore" ? "Restore" : issueLabel(row.issue)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.rows.length > 100 ? (
                <p className="border-t border-[#e7ebe8] bg-[#fafbfa] px-4 py-2.5 text-xs text-[#738078]">
                  Showing the first 100 of {preview.rows.length.toLocaleString("en-US")} rows.
                </p>
              ) : null}
            </div>
          </>
        )}

        <input
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => readFile(event.target.files?.[0])}
          ref={inputRef}
          type="file"
        />
        {error ? <p className="mt-4 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 py-2.5 text-sm text-[#8f312a]" role="alert">{error}</p> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e7ebe8] bg-[#fafbfa] px-5 py-4 sm:px-6">
        <Button disabled={isPending} onClick={resetAndClose} variant="secondary">
          Cancel
        </Button>
        <Button disabled={!preview?.canImport || isPending} onClick={importContacts}>
          {isPending ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : null}
          Import {preview?.counts.ready ? preview.counts.ready.toLocaleString("en-US") : ""} contacts
        </Button>
      </div>
    </Modal>
  );
}
