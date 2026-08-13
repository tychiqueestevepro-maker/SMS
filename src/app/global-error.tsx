"use client";

import * as Sentry from "@sentry/nextjs";
import Image from "next/image";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="grid min-h-screen place-items-center bg-[#f7f9f7] px-6 text-center">
          <div className="max-w-md">
            <Image
              alt="Riink"
              className="mx-auto h-9 w-auto"
              height={36}
              loading="eager"
              src="/riink_logo_transparent.png"
              width={36}
            />
            <h1 className="mt-8 text-2xl font-semibold text-[#0a0d0a]">Something went wrong</h1>
            <p className="mt-3 text-sm leading-6 text-[#6b756e]">
              The error has been reported. Refresh the page or try again in a moment.
            </p>
            <button className="mt-6 rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white" onClick={() => window.location.reload()} type="button">
              Reload page
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
