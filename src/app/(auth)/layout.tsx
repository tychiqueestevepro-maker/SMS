import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";

const benefits = [
  "Keep every conversation organized",
  "Build focused outreach campaigns",
  "See your SMS usage at a glance",
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[minmax(360px,0.85fr)_1.15fr]">
      <aside className="relative hidden overflow-hidden bg-[#1f6547] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="absolute -right-32 -top-32 size-96 rounded-full border border-white/10 bg-white/[0.035]" />
        <div className="absolute -bottom-40 -left-32 size-[440px] rounded-full border border-white/10 bg-[#123e2b]/20" />
        <div className="relative">
          <BrandMark inverse />
        </div>
        <div className="relative max-w-md pb-8">
          <p className="text-[34px] font-medium leading-[1.16] tracking-[-0.045em]">
            Outreach that feels clear, calm, and personal.
          </p>
          <ul className="mt-9 space-y-4">
            {benefits.map((benefit) => (
              <li className="flex items-center gap-3 text-sm text-white/80" key={benefit}>
                <span className="grid size-6 place-items-center rounded-full bg-white/10">
                  <Check aria-hidden="true" size={14} strokeWidth={2.2} />
                </span>
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} Riink</p>
      </aside>

      <section className="flex min-h-screen flex-col px-6 py-7 sm:px-10 lg:px-16">
        <div className="lg:hidden">
          <BrandMark />
        </div>
        <div className="flex flex-1 items-center justify-center py-12">{children}</div>
      </section>
    </main>
  );
}
