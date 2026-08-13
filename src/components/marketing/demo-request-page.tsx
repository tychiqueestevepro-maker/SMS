"use client";

import { ArrowLeft, ArrowRight, Check, Clock, EnvelopeSimple, Phone, UsersThree } from "@phosphor-icons/react";
import { track } from "@vercel/analytics";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState } from "react";

const ease = [0.32, 0.72, 0, 1] as const;

const inputClass =
  "mt-2 h-12 w-full rounded-lg border border-[#dce2dd] bg-white px-3 text-sm text-[#17211b] shadow-sm outline-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-[#a0a7a1] hover:border-[#bfc8c1] focus:border-[#249a46] focus:ring-4 focus:ring-[#249a46]/10";

export function DemoRequestPage() {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setSending(true);
    setResult(null);
    const data = new FormData(form);
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(data)),
      });
      const responseBody = await response.json() as { message?: string; ok?: boolean };
      if (!response.ok || !responseBody.ok) throw new Error(responseBody.message ?? "We could not send your request.");
      setResult({ tone: "success", message: "Your demo request has been sent. The Riink team will contact you shortly." });
      form.reset();
      if (document.cookie.includes("riink_cookie_consent=accepted")) track("demo_request_sent");
    } catch (error) {
      setResult({ tone: "error", message: error instanceof Error ? error.message : "We could not send your request. Please try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#fbfcfb] px-4 py-8 text-[#111311] sm:px-6 lg:px-8">
      <div className="hero-dots pointer-events-none absolute inset-0 opacity-25" />
      <div className="relative mx-auto max-w-[1200px]">
        <header className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15933b]">
            <Image alt="Riink" className="size-8 rounded-lg object-contain" height={32} src="/riink_logo_transparent.png" width={32} />
            <span className="text-xl font-semibold tracking-tight">Riink</span>
          </Link>
          <Link href="/" className="group inline-flex items-center gap-2 rounded-lg text-sm font-semibold text-[#536057] transition-colors hover:text-[#111311]">
            <ArrowLeft className="size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-x-1" /> Back to Riink
          </Link>
        </header>

        <div className="grid items-center gap-12 py-16 lg:grid-cols-[0.85fr_1.15fr] lg:py-20">
          <motion.section initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }}>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">Personalized demo</p>
            <h1 className="mt-4 max-w-[680px] text-balance text-5xl font-semibold tracking-tight md:text-6xl">See how Riink fits your outreach.</h1>
            <p className="mt-6 max-w-xl text-pretty text-base leading-6 text-[#687068]">Tell us how your team works. We will focus the conversation on contact imports, campaign preparation, phone numbers, sending, and reply management.</p>

            <div className="mt-10 space-y-4">
              {[
                [Clock, "A focused walkthrough", "A practical session built around your workflow."],
                [UsersThree, "Answers for your team", "Review setup, permissions, campaigns, and inbox collaboration."],
                [Phone, "Clear number setup", "Cover three Riink numbers and importing your existing numbers."],
              ].map(([Icon, title, copy]) => {
                const ItemIcon = Icon as typeof Clock;
                return (
                  <div key={String(title)} className="flex gap-4 rounded-2xl border border-[#e2e7e3] bg-white p-4 shadow-[0_10px_30px_rgba(24,48,29,0.04)]">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#eaf7ed] text-[#16923b]"><ItemIcon className="size-5" /></span>
                    <div><h2 className="text-base font-semibold">{String(title)}</h2><p className="mt-1 text-sm leading-5 text-[#707871]">{String(copy)}</p></div>
                  </div>
                );
              })}
            </div>

            <div className="mt-8 flex items-center gap-3 text-sm text-[#566159]"><span className="grid size-6 place-items-center rounded-full bg-[#e8f7eb] text-[#158f39]"><Check className="size-3" weight="bold" /></span>No commitment. Prepare your workspace for free.</div>
          </motion.section>

          <motion.section initial={{ opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 0.1, ease }} className="rounded-2xl border border-[#dce3dd] bg-white p-6 shadow-[0_30px_80px_rgba(16,35,20,0.11)] sm:p-8">
            <div className="flex items-start justify-between gap-6">
              <div><p className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">Request a demo</p><h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight">Tell us about your team</h2></div>
              <span className="hidden size-12 place-items-center rounded-xl bg-[#0a160d] text-[#57d874] sm:grid"><EnvelopeSimple className="size-6" /></span>
            </div>

            <form className="mt-8 grid gap-5 sm:grid-cols-2" onSubmit={submitRequest}>
              <label className="absolute -left-[9999px]" aria-hidden="true">Website<input autoComplete="off" name="website" tabIndex={-1} /></label>
              <label className="text-sm font-medium text-[#344139]">Full name<input autoComplete="name" className={inputClass} name="name" placeholder="Alex Morgan" required /></label>
              <label className="text-sm font-medium text-[#344139]">Work email<input autoComplete="email" className={inputClass} name="email" placeholder="alex@company.com" required type="email" /></label>
              <label className="text-sm font-medium text-[#344139]">Phone number<input autoComplete="tel" className={inputClass} name="phone" pattern="[+0-9 ()-]{7,24}" placeholder="+1 (415) 555 0139" required type="tel" /></label>
              <label className="text-sm font-medium text-[#344139]">Company<input autoComplete="organization" className={inputClass} name="company" placeholder="Your company" required /></label>
              <label className="text-sm font-medium text-[#344139]">Team size<select className={inputClass} defaultValue="" name="teamSize" required><option disabled value="">Select a range</option><option>1 to 5 people</option><option>6 to 20 people</option><option>21 to 50 people</option><option>More than 50 people</option></select></label>
              <label className="text-sm font-medium text-[#344139]">Monthly outreach volume<select className={inputClass} defaultValue="" name="volume" required><option disabled value="">Select a range</option><option>Under 2,000 messages</option><option>2,000 to 10,000 messages</option><option>10,001 to 50,000 messages</option><option>More than 50,000 messages</option></select></label>
              <label className="text-sm font-medium text-[#344139] sm:col-span-2">What would you like to cover?<textarea className="mt-2 min-h-32 w-full resize-y rounded-lg border border-[#dce2dd] bg-white p-3 text-sm text-[#17211b] shadow-sm outline-none transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-[#a0a7a1] hover:border-[#bfc8c1] focus:border-[#249a46] focus:ring-4 focus:ring-[#249a46]/10" maxLength={1200} name="goal" placeholder="Tell us about your current workflow, goals, or questions." required /></label>
              <div className="sm:col-span-2">
                <button className="group flex w-full items-center justify-center gap-2 rounded-lg bg-[#080a08] px-3 py-3 text-base font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-xl active:translate-y-px disabled:cursor-wait disabled:opacity-60" disabled={sending} type="submit">{sending ? "Preparing request…" : "Send demo request"}<ArrowRight className="size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" /></button>
                {result ? <p className={`mt-3 rounded-lg px-3 py-3 text-center text-sm ${result.tone === "success" ? "bg-[#e9f7ec] text-[#176f32]" : "bg-[#fff0ee] text-[#9a342d]"}`} role={result.tone === "success" ? "status" : "alert"}>{result.message}</p> : <p className="mt-3 text-center text-xs leading-5 text-[#7a837b]">Your request is sent securely to the Riink team.</p>}
              </div>
            </form>
          </motion.section>
        </div>
      </div>
    </main>
  );
}
