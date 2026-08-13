import type { Route } from "next";
import Link from "next/link";

type BrandMarkProps = {
  compact?: boolean;
  href?: Route;
  inverse?: boolean;
  onClick?: (e: React.MouseEvent) => void;
};

export function BrandMark({ compact = false, href = "/", inverse = false, onClick }: BrandMarkProps) {
  return (
    <Link
      aria-label="Riink home"
      className="inline-flex items-center gap-2.5 rounded-lg"
      href={href}
      onClick={onClick}
    >
      <div className={`relative flex items-center overflow-hidden ${compact ? "w-8" : ""}`}>
        <img 
          src="/riink_logo_transparent.png" 
          alt="Riink" 
          className={`h-8 w-auto max-w-none ${compact ? "object-cover object-left" : "object-contain"}`}
        />
      </div>
    </Link>
  );
}
