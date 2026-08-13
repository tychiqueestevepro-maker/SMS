"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

type ModalProps = {
  children: ReactNode;
  description?: string;
  open: boolean;
  onClose: () => void;
  title: string;
  width?: "md" | "lg" | "xl";
};

export function Modal({ children, description, onClose, open, title, width = "md" }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  const widths = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

  return (
    <div className="fixed inset-0 z-[70] grid items-end justify-items-center sm:items-center sm:p-6">
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-[#17211b]/40 backdrop-blur-[2px]"
        onClick={onClose}
        type="button"
      />
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`relative max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl ${widths[width]}`}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-5 border-b border-[#e7ebe8] px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-[#26342b]" id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm leading-5 text-[#738078]" id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[#738078] hover:bg-[#f1f4f1] hover:text-[#26342b]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="max-h-[calc(92vh-73px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
