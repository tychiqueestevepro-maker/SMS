"use client";

import React, { useMemo, useState } from "react";
import {
  Filter,
  MessageSquare,
  Search,
  Send,
  ShieldCheck,
  Smile,
} from "lucide-react";

import { sendManualMessageAction } from "@/app/(app)/inbox/actions";
import type {
  CampaignResponseConversationDto,
  CampaignResponseStatus,
} from "@/components/campaigns/types";

type CampaignResponsesInboxProps = {
  responses: CampaignResponseConversationDto[];
  phoneNumberId: string | null;
};

export function CampaignResponsesInbox({
  responses,
  phoneNumberId,
}: CampaignResponsesInboxProps) {
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    responses[0]?.contactId ?? null,
  );
  const [replyBody, setReplyBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      all: responses.length,
      opted_out: responses.filter((r) => r.status === "opted_out").length,
      pending: responses.filter((r) => r.status === "pending").length,
      replied: responses.filter(
        (r) => r.status === "replied",
      ).length,
      sent: responses.filter((r) => r.status === "sent").length,
    }),
    [responses],
  );

  const filteredResponses = useMemo(() => {
    return responses.filter((r) => {
      const matchTab =
        activeTab === "all" ||
        (activeTab === "replied" && r.status === "replied") ||
        r.status === activeTab;
      const matchSearch =
        !searchQuery.trim() ||
        r.contactName.toLowerCase().includes(searchQuery.toLowerCase().trim()) ||
        r.lastMessageBody.toLowerCase().includes(searchQuery.toLowerCase().trim());
      return matchTab && matchSearch;
    });
  }, [responses, activeTab, searchQuery]);

  const selectedConversation = useMemo(
    () => responses.find((r) => r.contactId === selectedContactId) || filteredResponses[0] || null,
    [responses, selectedContactId, filteredResponses],
  );

  const handleSendReply = async () => {
    if (!replyBody.trim() || !selectedConversation || !phoneNumberId || isSending) return;

    setIsSending(true);
    setStatusNotice(null);
    try {
      const res = await sendManualMessageAction({
        body: replyBody.trim(),
        contactId: selectedConversation.contactId,
        phoneNumberId,
        requestId: crypto.randomUUID(),
      });

      if (res.ok) {
        setStatusNotice("Message sent successfully!");
        // Optimistically add message to current thread
        selectedConversation.messages.push({
          body: replyBody.trim(),
          direction: "outbound",
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        });
        setReplyBody("");
      } else {
        setStatusNotice(res.message || "Could not send message.");
      }
    } catch {
      setStatusNotice("Failed to send message.");
    } finally {
      setIsSending(false);
    }
  };

  function getStatusBadge(status: CampaignResponseStatus, replyVerified = false) {
    switch (status) {
      case "replied":
        return (
          <span
            className="inline-flex items-center gap-1 rounded bg-[#E9F5EE] px-2 py-0.5 text-[10px] font-bold text-[#07813F]"
            title={replyVerified ? "Provider-confirmed reply matched to this campaign" : undefined}
          >
            {replyVerified && <ShieldCheck size={11} aria-hidden="true" />}
            Provider-confirmed reply
          </span>
        );
      case "opted_out":
        return (
          <span className="rounded bg-[#FDECEC] px-2 py-0.5 text-[10px] font-bold text-[#DA4545]">
            Opted out
          </span>
        );
      case "sent":
        return (
          <span className="rounded bg-[#EAF3FF] px-2 py-0.5 text-[10px] font-bold text-[#0066FF]">
            Sent
          </span>
        );
      default:
        return (
          <span className="rounded bg-[#F2F4F3] px-2 py-0.5 text-[10px] font-bold text-[#66706A]">
            Pending
          </span>
        );
    }
  }

  function formatMsgTime(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  function formatReplyConfirmation(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "Reply matched to this campaign";
    return `Reply matched to this campaign on ${date.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    })}`;
  }

  return (
    <div className="rounded-2xl border border-[#E5E9E6] bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
        {/* LEFT RESPONSE PANEL (Width 5/12) */}
        <div className="border-r border-[#EEF0EE] lg:col-span-5 flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-[#EEF0EE]">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[#171A18]">Responses</h2>
              <span className="rounded-full bg-[#F2F4F3] px-2 py-0.5 text-[11px] font-semibold text-[#66706A]">
                {responses.length}
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="mt-3 flex items-center gap-1 overflow-x-auto border-b border-[#EEF0EE] pb-2">
              {[
                { id: "all", label: "All", count: counts.all },
                { id: "pending", label: "Pending", count: counts.pending },
                { id: "sent", label: "Sent", count: counts.sent },
                { id: "replied", label: "Replied", count: counts.replied },
                { id: "opted_out", label: "Opted out", count: counts.opted_out },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                      isActive
                        ? "bg-[#E9F5EE] text-[#07813F]"
                        : "text-[#66706A] hover:bg-[#F2F4F3] hover:text-[#171A18]"
                    }`}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    type="button"
                  >
                    <span>{tab.label}</span>
                    <span className="text-[10px] opacity-75">{tab.count}</span>
                  </button>
                );
              })}
            </div>

            {/* Search & Action Bar */}
            <div className="mt-3 flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#949D97]"
                />
                <input
                  className="h-8 w-full rounded-lg border border-[#E5E9E6] bg-white pl-8 pr-2 text-xs text-[#171A18] placeholder-[#949D97] focus:border-[#07813F] focus:outline-none"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search replies..."
                  type="text"
                  value={searchQuery}
                />
              </div>
              <button
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#E5E9E6] px-2.5 text-xs text-[#66706A] hover:bg-[#FBFCFB]"
                type="button"
              >
                <Filter size={13} />
                <span>Filters</span>
              </button>
            </div>
          </div>

          {/* Response Rows List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#EEF0EE] max-h-[380px]">
            {filteredResponses.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#66706A]">
                No responses found matching your filter.
              </div>
            ) : (
              filteredResponses.map((r) => {
                const isSelected = selectedConversation?.contactId === r.contactId;
                const initials = r.contactName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div
                    className={`flex cursor-pointer items-start justify-between p-3.5 transition-colors ${
                      isSelected
                        ? "bg-[#E9F5EE] border-l-4 border-l-[#07813F]"
                        : "hover:bg-[#FBFCFB]"
                    }`}
                    key={r.contactId}
                    onClick={() => setSelectedContactId(r.contactId)}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1 pr-2">
                      <div className="grid size-9 flex-shrink-0 place-items-center rounded-full bg-[#EAF3FF] font-semibold text-xs text-[#0066FF]">
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="truncate text-xs font-semibold text-[#171A18]">
                            {r.contactName}
                          </p>
                          {getStatusBadge(r.status, r.replyVerified)}
                        </div>
                        {r.company && (
                          <p className="truncate text-[11px] text-[#66706A]">{r.company}</p>
                        )}
                        <p className="mt-1 line-clamp-1 text-xs text-[#66706A]">
                          {r.lastMessageBody}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT CONVERSATION PANEL (Width 7/12) */}
        <div className="lg:col-span-7 flex flex-col bg-white">
          {!selectedConversation ? (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-xs text-[#66706A]">
              <MessageSquare size={24} className="text-[#949D97]" />
              <p className="mt-2 font-medium">Select a conversation</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-[#EEF0EE] p-4">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full bg-[#EAF3FF] font-semibold text-xs text-[#0066FF]">
                    {selectedConversation.contactName
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#171A18]">
                      {selectedConversation.contactName}
                    </h3>
                    <p className="text-xs text-[#66706A]">
                      {selectedConversation.company
                        ? `${selectedConversation.company} • `
                        : ""}
                      {selectedConversation.phone}
                    </p>
                    {selectedConversation.replyVerified && selectedConversation.replyReceivedAt && (
                      <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-[#07813F]">
                        <ShieldCheck size={11} aria-hidden="true" />
                        {formatReplyConfirmation(selectedConversation.replyReceivedAt)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {getStatusBadge(selectedConversation.status, selectedConversation.replyVerified)}
                </div>
              </div>

              {/* Message Thread */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 max-h-[320px]">
                {selectedConversation.messages.length === 0 ? (
                  <div className="text-center text-xs text-[#949D97] py-6">
                    No previous messages.
                  </div>
                ) : (
                  selectedConversation.messages.map((msg, i) => {
                    const isOutbound = msg.direction === "outbound";
                    return (
                      <div
                        className={`flex flex-col ${
                          isOutbound ? "items-end" : "items-start"
                        }`}
                        key={msg.id || i}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] text-[#949D97] mb-1">
                          <span className="font-semibold text-[#66706A]">
                            {isOutbound ? "You" : selectedConversation.contactName}
                          </span>
                          <span>•</span>
                          <span>{formatMsgTime(msg.timestamp)}</span>
                        </div>
                        <div
                          className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                            isOutbound
                              ? "bg-[#E9F5EE] text-[#171A18] rounded-tr-none border border-[#C2E8D2]"
                              : "bg-[#F2F4F3] text-[#171A18] rounded-tl-none border border-[#E5E9E6]"
                          }`}
                        >
                          {msg.body}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply Composer */}
              <div className="border-t border-[#EEF0EE] p-4 bg-[#FBFCFB]">
                {statusNotice && (
                  <div className="mb-2 text-[11px] font-medium text-[#07813F]">
                    {statusNotice}
                  </div>
                )}
                <div className="rounded-xl border border-[#E5E9E6] bg-white p-3 shadow-xs">
                  <textarea
                    className="w-full text-xs text-[#171A18] placeholder-[#949D97] focus:outline-none resize-none"
                    disabled={selectedConversation.optedOut}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder={
                      selectedConversation.optedOut
                        ? "Contact has opted out."
                        : "Write your message..."
                    }
                    rows={2}
                    value={replyBody}
                  />

                  <div className="mt-2 flex items-center justify-between border-t border-[#EEF0EE] pt-2">
                    <div className="flex items-center gap-2 text-[#949D97]">
                      <button className="hover:text-[#171A18]" type="button">
                        <Smile size={16} />
                      </button>
                    </div>

                    <button
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#07813F] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      disabled={!replyBody.trim() || isSending || selectedConversation.optedOut}
                      onClick={handleSendReply}
                      type="button"
                    >
                      <Send size={13} />
                      <span>{isSending ? "Sending..." : "Send"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
