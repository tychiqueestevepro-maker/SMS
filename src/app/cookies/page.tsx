import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Cookie policy", description: "How Riink uses cookies and privacy focused analytics." };

export default function CookiePolicyPage() {
  return (
    <main className="min-h-screen bg-[#fbfcfb] px-4 py-16 text-[#17211b] sm:px-6">
      <article className="mx-auto max-w-3xl rounded-2xl border border-[#e1e6e2] bg-white p-8 shadow-[0_20px_60px_rgba(20,44,25,0.07)] sm:p-12">
        <Link href="/" className="text-sm font-semibold text-[#198f3b]">← Back to Riink</Link>
        <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-[#15933b]">Privacy</p>
        <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight">Cookie policy</h1>
        <p className="mt-4 text-sm leading-6 text-[#68736c]">Last updated August 12, 2026.</p>
        <section className="mt-10"><h2 className="text-xl font-semibold">Essential preference cookie</h2><p className="mt-3 text-pretty text-sm leading-6 text-[#5f6961]">Riink stores <code>riink_cookie_consent</code> for up to one year. It remembers whether you accepted anonymous analytics or selected essential cookies only. The website needs this preference to avoid asking on every visit.</p></section>
        <section className="mt-8"><h2 className="text-xl font-semibold">Vercel Web Analytics</h2><p className="mt-3 text-pretty text-sm leading-6 text-[#5f6961]">When you accept analytics, Riink loads Vercel Web Analytics. Vercel states that this service does not use cookies and records anonymous, aggregated page and device information. Riink does not send form fields, email addresses, phone numbers, or message content as analytics events.</p></section>
        <section className="mt-8"><h2 className="text-xl font-semibold">Change your choice</h2><p className="mt-3 text-pretty text-sm leading-6 text-[#5f6961]">Clear the Riink cookie in your browser settings to show the consent prompt again. Declining analytics does not affect the application or demo request form.</p></section>
        <section className="mt-8"><h2 className="text-xl font-semibold">Contact</h2><p className="mt-3 text-pretty text-sm leading-6 text-[#5f6961]">Questions about privacy can be sent to <a className="font-semibold text-[#198f3b]" href="mailto:support@riink.app">support@riink.app</a>.</p></section>
      </article>
    </main>
  );
}
