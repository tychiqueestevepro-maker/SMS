"use client";

import { Analytics } from "@vercel/analytics/react";
import { Check, Cookie, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

type Consent = "accepted" | "essential" | null;

const COOKIE_NAME = "riink_cookie_consent";

function savedConsent(): Consent {
  if (typeof document === "undefined") return null;
  const value = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${COOKIE_NAME}=`))
    ?.split("=")[1];
  return value === "accepted" || value === "essential" ? value : null;
}

export function CookieConsent() {
  const [consent, setConsent] = useState<Consent>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setConsent(savedConsent());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function choose(value: Exclude<Consent, null>) {
    document.cookie = `${COOKIE_NAME}=${value}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
    setConsent(value);
    window.dispatchEvent(new CustomEvent("riink:consent", { detail: value }));
  }

  return (
    <>
      {consent === "accepted" ? <Analytics /> : null}
      {ready && consent === null ? (
        <aside aria-label="Cookie preferences" className="fixed inset-x-4 bottom-4 z-[90] mx-auto max-w-3xl rounded-2xl border border-white/10 bg-[#0b0d0b] p-4 text-white shadow-[0_24px_70px_rgba(0,0,0,0.28)] sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#173d20] text-[#66dd7e]"><Cookie className="size-5" weight="fill" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Your privacy, your choice</h2>
              <p className="mt-2 text-pretty text-sm leading-5 text-white/60">Riink uses an essential cookie to remember this choice. With your permission, anonymous Vercel Analytics helps us understand which pages are useful. It does not use advertising cookies.</p>
              <Link href="/cookies" className="mt-3 inline-flex rounded-md text-xs font-semibold text-[#68df81] hover:text-[#8deb9f]">View cookie details</Link>
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button onClick={() => choose("essential")} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-white/75 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/5 hover:text-white"><X className="size-4" /> Essential only</button>
            <button onClick={() => choose("accepted")} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#55d371] px-3 py-2 text-sm font-semibold text-[#071009] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:bg-[#6de087]"><Check className="size-4" weight="bold" /> Accept analytics</button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
