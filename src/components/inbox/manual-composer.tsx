"use client";

import { LoaderCircle, Paperclip, SmilePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { sendManualMessageAction, saveContactNoteAction } from "@/app/(app)/inbox/actions";
import type { InboxActionResult, InboxConversationViewDto } from "@/components/inbox/types";
import { Button } from "@/components/ui/button";
import { estimateSmsCredits } from "@/lib/messaging/credits";

type ManualComposerProps = {
  conversation: InboxConversationViewDto;
  effectiveCredits: number;
  messagingAvailable: boolean;
  onResult: (result: InboxActionResult) => void;
  safetyCapReached: boolean;
  safetyCapCredits: number;
};

export function ManualComposer({ conversation, effectiveCredits, messagingAvailable, onResult, safetyCapCredits, safetyCapReached }: ManualComposerProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [noteBody, setNoteBody] = useState(conversation.contactNotes || "");
  const [activeTab, setActiveTab] = useState<"reply" | "note">("reply");
  const requestId = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isSavingNote, startSavingNote] = useTransition();
  
  const normalizedBody = body.trim();
  const credits = normalizedBody ? Math.max(1, estimateSmsCredits(normalizedBody)) : 0;
  
  const blockedMessage = conversation.deletedContact
    ? "Deleted contacts are read-only."
    : conversation.isSuppressed
      ? "This contact can't receive messages."
      : !conversation.phoneNumberAvailable
        ? "This phone number is no longer available."
        : conversation.phoneNumberStatus !== "ready"
          ? "This phone number isn't ready for messaging yet."
          : safetyCapReached
            ? "Sending is paused because your SMS credit safety limit has been reached."
            : !messagingAvailable
              ? "Messaging is currently unavailable. Check Billing in Settings."
              : null;
              
  const projectedSafetyCapReached =
    !blockedMessage &&
    credits > 0 &&
    effectiveCredits + credits > safetyCapCredits;

  function submit() {
    if (activeTab === "note") {
      saveNote();
      return;
    }
    
    if (blockedMessage || projectedSafetyCapReached) return;
    requestId.current ??= crypto.randomUUID();
    startTransition(async () => {
      const result = await sendManualMessageAction({
        body: normalizedBody,
        contactId: conversation.contactId,
        phoneNumberId: conversation.phoneNumberId,
        requestId: requestId.current!,
      });
      onResult(result);
      if (!result.ok && result.canRetryWithNewRequest) {
        requestId.current = null;
      }
      if (result.ok) {
        requestId.current = null;
        setBody("");
        router.refresh();
      }
    });
  }
  
  function saveNote() {
    if (noteBody === conversation.contactNotes) return;
    startSavingNote(async () => {
      const result = await saveContactNoteAction(conversation.contactId, noteBody);
      onResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-white">
      {/* Composer Tabs */}
      <div className="flex border-b border-[#EEF0EE] px-5">
        <button
          onClick={() => setActiveTab("reply")}
          className={`px-4 py-3 text-[14px] font-semibold transition-colors ${activeTab === "reply" ? "border-b-2 border-[#246B4A] text-[#171A18]" : "text-[#949D97] hover:text-[#66706A]"}`}
        >
          Reply
        </button>
        <button
          onClick={() => setActiveTab("note")}
          className={`px-4 py-3 text-[14px] font-semibold transition-colors ${activeTab === "note" ? "border-b-2 border-[#E79913] text-[#171A18]" : "text-[#949D97] hover:text-[#66706A]"}`}
        >
          Note
        </button>
      </div>
      
      <div className="p-4 sm:p-5">
        {blockedMessage && activeTab === "reply" ? (
          <div className="rounded-xl bg-[#F1F3F2] px-4 py-3 text-center text-[14px] text-[#66706A]">{blockedMessage}</div>
        ) : (
          <form action={submit}>
            <div className={`rounded-[12px] border ${activeTab === "reply" ? "border-[#E5E9E6] focus-within:border-[#246B4A]" : "border-[#F8E3C0] focus-within:border-[#E79913] bg-[#FFFBF5]"} bg-white shadow-sm transition-colors focus-within:ring-1 ${activeTab === "reply" ? "focus-within:ring-[#246B4A]" : "focus-within:ring-[#E79913]"}`}>
              <textarea
                aria-label={activeTab === "reply" ? "Write a message" : "Write a note"}
                className={`min-h-[100px] w-full resize-none border-0 bg-transparent px-4 py-3 text-[14px] leading-[1.6] text-[#171A18] placeholder:text-[#949D97] focus:outline-none ${activeTab === "note" ? "placeholder:text-[#C7A163]" : ""}`}
                disabled={(activeTab === "reply" && isPending) || (activeTab === "note" && isSavingNote)}
                maxLength={1600}
                onChange={(event) => {
                  if (activeTab === "reply") {
                    requestId.current = null;
                    setBody(event.target.value);
                  } else {
                    setNoteBody(event.target.value);
                  }
                }}
                onBlur={() => {
                  if (activeTab === "note") {
                    saveNote();
                  }
                }}
                placeholder={activeTab === "reply" ? "Write a message..." : "Write a note..."}
                value={activeTab === "reply" ? body : noteBody}
              />
              
              {activeTab === "reply" && (
                <div className="flex items-center justify-between border-t border-[#EEF0EE] px-2 py-2">
                  <div className="flex items-center gap-1">
                    <button type="button" className="grid size-8 place-items-center rounded-[6px] text-[#949D97] hover:bg-[#F1F3F2] hover:text-[#66706A]">
                      <Paperclip size={18} />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded-[6px] text-[#949D97] hover:bg-[#F1F3F2] hover:text-[#66706A]">
                      <SmilePlus size={18} />
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <span className="text-[12px] font-medium text-[#949D97]">
                      {normalizedBody.length} characters · {credits} SMS {credits === 1 ? "credit" : "credits"}
                    </span>
                    <Button 
                      className="rounded-[8px] h-9 px-4 text-[14px] font-medium bg-[#246B4A] hover:bg-[#1C5339] text-white shadow-sm disabled:bg-[#EEF0EE] disabled:text-[#949D97] transition-colors"
                      disabled={isPending || normalizedBody.length === 0 || projectedSafetyCapReached} 
                      type="submit"
                    >
                      {isPending ? <LoaderCircle aria-hidden="true" className="mr-2 animate-spin" size={16} /> : null}
                      Send
                    </Button>
                  </div>
                </div>
              )}
              
              {activeTab === "note" && (
                <div className="flex items-center justify-end border-t border-[#F8E3C0] px-2 py-2">
                  <Button 
                    className="rounded-[8px] h-9 px-4 text-[14px] font-medium bg-[#E79913] hover:bg-[#C7810A] text-white shadow-sm disabled:bg-[#F1F3F2] disabled:text-[#949D97] transition-colors"
                    disabled={isSavingNote || noteBody === conversation.contactNotes} 
                    type="submit"
                  >
                    {isSavingNote ? <LoaderCircle aria-hidden="true" className="mr-2 animate-spin" size={16} /> : null}
                    Save Note
                  </Button>
                </div>
              )}
              
              {activeTab === "reply" && projectedSafetyCapReached ? (
                <p className="px-4 pb-3 pt-1 text-[13px] font-medium leading-5 text-[#B33B32]" role="alert">
                  This message would exceed your SMS credit safety limit.
                </p>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
