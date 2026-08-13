"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { Button, buttonStyles } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#f4f6f5]">
      <header className="border-b border-[#dfe5e0] bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-5 sm:px-8">
          <BrandMark href="/admin" />
        </div>
      </header>
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl place-items-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-md rounded-xl border border-[#f0cbc6] bg-white p-7 text-center shadow-sm">
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[#fff0ee] text-[#a33a32]">
            <AlertTriangle aria-hidden="true" size={20} />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-[#26342b]">Administration could not load</h1>
          <p className="mt-2 text-sm leading-6 text-[#6f7b74]">The operator data service is temporarily unavailable. Retry or return to the workspace.</p>
          {error.digest ? <p className="mt-3 font-mono text-[11px] text-[#9aa39d]">Digest: {error.digest}</p> : null}
          <div className="mt-6 flex justify-center gap-2">
            <Link className={buttonStyles({ variant: "secondary" })} href="/campaigns">Back to workspace</Link>
            <Button onClick={reset}>Retry</Button>
          </div>
        </div>
      </div>
    </main>
  );
}
