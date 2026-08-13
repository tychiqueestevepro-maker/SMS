"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChatCircleDots,
  CheckCircle,
  MagnifyingGlass,
  PaperPlaneTilt,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type View = "chat" | "help" | "article";

type Article = {
  category: string;
  description: string;
  href: string;
  id: string;
  steps: string[];
  title: string;
  visual: "campaign" | "contacts" | "number" | "inbox" | "billing";
};

const articles: Article[] = [
  { id: "launch-campaign", category: "Campaigns", title: "Create and launch a campaign", description: "Prepare the message, choose recipients, review, then launch.", href: "/campaigns/new", visual: "campaign", steps: ["Open Campaigns and select New campaign.", "Name the campaign, select a sending number and write your SMS.", "Choose a contact list and check the recipient count.", "Review the summary. Sending only begins when you confirm the launch."] },
  { id: "campaign-status", category: "Campaigns", title: "Understand campaign statuses", description: "Know when a campaign is a draft, scheduled, active or complete.", href: "/campaigns", visual: "campaign", steps: ["Draft means the campaign has not sent any SMS.", "Scheduled campaigns wait until the date and time you selected.", "Active campaigns are currently processing recipients.", "Completed campaigns show final delivery and reply results."] },
  { id: "add-number", category: "Phone numbers", title: "Add a Riink phone number", description: "Get a new number included with your workspace.", href: "/settings#numbers", visual: "number", steps: ["Open Settings and go to Phone numbers.", "Select Get a number and enter the requested area code.", "Choose one of the available numbers.", "Complete the business information. Riink will show the activation status."] },
  { id: "import-number", category: "Phone numbers", title: "Import an existing number", description: "Connect a number you already own to Riink.", href: "/settings#numbers", visual: "number", steps: ["Open Settings and go to Phone numbers.", "Select Import a number.", "Enter the number and follow the verification instructions.", "Wait for the Ready status before using it in a campaign."] },
  { id: "import-contacts", category: "Contacts", title: "Import contacts from CSV", description: "Bring a contact list into Riink and map its fields.", href: "/contacts", visual: "contacts", steps: ["Open Contacts and select the import option.", "Upload a CSV containing a phone number column.", "Match your file columns to the Riink contact fields.", "Review invalid or duplicate rows before confirming the import."] },
  { id: "manage-replies", category: "Inbox", title: "Read and answer replies", description: "Handle every conversation from the shared inbox.", href: "/inbox", visual: "inbox", steps: ["Open Inbox and select a conversation.", "Read the contact history and campaign context.", "Write your reply in the message field.", "Send the reply. Unread indicators update for the whole team."] },
  { id: "sms-credits", category: "Billing", title: "How SMS credits work", description: "Understand included credits and outbound usage.", href: "/settings#billing", visual: "billing", steps: ["Open Settings and go to Billing.", "The usage card shows consumed credits and your safety cap.", "Outbound SMS use credits according to the current plan terms.", "Incoming replies do not need a campaign launch action."] },
  { id: "activate-account", category: "Billing", title: "Activate your Riink account", description: "Complete the required steps before launching a campaign.", href: "/settings#billing", visual: "billing", steps: ["Add or import a phone number in Settings. A number is required before the subscription can activate.", "Open Billing and select Add payment method.", "Enter your card details in the secure payment form.", "Once the number and payment method are ready, Riink activates the subscription and enables campaign sending."] },
  { id: "payment-process", category: "Billing", title: "How payment works", description: "Understand the monthly plan, included credits and additional usage.", href: "/settings#billing", visual: "billing", steps: ["Your payment method is saved securely through the payment provider. Riink does not store card details.", "The monthly plan includes the SMS credits displayed in Billing.", "Usage beyond the included credits follows the additional credit price shown in your plan.", "Use Manage billing to update payment details and view provider documents."] },
  { id: "payment-failed", category: "Billing", title: "Resolve a payment problem", description: "Update your payment method and restore sending access.", href: "/settings#billing", visual: "billing", steps: ["Open Settings and go to Billing.", "Check the subscription notice for the current payment status.", "Select Manage billing and update the payment method.", "Return to Riink and refresh the page. Sending access returns when the payment status is confirmed."] },
];

