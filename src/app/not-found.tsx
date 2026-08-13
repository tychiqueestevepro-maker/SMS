import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { buttonStyles } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] px-6 text-center">
      <div>
        <div className="flex justify-center">
          <BrandMark />
        </div>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.14em] text-[#246b4a]">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#17211b]">Page not found</h1>
        <p className="mt-3 text-sm text-[#68736c]">The page you requested doesn&apos;t exist or isn&apos;t available.</p>
        <Link className={buttonStyles({ className: "mt-7" })} href="/">
          Return to Riink
        </Link>
      </div>
    </main>
  );
}
