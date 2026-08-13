import type { HTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type BadgeTone = "neutral" | "success" | "warning";

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const tones = {
    neutral: "bg-[#f0f3f1] text-[#59635c]",
    success: "bg-[#eaf8ed] text-[#168936]",
    warning: "bg-[#fff3d7] text-[#8b5b18]",
  };

  return (
    <span
      className={twMerge(
        `inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`,
        className,
      )}
      {...props}
    />
  );
}
