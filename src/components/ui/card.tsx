import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge("rounded-2xl border border-[var(--border)] bg-white shadow-[var(--shadow-card)]", className)}
      {...props}
    />
  );
}
