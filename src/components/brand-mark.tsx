import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";

type BrandMarkProps = {
  compact?: boolean;
  href?: Route;
  inverse?: boolean;
  onClick?: (e: React.MouseEvent) => void;
};

export function BrandMark({ compact = false, href = "/", onClick }: BrandMarkProps) {
  return (
    <Link
      aria-label="Riink home"
      className="inline-flex items-center gap-2.5 rounded-lg"
      href={href}
      onClick={onClick}
    >
      <div className={`relative flex items-center overflow-hidden ${compact ? "w-8" : ""}`}>
        <Image
          alt="Riink"
          className={`h-8 w-auto max-w-none ${compact ? "object-cover object-left" : "object-contain"}`}
          height={32}
          loading="eager"
          src="/riink_logo_transparent.png"
          width={32}
        />
      </div>
    </Link>
  );
}
