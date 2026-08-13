import { clsx } from "clsx";
import type { ButtonHTMLAttributes } from "react";
import { twMerge } from "tailwind-merge";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export function buttonStyles({
  className,
  size = "md",
  variant = "primary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
} = {}) {
  return twMerge(
    clsx(
      "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:ring-2 focus-visible:ring-[#27ad4b]/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
      size === "sm" ? "h-9 px-3 text-sm" : "h-10 px-4 text-sm",
      variant === "primary" && "bg-[#0a0d0a] text-white shadow-sm hover:-translate-y-0.5 hover:bg-[#27ad4b]",
      variant === "secondary" && "border border-[#cfe0d3] bg-white text-[#0a0d0a] shadow-sm hover:-translate-y-0.5 hover:border-[#27ad4b] hover:bg-[#f3fbf5]",
      variant === "ghost" && "text-[#59635c] hover:bg-[#eaf8ed] hover:text-[#168936]",
      variant === "danger" && "bg-[#b33b32] text-white shadow-sm hover:bg-[#923029]",
      className,
    ),
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function Button({ className, size, variant, type = "button", ...props }: ButtonProps) {
  return <button className={buttonStyles({ className, size, variant })} type={type} {...props} />;
}
