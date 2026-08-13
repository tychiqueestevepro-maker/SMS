import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ action, description, icon: Icon, title }: EmptyStateProps) {
  return (
    <Card className="grid min-h-[410px] place-items-center px-6 py-14 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-[#dfe7e1] bg-[#f1f6f3] text-[#246b4a]">
          <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
        </span>
        <h2 className="mt-5 text-base font-semibold text-[#26342b]">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-[#68736c]">{description}</p>
        {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
      </div>
    </Card>
  );
}
