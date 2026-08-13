"use client";

import { ArrowLeft, Check, Info, LayoutTemplate, MessageCircle, MoreVertical, Search, Tag, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition, useEffect } from "react";

import { moveInboxContactStageAction, deleteInboxConversationAction, markConversationReadAction } from "@/app/(app)/inbox/actions";
import { ManualComposer } from "@/components/inbox/manual-composer";
import { InboxRealtimeRefresh } from "@/components/inbox/realtime-refresh";
import type { InboxActionResult, InboxConversationViewDto, InboxPageData } from "@/components/inbox/types";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import { CountryFlagBadge } from "@/components/campaigns/phone-number-identity"; 
import { formatPhoneNumberDisplay } from "@/components/campaigns/phone-number-identity";
import { parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";

function formatListTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(date);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

const deliveryLabels = {
  delivered: "✓✓",
  failed: "Failed",
  pending: "Sending...",
  sent: "✓",
} as const;

function MessageBubble({ message }: { message: InboxConversationViewDto["messages"][0] }) {
  const outbound = message.direction === "outbound";
  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] sm:max-w-[62%] ${outbound ? "items-end" : "items-start"}`}>
        <div className={`whitespace-pre-wrap px-4 py-3 text-[14px] leading-[1.6] ${outbound ? "rounded-[16px] rounded-br-[4px] bg-[#246B4A] text-white" : "rounded-[16px] rounded-bl-[4px] border border-[#EEF0EE] bg-white text-[#171A18] shadow-sm"}`}>
          {message.body}
        </div>
        <p className={`mt-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium ${outbound && message.deliveryStatus === "failed" ? "text-[#b33b32]" : "text-[#949D97]"} ${outbound ? "justify-end" : "justify-start"}`}>
          {formatMessageTime(message.occurredAt)}
          {outbound ? <span className="tracking-widest">{deliveryLabels[message.deliveryStatus]}</span> : null}
        </p>
      </div>
    </div>
  );
}

function DateSeparator({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const formatted = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  return (
    <div className="my-6 flex items-center justify-center gap-4">
      <div className="h-px w-12 bg-[#EEF0EE]" />
      <span className="text-[11px] font-medium tracking-wide text-[#949D97] uppercase">{formatted}</span>
      <div className="h-px w-12 bg-[#EEF0EE]" />
    </div>
  );
}

function ConversationList({
  conversations,
  onSelect,
  search,
  selectedId,
  setSearch,
  filter,
  setFilter,
  sort,
  setSort,
}: {
  conversations: InboxConversationViewDto[];
  onSelect: (id: string) => void;
  search: string;
  selectedId: string | null;
  setSearch: (value: string) => void;
  filter: "all" | "unread" | "replied" | "opted_out";
  setFilter: (val: "all" | "unread" | "replied" | "opted_out") => void;
  sort: "newest" | "oldest";
  setSort: (val: "newest" | "oldest") => void;
}) {
  const countAll = conversations.length;
  const countReplied = conversations.filter(c => c.sequenceStoppedOnReply).length;
  const countOptedOut = conversations.filter(c => c.isSuppressed).length;
  const countUnread = conversations.filter(c => c.hasUnreadMessages).length;

  return (
    <aside className="flex min-h-0 flex-col border-r border-[#EEF0EE] bg-white">
      <div className="p-4 pb-0">
        <div className="relative">
          <Search aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#949D97]" size={16} />
          <input 
            aria-label="Search conversations" 
            className="h-10 w-full rounded-lg border border-[#E5E9E6] bg-[#FBFCFB] pl-10 pr-3 text-[14px] text-[#171A18] placeholder-[#949D97] focus:border-[#246B4A] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#246B4A]" 
            onChange={(event) => setSearch(event.target.value)} 
            placeholder="Search conversations" 
            type="search" 
            value={search} 
          />
        </div>
        
        <div className="mt-4 flex items-center justify-between border-b border-[#EEF0EE]">
          <div className="flex gap-5">
            <FilterTab active={filter === "all"} label="All" count={countAll} onClick={() => setFilter("all")} />
            <FilterTab active={filter === "unread"} label="Unread" count={countUnread} onClick={() => setFilter("unread")} />
            <FilterTab active={filter === "replied"} label="Replied" onClick={() => setFilter("replied")} />
            <FilterTab active={filter === "opted_out"} label="Opted out" onClick={() => setFilter("opted_out")} />
          </div>
          <div className="pb-3">
            <button 
              onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}
              className="flex items-center gap-1 text-[13px] font-medium text-[#66706A] hover:text-[#171A18]"
            >
              {sort === "newest" ? "Newest" : "Oldest"} <span className="text-[10px]">{sort === "newest" ? "▼" : "▲"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.map((conversation) => {
          const lastMessage = conversation.messages.at(-1);
          const isSelected = selectedId === conversation.id;
          
          const nameStr = conversation.contactLabel;
          let initialsFirst = "";
          let initialsLast = "";
          if (nameStr && nameStr !== conversation.contactPhoneNumber) {
            const parts = nameStr.split(" ");
            initialsFirst = parts[0] || "";
            initialsLast = parts.slice(1).join(" ") || "";
          }

          return (
            <button
              className={`w-full border-b border-[#EEF0EE] px-4 py-3.5 text-left transition-colors ${isSelected ? "bg-[#EDF8F1]" : "bg-white hover:bg-[#FBFCFB]"}`}
              key={conversation.id}
              onClick={() => onSelect(conversation.id)}
              type="button"
            >
              <div className="flex items-start gap-3.5">
                <div className="relative mt-0.5">
                  <AvatarInitials firstName={initialsFirst} lastName={initialsLast} />
                  {conversation.hasUnreadMessages && (
                    <span className="absolute -right-0.5 -top-0.5 z-10 h-3 w-3 rounded-full border-2 border-white bg-[#246B4A]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`truncate text-[14px] ${isSelected || conversation.hasUnreadMessages ? "font-bold text-[#171A18]" : "font-semibold text-[#171A18]"}`}>{conversation.contactLabel}</span>
                    <span className={`shrink-0 text-[12px] ${conversation.hasUnreadMessages ? "font-semibold text-[#246B4A]" : "text-[#949D97]"}`}>{formatListTime(conversation.lastMessageAt)}</span>
                  </div>
                  {conversation.contactCompany && (
                    <span className="mt-0.5 block truncate text-[12px] text-[#949D97]">
                      {conversation.contactCompany}
                    </span>
                  )}
                  <span className="mt-1 block truncate text-[13px] text-[#66706A]">
                    {lastMessage?.direction === "outbound" ? "You: " : ""}{lastMessage?.body ?? ""}
                  </span>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {conversation.isSuppressed ? (
                      <span className="inline-flex items-center rounded-full bg-[#FFF4DE] px-2 py-0.5 text-[11px] font-medium text-[#B37000]">Opted out</span>
                    ) : null}
                    {conversation.sequenceStoppedOnReply ? (
                      <span className="inline-flex items-center rounded-full bg-[#E9F5EE] px-2 py-0.5 text-[11px] font-medium text-[#246B4A]">Replied</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {conversations.length === 0 ? (
          <div className="grid min-h-[200px] place-items-center px-5 text-center">
            <div>
              <p className="text-[14px] font-medium text-[#66706A]">No conversations found</p>
            </div>
          </div>
        ) : null}
      </div>
      
      <div className="border-t border-[#EEF0EE] bg-[#FBFCFB] p-3 text-center text-[12px] text-[#949D97]">
        Showing 1 to {conversations.length} conversations
      </div>
    </aside>
  );
}

function FilterTab({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`relative pb-3 text-[13px] font-medium transition-colors ${active ? "text-[#171A18]" : "text-[#949D97] hover:text-[#66706A]"}`}
    >
      <span className="flex items-center gap-1.5">
        {label}
        {count !== undefined && count > 0 && (
          <span className={`inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-[#E9F5EE] text-[#246B4A]" : "bg-[#F1F3F2] text-[#949D97]"}`}>
            {count}
          </span>
        )}
      </span>
      {active && (
        <span className="absolute bottom-0 left-0 h-0.5 w-full rounded-t-full bg-[#246B4A]" />
      )}
    </button>
  );
}

export function InboxWorkspace({ conversations, effectiveCredits, messagingAvailable, safetyCapCredits, safetyCapReached, stages, workspaceId }: InboxPageData) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "replied" | "opted_out">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [notice, setNotice] = useState<InboxActionResult | null>(null);
  const [isChangingStage, startChangingStage] = useTransition();
  const threadEndRef = useRef<HTMLDivElement>(null);
  
  const filtered = useMemo(() => {
    let result = conversations;
    if (filter === "unread") result = result.filter(c => c.hasUnreadMessages);
    if (filter === "replied") result = result.filter(c => c.sequenceStoppedOnReply);
    if (filter === "opted_out") result = result.filter(c => c.isSuppressed);
    
    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((conversation) => [conversation.contactLabel, conversation.contactPhoneNumber, conversation.messages.at(-1)?.body ?? "", conversation.contactCompany].some((value) => value?.toLowerCase().includes(query)));
    }
    
    return [...result].sort((a, b) => {
      const timeA = new Date(a.lastMessageAt).getTime();
      const timeB = new Date(b.lastMessageAt).getTime();
      return sort === "newest" ? timeB - timeA : timeA - timeB;
    });
  }, [conversations, search, filter, sort]);
  
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0] ?? null;

  const messageGroups = useMemo(() => {
    if (!selected) return [];
    const groups: { date: string, messages: typeof selected.messages }[] = [];
    selected.messages.forEach(msg => {
      const d = new Date(msg.occurredAt).toDateString();
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.date === d) lastGroup.messages.push(msg);
      else groups.push({ date: d, messages: [msg] });
    });
    return groups;
  }, [selected]);

  useEffect(() => {
    const timer = setTimeout(() => {
      threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 50);
    return () => clearTimeout(timer);
  }, [selected?.id, selected?.messages.length]);

  function selectConversation(id: string) {
    setSelectedId(id);
    const conversation = conversations.find(c => c.id === id);
    if (conversation && conversation.hasUnreadMessages) {
      startChangingStage(async () => {
        await markConversationReadAction(conversation.contactId);
        router.refresh();
      });
    }
    setMobileThreadOpen(true);
    setNotice(null);
  }

  function changeStage(stageId: string) {
    if (!selected || selected.deletedContact) return;
    startChangingStage(async () => {
      const result = await moveInboxContactStageAction(selected.contactId, stageId);
      setNotice(result);
      if (result.ok) router.refresh();
    });
  }

  if (conversations.length === 0) {
    return (
      <div className="grid min-h-[600px] place-items-center rounded-[12px] border border-[#E5E9E6] bg-white px-6 py-14 text-center shadow-sm">
        <div className="max-w-sm">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#E9F5EE] text-[#246B4A]"><MessageCircle aria-hidden="true" size={24} /></span>
          <h2 className="mt-5 text-[18px] font-semibold text-[#171A18]">No conversations yet</h2>
          <p className="mt-2 text-[14px] leading-[1.6] text-[#66706A]">Replies and messages from your contacts will appear here.</p>
        </div>
        <InboxRealtimeRefresh workspaceId={workspaceId} />
      </div>
    );
  }

  const selectedCountryCode = selected ? parseAndNormalizePhoneNumber(selected.contactPhoneNumber)?.countryCode ?? "US" : "US";

  return (
    <>
      <div className="h-[calc(100vh-160px)] min-h-[600px] overflow-hidden rounded-[12px] border border-[#EEF0EE] bg-white shadow-sm">
        <div className="grid h-full md:grid-cols-[minmax(360px,32%)_minmax(0,1fr)]">
          <div className={`${mobileThreadOpen ? "hidden" : "block"} min-h-0 md:block`}>
            <ConversationList conversations={filtered} onSelect={selectConversation} search={search} selectedId={selected?.id ?? null} setSearch={setSearch} filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} />
          </div>
          
          <section className={`${mobileThreadOpen ? "flex" : "hidden"} min-h-0 flex-col bg-[#FBFCFB] md:flex`}>
            {selected ? (
              <>
                {/* Contact Header */}
                <header className="border-b border-[#EEF0EE] bg-white px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <button aria-label="Back to conversations" className="grid size-8 place-items-center rounded-lg text-[#66706A] hover:bg-[#F1F3F2] md:hidden" onClick={() => setMobileThreadOpen(false)} type="button"><ArrowLeft aria-hidden="true" size={18} /></button>
                      
                      <AvatarInitials firstName={selected.contactLabel.split(' ')[0] || ''} lastName={selected.contactLabel.split(' ').slice(1).join(' ') || ''} />
                      
                      <div>
                        <h2 className="text-[16px] font-bold text-[#171A18] flex items-center gap-2">
                          {selected.contactLabel}
                          {selected.deletedContact ? <span className="rounded bg-[#F1F3F2] px-1.5 py-0.5 text-[10px] font-medium text-[#66706A] uppercase tracking-wider">Deleted</span> : null}
                          {selected.isSuppressed ? <span className="rounded bg-[#FFF4DE] px-1.5 py-0.5 text-[10px] font-medium text-[#B37000] uppercase tracking-wider">Opted out</span> : null}
                        </h2>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#66706A]">
                          <CountryFlagBadge countryCode={selectedCountryCode} />
                          <span>{formatPhoneNumberDisplay(selected.contactPhoneNumber)}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={async () => {
                          startChangingStage(async () => {
                            const result = await deleteInboxConversationAction(selected.contactId);
                            setNotice(result);
                            if (result.ok) {
                              setSelectedId(null);
                              router.refresh();
                            }
                          });
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-3 text-[13px] font-medium text-[#8f312a] hover:bg-[#fae6e4]"
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                </header>

                {/* Campaign Context Strip */}
                {selected.campaignContext && (
                  <div className="flex items-center justify-between border-b border-[#E9F5EE] bg-[#F4FAF6] px-5 py-2.5 text-[12px]">
                    <div className="flex items-center gap-2 font-medium text-[#246B4A]">
                      <Info size={14} className="text-[#246B4A]" />
                      <span>Campaign: {selected.campaignContext.name}</span>
                      <span className="text-[#9DBFB0]">•</span>
                      <span>Message {selected.campaignContext.stepOrder}</span>
                    </div>
                    {selected.sequenceStoppedOnReply && (
                      <div className="flex items-center gap-2 font-medium text-[#246B4A]">
                        <span>Contact replied</span>
                        <span className="text-[#9DBFB0]">•</span>
                        <span>Sequence stopped</span>
                        <Check size={14} />
                      </div>
                    )}
                  </div>
                )}

                {notice ? (
                  <div className={`mx-5 mt-4 flex items-center justify-between gap-3 rounded-[8px] border px-4 py-3 text-[13px] ${notice.ok ? "border-[#cce2d3] bg-[#eff8f2] text-[#235f43]" : "border-[#f0cbc6] bg-[#fff3f1] text-[#8f312a]"}`} role={notice.ok ? "status" : "alert"}>
                    <span>{notice.message}</span>
                    <button aria-label="Dismiss" onClick={() => setNotice(null)} type="button"><X aria-hidden="true" size={16} /></button>
                  </div>
                ) : null}

                {/* Thread */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
                  {messageGroups.map((group) => (
                    <div key={group.date}>
                      <DateSeparator dateStr={group.date} />
                      <div className="space-y-5">
                        {group.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                      </div>
                    </div>
                  ))}
                  
                  {/* Sequence Stopped Info Box inside thread */}
                  {selected.sequenceStoppedOnReply && (
                    <div className="mx-auto mt-8 flex max-w-lg items-center justify-center gap-2 rounded-lg border border-[#FFF4DE] bg-[#FFFCF6] px-4 py-3 text-[12px] text-[#B37000]">
                      <Info size={14} />
                      This contact has replied. The campaign sequence has been stopped for this contact.
                    </div>
                  )}
                  
                  <div ref={threadEndRef} className="h-4" />
                </div>
                
                {/* Composer */}
                <ManualComposer
                  conversation={selected}
                  effectiveCredits={effectiveCredits}
                  key={selected.id}
                  messagingAvailable={messagingAvailable}
                  onResult={setNotice}
                  safetyCapReached={safetyCapReached}
                  safetyCapCredits={safetyCapCredits}
                />
              </>
            ) : (
              <div className="grid flex-1 place-items-center">
                <div className="text-center">
                  <LayoutTemplate className="mx-auto mb-3 text-[#E5E9E6]" size={40} />
                  <h3 className="text-[16px] font-semibold text-[#171A18]">Select a conversation</h3>
                  <p className="mt-1 text-[14px] text-[#949D97]">Choose a conversation from the list to view its messages.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      <InboxRealtimeRefresh workspaceId={workspaceId} />
    </>
  );
}
