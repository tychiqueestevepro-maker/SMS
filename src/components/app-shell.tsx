"use client";

import {
  LogOut,
  Megaphone,
  Menu,
  MessageCircle,
  Settings,
  UsersRound,
  X,
  PanelLeftClose,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useState } from "react";

import { signOutAction } from "@/app/(app)/actions";
import { BrandMark } from "@/components/brand-mark";
import { QuickActionBubble } from "@/components/quick-action-bubble";

const navigation = [
  { href: "/campaigns", icon: Megaphone, label: "Campaigns" },
  { href: "/contacts", icon: UsersRound, label: "Contacts" },
  { href: "/inbox", icon: MessageCircle, label: "Inbox" },
  { href: "/settings", icon: Settings, label: "Settings" },
] as const;

function initials(name: string | null, email: string) {
  if (name) {
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function Navigation({ close, unreadCount = 0, isCollapsed = false }: { close?: () => void; unreadCount?: number; isCollapsed?: boolean }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main navigation" className="mt-8 space-y-1">
      {navigation.map(({ href, icon: Icon, label }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`flex h-10 items-center rounded-lg px-3 text-sm font-medium transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${
              active
                ? "bg-[#27ad4b] text-[#071009] shadow-[0_8px_22px_rgb(39_173_75/0.2)]"
                : "text-white/60 hover:translate-x-0.5 hover:bg-white/8 hover:text-white"
            } ${isCollapsed ? "justify-center" : "gap-3"}`}
            href={href}
            key={href}
            onClick={close}
            title={isCollapsed ? label : undefined}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={active ? 2.1 : 1.8} />
            {!isCollapsed && <span className="flex-1">{label}</span>}
            {!isCollapsed && label === "Inbox" && unreadCount > 0 && (
              <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? "bg-black/15 text-[#071009]" : "bg-white/10 text-white"}`}>
                {unreadCount}
              </span>
            )}
            {isCollapsed && label === "Inbox" && unreadCount > 0 && (
              <span className="absolute ml-5 -mt-4 size-2.5 rounded-full bg-[#27ad4b] ring-2 ring-black" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Account({ email, fullName, smsUsage, isCollapsed = false }: { email: string; fullName: string | null; smsUsage: { used: number; max: number } | null; isCollapsed?: boolean }) {
  return (
    <div className="border-t border-white/10 pt-4">
      <div className={`flex items-center ${isCollapsed ? "justify-center" : "gap-3 px-2"}`}>
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full bg-[#27ad4b] text-xs font-semibold text-[#071009]"
          title={isCollapsed ? (fullName || email) : undefined}
        >
          {initials(fullName, email)}
        </span>
        {!isCollapsed && (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{fullName || "Riink account"}</p>
              <p className="truncate text-xs text-white/45">{email}</p>
            </div>
            <form action={signOutAction}>
              <button
                aria-label="Sign out"
                className="grid size-8 place-items-center rounded-lg text-white/45 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/10 hover:text-white active:scale-[0.98]"
                title="Sign out"
                type="submit"
              >
                <LogOut aria-hidden="true" size={17} />
              </button>
            </form>
          </>
        )}
      </div>
      {!isCollapsed && smsUsage && (
        <div className="mt-3 px-3 pb-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-white/55">
            <span>{smsUsage.used.toLocaleString("en-US")} SMS</span>
            <span>{smsUsage.max.toLocaleString("en-US")} limit</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-[#27ad4b]"
              style={{ width: `${Math.min(100, Math.round((smsUsage.used / smsUsage.max) * 100))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type AppShellProps = {
  children: ReactNode;
  email: string;
  fullName: string | null;
  unreadCount?: number;
  smsUsage?: { used: number; max: number } | null;
};

export function AppShell({ children, email, fullName, unreadCount = 0, smsUsage }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-[var(--background)]">
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden border-r border-white/10 bg-black transition-[width] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] lg:flex lg:flex-col ${
          isCollapsed ? "w-[80px]" : "w-[248px]"
        }`}
      >
        <div className={`flex items-center ${isCollapsed ? "justify-center pt-5 cursor-pointer" : "justify-between px-4 py-5"}`}>
          <div className={isCollapsed ? "" : "px-2"}>
            <BrandMark compact={isCollapsed} href="/campaigns" onClick={(e) => {
              if (isCollapsed) {
                e.preventDefault();
                setIsCollapsed(false);
              }
            }} />
          </div>
          {!isCollapsed && (
            <button
              onClick={() => setIsCollapsed(true)}
              className="grid size-8 place-items-center rounded-lg text-white/55 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/10 hover:text-white"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={18} />
            </button>
          )}
        </div>
        <div className={isCollapsed ? "px-3" : "px-4"}>
          <Navigation isCollapsed={isCollapsed} unreadCount={unreadCount} />
        </div>
        <div className={`mt-auto ${isCollapsed ? "p-3 pb-4" : "p-4"}`}>
          <Account email={email} fullName={fullName} isCollapsed={isCollapsed} smsUsage={smsUsage ?? null} />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-[#e2e7e3] bg-white/95 px-5 backdrop-blur lg:hidden">
        <BrandMark href="/campaigns" />
        <button
          aria-expanded={mobileOpen}
          aria-label="Open navigation"
          className="grid size-9 place-items-center rounded-lg border border-[#e0e6e1] bg-white text-[#46534b]"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <Menu aria-hidden="true" size={19} />
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-[#17211b]/30 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
            type="button"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,300px)] flex-col bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between px-1">
              <BrandMark href="/campaigns" />
              <button
                aria-label="Close navigation"
                className="grid size-9 place-items-center rounded-lg text-[#5f6c64] hover:bg-[#f1f4f1]"
                onClick={() => setMobileOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={19} />
              </button>
            </div>
            <div className="mt-5" onClick={() => setMobileOpen(false)}>
              <Navigation unreadCount={unreadCount} />
            </div>
            <div className="mt-auto px-4 pb-4">
              <Account email={email} fullName={fullName} smsUsage={smsUsage ?? null} />
            </div>
          </aside>
        </div>
      ) : null}

      <main className={`min-w-0 max-w-full overflow-x-hidden transition-[padding] duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${isCollapsed ? "lg:pl-[80px]" : "lg:pl-[248px]"}`}>
        <div className="w-full min-w-0 px-5 py-7 sm:px-8 sm:py-9 lg:px-10 lg:py-10">{children}</div>
      </main>
      <QuickActionBubble />
    </div>
  );
}
