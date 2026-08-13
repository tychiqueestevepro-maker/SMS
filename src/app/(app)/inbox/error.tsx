"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function InboxError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="grid min-h-[520px] place-items-center p-8 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-[#fff0ee] text-[#b33b32]"><CircleAlert aria-hidden="true" size={20} /></span>
        <h1 className="mt-5 text-base font-semibold text-[#26342b]">Inbox couldn&apos;t be loaded</h1>
        <p className="mt-2 text-sm leading-6 text-[#68736c]">Please try again. Your conversations are still safe.</p>
        <Button className="mt-5" onClick={reset}>Try again</Button>
      </div>
    </Card>
  );
}
