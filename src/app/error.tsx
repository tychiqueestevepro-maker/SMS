"use client";

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The browser log contains only the framework error object. Server details stay server-side.
    console.error("Riink page error", { digest: error.digest });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] px-6 text-center">
      <div className="max-w-md">
        <div className="flex justify-center">
          <BrandMark />
        </div>
        <span className="mx-auto mt-10 grid size-12 place-items-center rounded-full bg-[#fff0ee] text-[#b33b32]">
          <CircleAlert aria-hidden="true" size={21} />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.035em] text-[#17211b]">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-[#68736c]">We couldn&apos;t load this page. Please try again.</p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