function ProductVisual({ type }: { type: Article["visual"] }) {
  const labels = {
    campaign: ["Campaign details", "Message", "Recipients", "Review and launch"],
    contacts: ["Upload CSV", "Map columns", "Review contacts", "Import"],
    number: ["Phone numbers", "Get a number", "Import a number", "Status: Ready"],
    inbox: ["Conversations", "Contact details", "Write a reply", "Send"],
    billing: ["SMS usage", "Included credits", "Safety cap", "Billing details"],
  }[type];

  return (
    <div className="overflow-hidden rounded-xl border border-[#dce5de] bg-[#f7f9f7]" role="img" aria-label={`Riink ${type} screen overview`}>
      <div className="flex h-7 items-center gap-1.5 border-b border-[#dce5de] bg-white px-3">
        <span className="size-1.5 rounded-full bg-[#27ad4b]" />
        <span className="size-1.5 rounded-full bg-[#dce5de]" />
        <span className="ml-2 h-2 w-16 rounded-full bg-[#edf1ee]" />
      </div>
      <div className="grid grid-cols-[68px_1fr]">
        <div className="space-y-2 bg-black p-2">
          <span className="block h-3 w-9 rounded bg-[#27ad4b]" />
          {[1, 2, 3, 4].map((item) => <span className="block h-2 rounded bg-white/10" key={item} />)}
        </div>
        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between"><span className="h-3 w-24 rounded bg-[#111]" /><span className="h-6 w-16 rounded-lg bg-[#27ad4b]" /></div>
          {labels.map((label, index) => (
            <div className={`flex items-center gap-2 rounded-lg border p-2 ${index === labels.length - 1 ? "border-[#9cdda9] bg-[#eaf8ed]" : "border-[#e1e7e2] bg-white"}`} key={label}>
              <span className={`grid size-4 place-items-center rounded-full text-[8px] font-semibold ${index === labels.length - 1 ? "bg-[#27ad4b] text-black" : "bg-[#edf1ee] text-[#68736c]"}`}>{index + 1}</span>
              <span className="text-[9px] font-medium text-[#344139]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function QuickActionBubble() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("chat");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(articles[0].id);
  const [message, setMessage] = useState("");
  const [lastMessage, setLastMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = articles.find((article) => article.id === selectedId) ?? articles[0];
  const filtered = useMemo(() => articles.filter((article) => `${article.category} ${article.title} ${article.description}`.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const onPointer = (event: PointerEvent) => { if (!panelRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); };
  }, [open]);

  async function sendSupportMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const response = await fetch("/api/support-message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, website: "" }) });
    if (!response.ok) { setStatus("error"); return; }
    setLastMessage(message);
    setMessage("");
    setStatus("sent");
  }

  function header(title: string) {
    return <div className="flex items-center justify-between border-b border-white/10 bg-black p-4 text-white"><div className="flex items-center gap-3">{view === "article" ? <button aria-label="Back to help" className="grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setView("help")}><ArrowLeft size={18} /></button> : null}<div><p className="text-sm font-semibold">{title}</p><p className="text-xs text-white/45">Riink support</p></div></div><button aria-label="Close help" className="grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setOpen(false)}><X size={18} /></button></div>;
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 sm:bottom-8 sm:right-8" ref={panelRef}>
      <section aria-hidden={!open} aria-label="Riink help center" className={`absolute bottom-16 right-0 flex h-[min(680px,calc(100vh-112px))] w-[min(400px,calc(100vw-32px))] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-[#dce5de] bg-white shadow-[0_24px_70px_rgb(7_16_9/0.22)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-4 scale-95 opacity-0"}`}>
        {view === "chat" ? <>{header("Riink messages")}<div className="flex min-h-0 flex-1 flex-col bg-[#f7f9f7]"><div className="flex-1 space-y-3 overflow-y-auto p-4"><div className="flex items-end gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-black text-[#27ad4b]"><ChatCircleDots size={15} weight="fill" /></span><div className="max-w-[78%] rounded-2xl rounded-bl-md bg-[#e6e7e8] px-3 py-2 text-sm leading-5 text-[#171917]">Bonjour, comment pouvons-nous vous aider aujourd’hui ? Décrivez votre question ou le problème rencontré.</div></div>{status === "sent" ? <><div className="flex justify-end"><div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#27ad4b] px-3 py-2 text-sm leading-5 text-[#071009]">{lastMessage}</div></div><div className="flex items-end gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-black text-[#27ad4b]"><CheckCircle size={15} weight="fill" /></span><div className="max-w-[78%] rounded-2xl rounded-bl-md bg-[#e6e7e8] px-3 py-2 text-sm leading-5 text-[#171917]">Votre message a bien été reçu. Vous allez être contacté dans les prochaines minutes.</div></div></> : null}</div><form className="border-t border-[#dce5de] bg-white p-3" onSubmit={sendSupportMessage}><div className="flex items-end gap-2 rounded-2xl border border-[#d1d9d3] bg-white p-1.5 pl-3 focus-within:border-[#27ad4b] focus-within:ring-3 focus-within:ring-[#27ad4b]/15"><textarea aria-label="Message to Riink support" className="max-h-28 min-h-9 flex-1 resize-none bg-transparent py-2 text-sm outline-none" minLength={10} onChange={(event) => { setMessage(event.target.value); if (status === "sent") setStatus("idle"); }} placeholder="Message…" required rows={1} value={message} /><input aria-hidden="true" className="hidden" name="website" tabIndex={-1} /><button aria-label="Send message" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#27ad4b] text-[#071009] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#37c75a] active:scale-[0.96] disabled:opacity-40" disabled={status === "sending" || message.trim().length < 10} type="submit"><PaperPlaneTilt size={17} weight="fill" /></button></div>{status === "error" ? <p className="mt-2 px-2 text-xs text-[#b33b32]" role="alert">Le message n’a pas pu être envoyé. Réessayez.</p> : null}</form></div></> : null}

        {view === "help" ? <>{header("Help center")}<div className="flex-1 overflow-y-auto p-4"><div className="relative"><MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7a857e]" size={17} /><input aria-label="Search help articles" className="h-11 w-full rounded-lg border border-[#dce5de] pl-10 pr-3 text-sm focus:border-[#27ad4b] focus:outline-none focus:ring-3 focus:ring-[#27ad4b]/15" onChange={(event) => setQuery(event.target.value)} placeholder="Search the help center…" value={query} /></div><div className="mt-4 space-y-5">{[...new Set(filtered.map((article) => article.category))].map((category) => <div key={category}><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#168936]">{category}</p><div className="overflow-hidden rounded-xl border border-[#e1e7e2]">{filtered.filter((article) => article.category === category).map((article) => <button className="group flex w-full items-center gap-3 border-b border-[#e8ede9] p-3 text-left last:border-b-0 hover:bg-[#f6fbf7]" key={article.id} onClick={() => { setSelectedId(article.id); setView("article"); }}><span className="flex-1"><span className="block text-sm font-semibold">{article.title}</span><span className="mt-0.5 block text-xs text-[#6b756e]">{article.description}</span></span><ArrowRight className="text-[#96a098] group-hover:text-[#168936]" size={16} /></button>)}</div></div>)}{filtered.length === 0 ? <p className="py-8 text-center text-sm text-[#6b756e]">No guide matches this search. Send us a message and we will help.</p> : null}</div></div></> : null}

        {view === "article" ? <>{header(selected.title)}<article className="flex-1 overflow-y-auto p-4"><ProductVisual type={selected.visual} /><p className="mt-4 text-sm leading-6 text-[#59635c]">{selected.description}</p><ol className="mt-4 space-y-3">{selected.steps.map((step, index) => <li className="flex gap-3 text-sm leading-5 text-[#344139]" key={step}><span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#eaf8ed] text-xs font-semibold text-[#168936]">{index + 1}</span><span className="pt-0.5">{step}</span></li>)}</ol><Link className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white hover:bg-[#27ad4b] hover:text-black" href={selected.href} onClick={() => setOpen(false)}>Open this page <ArrowRight size={16} /></Link><button className="mt-2 w-full rounded-lg px-3 py-2 text-sm font-semibold text-[#59635c] hover:bg-[#f2f7f3]" onClick={() => setView("chat")}>I still need help</button></article></> : null}

        <nav aria-label="Support navigation" className="grid shrink-0 grid-cols-2 border-t border-[#dce5de] bg-white p-2">
          <button aria-current={view === "chat" ? "page" : undefined} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${view === "chat" ? "bg-[#eaf8ed] text-[#168936]" : "text-[#7a857e] hover:bg-[#f2f7f3] hover:text-[#344139]"}`} onClick={() => setView("chat")} type="button"><ChatCircleDots size={18} weight={view === "chat" ? "fill" : "regular"} />Chat</button>
          <button aria-current={view === "help" || view === "article" ? "page" : undefined} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${view === "help" || view === "article" ? "bg-[#eaf8ed] text-[#168936]" : "text-[#7a857e] hover:bg-[#f2f7f3] hover:text-[#344139]"}`} onClick={() => setView("help")} type="button"><BookOpenText size={18} weight={view === "help" || view === "article" ? "fill" : "regular"} />Help</button>
        </nav>
      </section>

      <button aria-expanded={open} aria-label={open ? "Close Riink help" : "Open Riink help"} className={`group relative grid size-14 place-items-center rounded-full border shadow-[0_16px_38px_rgb(7_16_9/0.24)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-4 focus-visible:ring-[#27ad4b]/25 active:scale-[0.96] ${open ? "border-white/15 bg-black text-white" : "border-[#45c263] bg-[#27ad4b] text-[#071009] hover:-translate-y-1 hover:bg-[#37c75a]"}`} onClick={() => setOpen((current) => !current)} type="button">{open ? <X size={22} weight="bold" /> : <ChatCircleDots size={24} weight="fill" />}</button>
    </div>
  );
}
