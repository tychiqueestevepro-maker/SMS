import type { ReactNode } from "react";

type AuthCardProps = {
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
};

export function AuthCard({ children, description, eyebrow, footer, title }: AuthCardProps) {
  return (
    <div className="w-full max-w-[420px]">
      {eyebrow ? (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.13em] text-[#246b4a]">{eyebrow}</p>
      ) : null}
      <h1 className="text-[30px] font-semibold tracking-[-0.045em] text-[#17211b]">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-[#68736c]">{description}</p>
      <div className="mt-8">{children}</div>
      <div className="mt-7 border-t border-[#e7ebe8] pt-6 text-center text-sm text-[#68736c]">{footer}</div>
    </div>
  );
}
