"use client";

import {
  ArrowRight,
  ChartLineUp,
  ChatCircleDots,
  Check,
  Clock,
  Database,
  FileCsv,
  FlowArrow,
  Lightning,
  LinkedinLogo,
  List,
  PaperPlaneTilt,
  Phone,
  Play,
  Plus,
  ShieldCheck,
  UploadSimple,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { type MouseEvent, useState } from "react";

const ease = [0.32, 0.72, 0, 1] as const;

const reveal = {
  hidden: { opacity: 0, y: 32, filter: "blur(8px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const navItems = [
  { label: "Features", href: "#features" },
  { label: "Integrations", href: "#integrations" },
  { label: "Pricing", href: "#pricing" },
  { label: "FAQ", href: "#faq" },
] as const;

const faqItems = [
  {
    question: "What is included in the Riink plan?",
    answer:
      "The Standard plan includes 2,000 SMS credits each month, three Riink phone numbers, room to import three existing numbers, campaigns and sequences, a shared inbox, and a customizable sales pipeline.",
  },
  {
    question: "What happens after I use 2,000 SMS credits?",
    answer:
      "Additional outbound SMS credits are billed at $0.04 each. One credit represents one outbound SMS segment, so message length and special characters can cause one message to use more than one credit. Inbound replies do not consume credits.",
  },
  {
    question: "Can I import an existing contact list?",
    answer:
      "Yes. Riink supports CSV contact imports so you can bring an existing list into your workspace and prepare it for outreach.",
  },
  {
    question: "Can my team manage replies together?",
    answer:
      "Yes. Replies arrive in a shared inbox, giving your team one place to review conversations and send manual responses.",
  },
  {
    question: "Does Riink support campaign sequences?",
    answer:
      "Yes. You can create focused campaigns with scheduled steps and follow ups, then monitor delivery and response activity.",
  },
  {
    question: "How does phone number setup work?",
    answer:
      "A workspace can request a number, continue preparing contacts and campaigns, and use the number after Riink completes its required activation checks.",
  },
];

function cursorGlow(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
}

function Logo({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Riink">
      <Image
        alt=""
        aria-hidden="true"
        className="size-7 rounded-lg object-contain"
        height={28}
        src="/riink_logo_transparent.png"
        width={28}
      />
      <span className={`text-xl font-semibold tracking-tight ${inverse ? "text-white" : "text-[#111311]"}`}>
        Riink
      </span>
    </span>
  );
}

function ArrowLink({ children, href, inverse = false }: { children: React.ReactNode; href: string; inverse?: boolean }) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 ${
        inverse ? "text-white focus-visible:outline-white" : "text-[#15933b] focus-visible:outline-[#15933b]"
      }`}
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" />
    </Link>
  );
}

function MiniSparkline({ second = false }: { second?: boolean }) {
  return (
    <svg viewBox="0 0 120 34" className="h-8 w-28 overflow-visible" aria-hidden="true">
      <path d="M1 27H119" stroke="#edf0ed" />
      <motion.path
        d={second ? "M2 25 C14 27 18 13 30 17 S47 28 60 18 S78 5 90 12 S108 19 118 4" : "M2 23 C13 16 20 26 32 20 S48 8 62 14 S80 24 92 12 S106 16 118 6"}
        fill="none"
        stroke="#22a947"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease }}
      />
    </svg>
  );
}

function MainDashboard() {
  return (
    <div className="relative h-full overflow-hidden rounded-2xl border border-[#e6e8e6] bg-white shadow-[0_32px_80px_rgba(16,35,20,0.13),0_8px_24px_rgba(16,35,20,0.06)]">
      <div className="flex h-14 items-center justify-between border-b border-[#edf0ed] px-4">
        <Logo />
        <div className="flex items-center gap-2">
          <span className="h-8 w-24 rounded-lg bg-[#f5f7f5]" />
          <span className="grid size-8 place-items-center rounded-full bg-[#edf7ef] text-xs font-semibold text-[#168b39]">TM</span>
        </div>
      </div>
      <div className="grid h-[calc(100%-3.5rem)] grid-cols-[112px_1fr]">
        <aside className="border-r border-[#edf0ed] p-3">
          {["Overview", "Inbox", "Campaigns", "Contacts", "Automations", "Analytics", "Numbers"].map((item, index) => (
            <div
              key={item}
              className={`mb-1 rounded-lg px-3 py-2 text-[10px] font-medium ${index === 0 ? "bg-[#edf8ef] text-[#118436]" : "text-[#778078]"}`}
            >
              {item}
            </div>
          ))}
        </aside>
        <div className="min-w-0 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#8a918b]">Campaign overview</p>
              <p className="text-sm font-semibold text-[#111311]">August performance</p>
            </div>
            <button className="rounded-lg border border-[#e4e8e4] px-3 py-2 text-[10px] font-semibold text-[#4d554f]">Export</button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              ["Messages sent", "12,458", "+8.2%"],
              ["Replies", "2,341", "+21.4%"],
              ["Conversations", "1,127", "+15.2%"],
              ["Reply rate", "18.7%", "+9.1%"],
            ].map(([label, value, delta]) => (
              <div key={label} className="rounded-xl border border-[#edf0ed] p-3">
                <p className="truncate text-[9px] text-[#8a918b]">{label}</p>
                <p className="mt-2 text-sm font-semibold text-[#151815]">{value}</p>
                <p className="mt-1 text-[9px] font-medium text-[#1b9b42]">{delta}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl border border-[#edf0ed] p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-medium text-[#59615b]">Replies over time</span>
              <span className="text-[9px] text-[#9aa09b]">Last 30 days</span>
            </div>
            <svg viewBox="0 0 480 150" className="h-40 w-full" preserveAspectRatio="none" aria-hidden="true">
              {[30, 70, 110, 150].map((y) => <path key={y} d={`M0 ${y}H480`} stroke="#eff2ef" />)}
              <motion.path
                d="M0 124 C24 128 34 105 56 111 S83 133 105 97 S139 48 165 75 S194 83 214 79 S234 86 253 47 S292 40 310 62 S344 62 364 32 S395 16 414 44 S449 49 480 20"
                fill="none"
                stroke="#17211b"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 1.5, delay: 0.4, ease }}
              />
              {[56, 165, 253, 364, 480].map((x, index) => (
                <circle key={x} cx={x} cy={[111, 75, 47, 32, 20][index]} r="4" fill="#24ab49" stroke="white" strokeWidth="2" />
              ))}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroScene() {
  const reducedMotion = useReducedMotion();
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  function handleMove(event: MouseEvent<HTMLDivElement>) {
    cursorGlow(event);
    if (reducedMotion) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setParallax({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 12,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * 12,
    });
  }

  return (
    <div
      onMouseMove={handleMove}
      onMouseLeave={() => setParallax({ x: 0, y: 0 })}
      className="hero-glow relative h-[660px] w-full overflow-visible"
    >
      <div className="absolute inset-16 rounded-full bg-[#2ab44f]/[0.06] blur-3xl" />
      <div className="hero-dots absolute inset-10 opacity-60" />
      <motion.div
        className="absolute inset-x-8 top-28 h-[430px] origin-center -rotate-2 md:inset-x-12"
        animate={{ x: parallax.x * 0.25, y: parallax.y * 0.25 }}
        transition={{ type: "spring", stiffness: 80, damping: 20 }}
      >
        <MainDashboard />
      </motion.div>

      <motion.div
        className="float-one absolute left-0 top-10 w-44 rounded-2xl border border-[#e6e8e6] bg-white p-4 shadow-[0_20px_50px_rgba(15,30,18,0.12)] sm:left-5"
        animate={{ x: parallax.x, y: parallax.y }}
        transition={{ type: "spring", stiffness: 70, damping: 22 }}
        whileHover={{ y: -4, scale: 1.015 }}
      >
        <p className="text-xs font-semibold text-[#1a1e1a]">Campaign performance</p>
        <div className="mt-4 flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-full bg-[conic-gradient(#1daa45_0_82%,#edf1ed_82%_100%)]">
            <div className="size-9 rounded-full bg-white" />
          </div>
          <div><p className="text-2xl font-semibold">82%</p><p className="text-[10px] text-[#8c938d]">Delivery rate</p></div>
        </div>
      </motion.div>

      <motion.div
        className="float-two absolute right-0 top-4 w-56 rounded-2xl border border-[#e6e8e6] bg-white p-4 shadow-[0_20px_50px_rgba(15,30,18,0.11)] sm:right-2"
        animate={{ x: parallax.x * 0.75, y: parallax.y * 0.75 }}
        transition={{ type: "spring", stiffness: 70, damping: 22 }}
        whileHover={{ y: -4, scale: 1.015 }}
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#17211b] text-xs font-semibold text-white">JC</div>
          <div className="min-w-0"><p className="text-[10px] text-[#969d97]">Recent message</p><p className="mt-1 text-xs font-semibold">James Carter</p><p className="mt-1 text-[10px] leading-4 text-[#687068]">Sure, let&apos;s chat. Friday works.</p></div>
          <ArrowRight className="size-3 shrink-0 text-[#9da49e]" />
        </div>
      </motion.div>

      <motion.div
        className="float-three absolute bottom-7 left-0 w-52 rounded-2xl border border-[#e6e8e6] bg-white p-4 shadow-[0_20px_50px_rgba(15,30,18,0.12)] sm:left-8"
        animate={{ x: parallax.x * 0.8, y: parallax.y * 0.8 }}
        transition={{ type: "spring", stiffness: 70, damping: 22 }}
        whileHover={{ y: -4, scale: 1.015 }}
      >
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-full bg-[#dfe9e1] text-xs font-semibold">KM</div><div><p className="text-xs font-semibold">Kendall Mitchell</p><p className="text-[10px] text-[#7f8780]">+1 (415) 555 0139</p></div></div>
        <div className="mt-4 flex items-center justify-between border-t border-[#edf0ed] pt-3 text-[10px]"><span className="text-[#8a928b]">Lead quality</span><span className="font-semibold text-[#15933b]">High</span></div>
      </motion.div>

      <motion.div
        className="float-one absolute bottom-2 right-0 w-56 rounded-2xl border border-[#e6e8e6] bg-white p-4 shadow-[0_20px_50px_rgba(15,30,18,0.12)] sm:right-4"
        animate={{ x: parallax.x, y: parallax.y }}
        transition={{ type: "spring", stiffness: 70, damping: 22 }}
        whileHover={{ y: -4, scale: 1.015 }}
      >
        <div className="flex items-center justify-between"><p className="text-xs font-semibold">Automation</p><span className="h-4 w-8 rounded-full bg-[#1da843] p-0.5"><span className="ml-auto block size-3 rounded-full bg-white" /></span></div>
        <div className="mt-4 space-y-2">
          {["Message is sent", "Send follow up", "Wait 24 hours"].map((item, i) => <div key={item} className="flex items-center gap-2 rounded-lg border border-[#edf0ed] p-2 text-[10px]"><span className="grid size-4 place-items-center rounded-full bg-[#edf8ef] text-[#15933b]">{i + 1}</span>{item}</div>)}
        </div>
      </motion.div>

      <motion.div
        className="float-two absolute right-1 top-[330px] hidden w-44 rounded-2xl bg-[#080a08] p-4 text-white shadow-[0_24px_55px_rgba(0,0,0,0.24)] sm:block"
        animate={{ x: parallax.x * 1.1, y: parallax.y * 1.1 }}
        transition={{ type: "spring", stiffness: 70, damping: 22 }}
        whileHover={{ y: -4, scale: 1.015 }}
      >
        <p className="text-[10px] text-white/50">Active conversations</p><p className="mt-2 text-xl font-semibold">1,127</p><div className="mt-3 flex items-end justify-between"><span className="text-[10px] text-[#55d274]">+15.2%</span><MiniSparkline /></div>
      </motion.div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
  icon,
  link,
  dark = false,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  link: string;
  dark?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.article
      variants={reveal}
      onMouseMove={dark ? cursorGlow : undefined}
      className={`feature-card group relative flex min-h-[304px] flex-col overflow-hidden rounded-2xl border p-6 transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 ${
        dark
          ? "inbox-glow border-[#1f241f] bg-[#080a08] text-white shadow-[0_20px_50px_rgba(0,0,0,0.12)]"
          : "border-[#e3e7e3] bg-white text-[#121512] shadow-[0_10px_30px_rgba(24,48,29,0.04)] hover:border-[#cbd2cc] hover:shadow-[0_20px_44px_rgba(24,48,29,0.09)]"
      }`}
    >
      <div className="relative z-10 flex items-start gap-3">
        <div className={`grid size-9 shrink-0 place-items-center rounded-lg ${dark ? "bg-white/10 text-[#52d36f]" : "bg-[#edf8ef] text-[#16923b]"}`}>{icon}</div>
        <div><h3 className="text-base font-semibold">{title}</h3><p className={`mt-1 text-sm leading-5 ${dark ? "text-white/55" : "text-[#687068]"}`}>{description}</p></div>
      </div>
      <div className="relative z-10 my-5 min-h-0 flex-1 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.5">{children}</div>
      <div className="relative z-10"><ArrowLink href="#product-tour" inverse={dark}>{link}</ArrowLink></div>
    </motion.article>
  );
}

function Features() {
  return (
    <section id="features" className="border-t border-[#edf0ed] bg-[#fbfcfb] px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} transition={{ staggerChildren: 0.08 }} className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <div><motion.p variants={reveal} className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">Features</motion.p><motion.h2 variants={reveal} className="mt-3 max-w-2xl text-balance text-4xl font-semibold tracking-tight text-[#111311] md:text-5xl">Everything you need to run SMS outreach at scale.</motion.h2></div>
          <motion.div variants={reveal}><ArrowLink href="#product-tour">Explore all features</ArrowLink></motion.div>
        </motion.div>

        <motion.div id="product-tour" initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} transition={{ staggerChildren: 0.08 }} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <FeatureCard title="Import and ingest" description="Bring contact lists into Riink." icon={<UploadSimple className="size-5" />} link="View import options">
            <div className="space-y-2">
              {[["CSV upload", "2,847", "Upload", "csv"], ["Apollo", "12,361", "Soon", "apollo"], ["Google Sheets", "984", "Soon", "sheets"]].map(([name, count, action, logo], i) => (
                <div key={name} className="flex items-center gap-3 rounded-lg border border-[#e9ede9] bg-[#fbfcfb] p-2 text-xs"><span className="shrink-0 scale-75"><IntegrationLogo logo={logo as "csv" | "apollo" | "sheets"} /></span><span className="font-medium">{name}</span><span className="ml-auto text-[#818982]">{count}</span><span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${i === 0 ? "bg-[#e9f7ec] text-[#158d38]" : "bg-[#f1f3f1] text-[#858c86]"}`}>{action}</span></div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard title="Shared inbox" description="Manage every reply in one workspace." icon={<ChatCircleDots className="size-5" />} link="Open the inbox" dark>
            <div className="space-y-2">
              {[["Alexander Lee", "Can we schedule a quick call tomorrow?", "2m"], ["Maria Gonzales", "Sounds good, let’s do 10am.", "5m"]].map(([name, message, time], i) => (
                <div key={name} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3"><div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 text-[10px] font-semibold">{i === 0 ? "AL" : "MG"}</div><div className="min-w-0"><p className="text-xs font-semibold">{name}</p><p className="mt-1 truncate text-[10px] text-white/50">{message}</p></div><span className="ml-auto text-[10px] text-white/35">{time}</span><span className="mt-1 size-2 rounded-full bg-[#38c65b]" /></div>
              ))}
            </div>
          </FeatureCard>

          <FeatureCard title="Contacts" description="Store, segment, and manage every contact." icon={<UsersThree className="size-5" />} link="View contacts">
            <div className="rounded-xl border border-[#e8ece8] bg-[#fbfcfb] p-5"><p className="text-xs text-[#7b837c]">Total contacts</p><div className="mt-2 flex items-baseline gap-2"><span className="text-3xl font-semibold">24,830</span><span className="text-xs font-semibold text-[#15933b]">+12.4%</span></div><div className="mt-5 flex items-center">{["JS", "AK", "MR", "TD", "LN"].map((item, i) => <span key={item} className="grid size-8 place-items-center rounded-full border-2 border-white bg-[#dfe6e0] text-[9px] font-semibold" style={{ marginLeft: i ? -7 : 0 }}>{item}</span>)}<span className="ml-2 rounded-full bg-[#e8f6eb] px-2 py-1 text-[10px] font-semibold text-[#168e39]">+847</span></div></div>
          </FeatureCard>

          <FeatureCard title="Automations" description="Build follow ups that run on schedule." icon={<FlowArrow className="size-5" />} link="Create an automation">
            <div className="flex flex-wrap items-center gap-2">
              {["No reply in 24h", "Send follow up", "Wait 24h"].map((label, index) => <div key={label} className="contents"><div className="rounded-lg border border-[#e6eae6] bg-[#fbfcfb] px-3 py-3 text-[10px] font-medium">{label}</div>{index < 2 && <ArrowRight className="automation-arrow size-4 text-[#25a648]" />}</div>)}
            </div>
            <button className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#e4e9e4] px-3 py-2 text-xs font-medium transition-colors hover:bg-[#f2f7f3]"><Plus className="size-3" /> Add step</button>
          </FeatureCard>

          <FeatureCard title="Analytics" description="See what turns outreach into replies." icon={<ChartLineUp className="size-5" />} link="View analytics">
            <div className="rounded-xl border border-[#e6eae6] p-3">
              {[["Reply rate", "18.7%", false], ["Conversation rate", "8.3%", true]].map(([label, value, second], i) => <div key={String(label)} className={`flex items-center ${i ? "mt-3 border-t border-[#edf0ed] pt-3" : ""}`}><div><p className="text-[10px] text-[#7c847d]">{String(label)}</p><p className="mt-1 text-sm font-semibold">{String(value)} <span className="text-[10px] text-[#15933b]">+{i ? "7.6" : "9.1"}%</span></p></div><div className="ml-auto"><MiniSparkline second={Boolean(second)} /></div></div>)}
            </div>
          </FeatureCard>

          <FeatureCard title="Numbers" description="Manage the numbers your team sends from." icon={<Phone className="size-5" />} link="Manage numbers">
            <div className="space-y-2">{[["+1 (415) 555 0139", "Active"], ["+1 (415) 555 8723", "Active"], ["+1 (415) 555 8445", "Pending"]].map(([number, status]) => <div key={number} className="flex items-center rounded-lg border border-[#e8ece8] bg-[#fbfcfb] p-3 text-[10px]"><Phone className="mr-2 size-3 text-[#657066]" /><span className="font-medium">{number}</span><span className={`ml-auto rounded-full px-2 py-1 font-semibold ${status === "Active" ? "status-live bg-[#e7f6ea] text-[#148d38]" : "bg-[#f2f3f2] text-[#7c847d]"}`}>{status}</span></div>)}</div>
          </FeatureCard>
        </motion.div>
      </div>
    </section>
  );
}

function TaglineReveal() {
  const words = "Turn contact lists into real conversations, and keep every reply moving forward.".split(" ");
  return (
    <section className="bg-white px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <p className="mb-8 text-xs font-semibold uppercase tracking-widest text-[#15933b]">From list to reply</p>
        <h2 className="max-w-4xl text-balance text-4xl font-semibold tracking-tight md:text-6xl">
          {words.map((word, index) => (
            <motion.span key={`${word}-${index}`} initial={{ color: "rgba(17,19,17,0.27)" }} whileInView={{ color: "rgba(17,19,17,1)" }} viewport={{ once: true, margin: "0px 0px -35% 0px" }} transition={{ duration: 0.8, delay: index * 0.035, ease }} className="mr-[0.24em] inline-block">{word}</motion.span>
          ))}
        </h2>
      </div>
    </section>
  );
}

const integrations = [
  { name: "Apollo", detail: "Import prospect lists.", state: "Coming soon", flow: "Planned connection", logo: "apollo" },
  { name: "CSV upload", detail: "Upload files with drag and drop.", state: "Available", flow: "Ready to import", logo: "csv" },
  { name: "HubSpot", detail: "Sync CRM contacts.", state: "Coming soon", flow: "Planned connection", logo: "hubspot" },
  { name: "Google Sheets", detail: "Pull rows into Riink.", state: "Coming soon", flow: "Planned connection", logo: "sheets" },
  { name: "Clay", detail: "Import enriched leads.", state: "Coming soon", flow: "Planned connection", logo: "clay" },
  { name: "LinkedIn", detail: "Import saved leads.", state: "Coming soon", flow: "Planned connection", logo: "linkedin" },
] as const;

function IntegrationLogo({ logo }: { logo: (typeof integrations)[number]["logo"] }) {
  if (logo === "apollo") {
    return (
      <span
        aria-label="Apollo"
        className="block size-10 rounded-lg bg-cover bg-center"
        role="img"
        style={{ backgroundImage: 'url("https://www.apollo.io/icon.svg?icon.11df6mby0rn6l.svg")' }}
      />
    );
  }

  if (logo === "clay") {
    return (
      <span
        aria-label="Clay"
        className="block size-10 rounded-lg bg-cover bg-center"
        role="img"
        style={{ backgroundImage: 'url("https://cdn.prod.website-files.com/61477f2c24a826836f969afe/677c0a6767557563354e34a3_Clay%20icon.png")' }}
      />
    );
  }

  if (logo === "hubspot") {
    return (
      <span className="grid size-10 place-items-center rounded-lg bg-[#fff0e8]" aria-label="HubSpot" role="img">
        <svg className="size-6 fill-[#ff7a59]" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.164 7.93V5.084a2.198 2.198 0 0 0 1.267-1.978v-.067A2.2 2.2 0 0 0 17.238.845h-.067a2.2 2.2 0 0 0-2.193 2.193v.067a2.196 2.196 0 0 0 1.252 1.973l.013.006v2.852a6.22 6.22 0 0 0-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 1 0 4.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 0 0-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 0 0-.58-.095h-.002a2.033 2.033 0 1 0 2.033 2.033 1.978 1.978 0 0 0-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 1 0 4.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 1 1 3.215-3.207v.002a3.206 3.206 0 0 1-3.207 3.207z" />
        </svg>
      </span>
    );
  }

  if (logo === "sheets") {
    return (
      <span className="grid size-10 place-items-center rounded-lg bg-[#e7f5eb]" aria-label="Google Sheets" role="img">
        <svg className="size-6 fill-[#0f9d58]" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z" />
        </svg>
      </span>
    );
  }

  if (logo === "linkedin") {
    return (
      <span className="grid size-10 place-items-center rounded-lg bg-[#e5f1fa] text-[#0a66c2]" aria-label="LinkedIn" role="img">
        <LinkedinLogo className="size-6" weight="fill" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="grid size-10 place-items-center rounded-lg bg-[#dff4e4] text-[#168d39]" aria-label="CSV upload" role="img">
      <FileCsv className="size-6" weight="fill" aria-hidden="true" />
    </span>
  );
}

function Integrations() {
  const [activeIntegration, setActiveIntegration] = useState(1);
  const active = integrations[activeIntegration];

  return (
    <section id="integrations" className="border-y border-[#edf0ed] bg-[#fbfcfb] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="mb-10"><motion.p variants={reveal} className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">Integrations</motion.p><motion.h2 variants={reveal} className="mt-3 text-balance text-4xl font-semibold tracking-tight">Import contacts from your stack</motion.h2><motion.p variants={reveal} className="mt-3 text-sm text-[#697169]">Bring leads into Riink in seconds. No manual retyping.</motion.p></motion.div>
        <div className="relative">
          <div className="integration-rings integration-rings-active pointer-events-none absolute left-1/2 top-1/2 hidden size-96 -translate-x-1/2 -translate-y-1/2 rounded-full lg:block" />
          <div className={`integration-flow pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden lg:block ${activeIntegration < 3 ? "flow-from-left" : "flow-from-right"}`} aria-hidden="true">
            <span className="flow-packet flow-packet-one" />
            <span className="flow-packet flow-packet-two" />
            <span className="flow-packet flow-packet-three" />
          </div>
          <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} transition={{ staggerChildren: 0.07 }} className="relative z-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-7 lg:items-center">
            {integrations.slice(0, 3).map((item, index) => <IntegrationCard active={activeIntegration === index} index={index} key={item.name} item={item} onActivate={setActiveIntegration} />)}
            <motion.div variants={reveal} className="order-first grid min-h-44 place-items-center py-4 sm:col-span-2 lg:order-none lg:col-span-1">
              <div className="flex flex-col items-center">
                <motion.div key={active.name} initial={{ scale: 0.88, rotate: -4 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 240, damping: 18 }} className="riink-receiver relative grid size-20 place-items-center rounded-2xl bg-[#0a160d] shadow-[0_18px_45px_rgba(22,151,58,0.25)]">
                  <span className="receiver-pulse absolute inset-0 rounded-2xl" />
                  <Image alt="Riink" className="relative z-10 size-12 rounded-xl object-contain" height={48} src="/riink_logo_transparent.png" width={48} />
                </motion.div>
                <div className="mt-4 h-10 text-center" aria-live="polite">
                  <AnimatePresence mode="wait">
                    <motion.div key={active.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.4, ease }}>
                      <p className="text-xs font-semibold text-[#17211b]">{active.name} <span className="text-[#1b9c41]">→</span> Riink</p>
                      <p className="mt-1 text-[10px] text-[#748078]">{active.flow}</p>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
            {integrations.slice(3).map((item, offset) => { const index = offset + 3; return <IntegrationCard active={activeIntegration === index} index={index} key={item.name} item={item} onActivate={setActiveIntegration} />; })}
          </motion.div>
          <p className="mt-6 text-center text-xs text-[#758078]">Hover or tap a source to preview its path into Riink.</p>
        </div>
      </div>
    </section>
  );
}

function IntegrationCard({ active, index, item, onActivate }: { active: boolean; index: number; item: (typeof integrations)[number]; onActivate: (index: number) => void }) {
  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const tiltX = -((event.clientY - rect.top) / rect.height - 0.5) * 5;
    const tiltY = ((event.clientX - rect.left) / rect.width - 0.5) * 5;
    event.currentTarget.style.setProperty("--tilt-x", `${tiltX}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${tiltY}deg`);
  }

  function resetTilt(event: React.PointerEvent<HTMLButtonElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  }

  return (
    <motion.button
      aria-pressed={active}
      onClick={() => onActivate(index)}
      onFocus={() => onActivate(index)}
      onMouseEnter={() => onActivate(index)}
      onPointerLeave={resetTilt}
      onPointerMove={handlePointerMove}
      type="button"
      variants={reveal}
      className="integration-card group min-h-44 rounded-2xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15933b]"
    >
      <span className={`integration-card-inner relative block min-h-44 overflow-hidden rounded-2xl border bg-white p-4 shadow-[0_10px_28px_rgba(20,44,25,0.05)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${active ? "-translate-y-1 border-[#48bd65] shadow-[0_20px_42px_rgba(26,145,57,0.14)]" : "border-[#e1e6e1] group-hover:-translate-y-1 group-hover:border-[#b8d9c0] group-hover:shadow-[0_18px_38px_rgba(20,44,25,0.09)]"}`}>
        <span className={`absolute right-3 top-3 size-2 rounded-full bg-[#2ab550] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${active ? "scale-100 opacity-100 shadow-[0_0_0_6px_rgba(42,181,80,0.10)]" : "scale-0 opacity-0"}`} />
        <span className="block transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:scale-105 group-hover:-rotate-2"><IntegrationLogo logo={item.logo} /></span>
        <span className="mt-4 block text-sm font-semibold">{item.name}</span><span className="mt-1 block text-[10px] leading-4 text-[#757d76]">{item.detail}</span><span className={`mt-4 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${item.state === "Available" ? "bg-[#e8f7eb] text-[#158f39]" : "bg-[#f1f3f1] text-[#7a827b]"}`}>{item.state}</span>
      </span>
    </motion.button>
  );
}

function Pricing() {
  const features = ["2,000 SMS credits each month", "$0.04 per additional outbound credit", "3 Riink numbers plus 3 imported numbers", "6 phone numbers in total", "Campaigns and sequences", "Shared inbox and compliance"];
  return (
    <section id="pricing" className="bg-white px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1440px]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} className="mb-12 text-center"><motion.p variants={reveal} className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">Pricing</motion.p><motion.h2 variants={reveal} className="mt-3 text-balance text-4xl font-semibold tracking-tight md:text-5xl">One plan. Everything you need.</motion.h2><motion.p variants={reveal} className="mx-auto mt-4 max-w-xl text-pretty text-base text-[#687068]">Straightforward monthly billing for teams ready to turn more contacts into conversations.</motion.p></motion.div>
        <motion.article initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, ease }} onMouseMove={cursorGlow} className="pricing-glow relative mx-auto grid max-w-4xl overflow-hidden rounded-2xl border border-[#27a84a] bg-white shadow-[0_24px_70px_rgba(26,132,57,0.12)] md:grid-cols-[0.86fr_1.14fr]">
          <div className="relative z-10 bg-[#f2faf4] p-8 md:p-12"><span className="inline-flex rounded-full bg-[#168f39] px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white">Standard plan</span><p className="mt-8 text-sm text-[#697169]">One complete workspace</p><div className="mt-2 flex items-end gap-2"><span className="text-6xl font-semibold tracking-tight text-[#101310]">$89.99</span><span className="pb-2 text-sm text-[#697169]">per month</span></div><p className="mt-4 text-sm leading-6 text-[#59615b]">Predictable base pricing with transparent usage after the included credits.</p></div>
          <div className="relative z-10 p-8 md:p-12"><p className="text-base font-semibold">Everything in Standard</p><div className="mt-6 grid gap-4 sm:grid-cols-2">{features.map((feature) => <div key={feature} className="flex gap-3 text-sm text-[#4e5750]"><span className="grid size-5 shrink-0 place-items-center rounded-full bg-[#e7f7ea] text-[#158f39]"><Check className="size-3" weight="bold" /></span><span>{feature}</span></div>)}</div><Link href="/signup" className="group mt-8 flex w-full items-center justify-center gap-2 rounded-lg bg-[#090b09] px-3 py-3 text-base font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-0.5 hover:shadow-xl active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15933b]">Get started for free <ArrowRight className="size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" /></Link></div>
        </motion.article>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section id="faq" className="border-t border-[#edf0ed] bg-[#fbfcfb] px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1200px] gap-12 lg:grid-cols-[0.7fr_1.3fr]">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }}><motion.p variants={reveal} className="text-xs font-semibold uppercase tracking-widest text-[#15933b]">FAQ</motion.p><motion.h2 variants={reveal} className="mt-3 text-balance text-4xl font-semibold tracking-tight">The details, before you start.</motion.h2><motion.p variants={reveal} className="mt-4 max-w-sm text-pretty text-sm leading-6 text-[#687068]">Clear answers about the plan, usage, contacts, campaigns, and number setup.</motion.p></motion.div>
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true, margin: "-80px" }} transition={{ staggerChildren: 0.06 }} className="divide-y divide-[#e3e7e3] border-y border-[#e3e7e3]">{faqItems.map((item) => <motion.details variants={reveal} key={item.question} className="group py-5"><summary className="flex cursor-pointer list-none items-center justify-between gap-6 rounded-lg text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15933b]">{item.question}<Plus className="size-4 shrink-0 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-45" /></summary><p className="max-w-2xl pt-4 text-pretty text-sm leading-6 text-[#687068]">{item.answer}</p></motion.details>)}</motion.div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
      <motion.div initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.8, ease }} onMouseMove={cursorGlow} className="cta-glow relative mx-auto min-h-80 max-w-[1440px] overflow-hidden rounded-2xl bg-[#070807] px-6 py-20 text-center text-white">
        <div className="cta-dots absolute inset-0 opacity-55" />
        <motion.div className="absolute left-6 top-1/2 hidden size-20 -translate-y-1/2 rotate-6 place-items-center rounded-2xl bg-[#123d1c] text-[#65e47f] shadow-2xl sm:grid lg:left-20" animate={{ y: [0, -8, 0], rotate: [6, 4, 6] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}><ChatCircleDots className="size-9" weight="fill" /></motion.div>
        <motion.div className="absolute right-6 top-1/2 hidden size-20 -translate-y-1/2 -rotate-6 place-items-center rounded-2xl bg-[#123d1c] text-[#65e47f] shadow-2xl sm:grid lg:right-20" animate={{ y: [0, 7, 0], rotate: [-6, -3, -6] }} transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}><PaperPlaneTilt className="size-9" weight="fill" /></motion.div>
        <div className="relative z-10 mx-auto max-w-2xl"><h2 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">Ready to start more conversations?</h2><p className="mx-auto mt-4 max-w-xl text-pretty text-sm leading-6 text-white/60">Bring your contacts, campaigns, follow ups, and replies into one focused workspace.</p><Link href="/signup" className="group mt-8 inline-flex items-center gap-2 rounded-lg bg-[#29b64f] px-4 py-3 text-base font-semibold text-[#071009] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:bg-[#43ca65] active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">Get started for free <ArrowRight className="size-4 transition-transform duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-1" /></Link></div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-[#070807] px-4 py-16 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1440px] gap-12 md:grid-cols-2 lg:grid-cols-[1.2fr_0.7fr_0.7fr_1.2fr]">
        <div><Link href="/" className="rounded-lg"><Logo inverse /></Link><p className="mt-5 max-w-xs text-sm leading-6 text-white/50">SMS outreach software built for modern teams that value focused conversations.</p></div>
        <div><p className="text-sm font-semibold">Product</p><div className="mt-4 flex flex-col gap-3">{navItems.slice(0, 3).map((item) => <Link key={item.label} href={item.href} className="text-sm text-white/50 transition-colors hover:text-white">{item.label}</Link>)}<Link href="/login" className="text-sm text-white/50 transition-colors hover:text-white">Log in</Link></div></div>
        <div><p className="text-sm font-semibold">Resources</p><div className="mt-4 flex flex-col gap-3"><Link href="#faq" className="text-sm text-white/50 transition-colors hover:text-white">FAQ</Link><a href="mailto:support@riink.app" className="text-sm text-white/50 transition-colors hover:text-white">Contact</a><Link href="/signup" className="text-sm text-white/50 transition-colors hover:text-white">Get started for free</Link></div></div>
        <div><p className="text-sm font-semibold">Talk with us</p><p className="mt-3 max-w-sm text-sm leading-6 text-white/50">Have a question about Riink or want to discuss your outreach workflow?</p><a href="mailto:support@riink.app" className="group mt-5 inline-flex items-center gap-2 rounded-lg bg-[#57d874] px-3 py-2 text-sm font-semibold text-[#071009] transition-transform hover:-translate-y-0.5 active:translate-y-px">Contact Riink <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></a></div>
      </div>
      <div className="mx-auto mt-16 flex max-w-[1440px] flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/35 sm:flex-row sm:items-center sm:justify-between"><p>© {new Date().getFullYear()} Riink. All rights reserved.</p><div className="flex items-center gap-4"><Link href="/cookies" className="transition-colors hover:text-white">Cookie policy</Link><p>Built for thoughtful outreach.</p></div></div>
    </footer>
  );
}

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-clip bg-white text-[#111311]">
      <a href="#main-content" className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-black shadow-xl transition-transform focus:translate-y-0">Skip to content</a>
      <header className="sticky top-0 z-50 h-16 border-b border-white/10 bg-[#050605]/95 text-white backdrop-blur-xl">
        <nav className="mx-auto flex h-full max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
          <Link href="/" className="rounded-lg"><Logo inverse /></Link>
          <div className="hidden items-center gap-10 md:flex">{navItems.map((item) => <Link key={item.label} href={item.href} className="rounded-md text-sm text-white/65 transition-colors duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:text-white">{item.label}</Link>)}</div>
          <div className="hidden items-center gap-5 md:flex"><Link href="/login" className="rounded-lg text-sm text-white/65 transition-colors hover:text-white">Log in</Link><Link href="/signup" className="group inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-black transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]">Get started for free <ArrowRight className="size-3 transition-transform group-hover:translate-x-1" /></Link></div>
          <button onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="Toggle navigation" className="relative grid size-10 place-items-center rounded-lg border border-white/10 md:hidden">{menuOpen ? <X className="size-5" /> : <List className="size-5" />}</button>
        </nav>
        <AnimatePresence>{menuOpen && <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.5, ease }} className="absolute inset-x-0 top-16 border-b border-white/10 bg-[#050605]/95 p-4 backdrop-blur-2xl md:hidden"><div className="flex flex-col gap-2">{navItems.map((item) => <Link key={item.label} href={item.href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 text-base text-white/75 hover:bg-white/5 hover:text-white">{item.label}</Link>)}<div className="mt-2 grid grid-cols-2 gap-2"><Link href="/login" className="rounded-lg border border-white/15 px-3 py-3 text-center text-sm">Log in</Link><Link href="/signup" className="rounded-lg bg-white px-3 py-3 text-center text-sm font-semibold text-black">Get started free</Link></div></div></motion.div>}</AnimatePresence>
      </header>

      <main id="main-content">
        <section className="relative overflow-hidden bg-white px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="mx-auto grid min-h-[740px] max-w-[1500px] items-center gap-10 lg:grid-cols-[0.42fr_0.58fr]">
            <motion.div initial="hidden" animate="visible" transition={{ staggerChildren: 0.09 }} className="relative z-10 pb-8 lg:pb-0">
              <motion.div variants={reveal} transition={{ duration: 0.8, ease }} className="inline-flex items-center gap-2 rounded-full border border-[#cce8d2] bg-white px-3 py-2 text-xs text-[#536056] shadow-sm"><Lightning className="size-3 text-[#15933b]" weight="fill" />Built for outreach. Designed for results.</motion.div>
              <motion.h1 variants={reveal} transition={{ duration: 0.85, ease }} className="mt-8 max-w-[680px] text-balance text-5xl font-semibold tracking-[-0.045em] text-[#0b0d0b] sm:text-6xl xl:text-7xl">SMS outreach<br />that starts real<br /><span className="text-[#1d9f41]">conversations.</span></motion.h1>
              <motion.p variants={reveal} transition={{ duration: 0.85, ease }} className="mt-6 max-w-xl text-pretty text-base leading-6 text-[#697169]">Riink helps focused teams send smart campaigns, automate follow ups, and close more deals over SMS.</motion.p>
              <motion.p variants={reveal} transition={{ duration: 0.85, ease }} className="mt-4 max-w-xl text-pretty text-sm font-medium leading-6 text-[#278343]">Prepare your campaigns for free. Import contacts, build sequences, and activate messaging only when you are ready to send.</motion.p>
              <motion.div variants={reveal} transition={{ duration: 0.85, ease }} className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href="/signup" className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#080a08] px-4 py-3 text-base font-semibold text-white transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:shadow-xl active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15933b]">Get started for free <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></Link><Link href="/demo" className="group inline-flex items-center justify-center gap-2 rounded-lg border border-[#cad0ca] bg-white px-4 py-3 text-base font-semibold text-[#141714] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:-translate-y-1 hover:border-[#8f988f] active:translate-y-px"><Play className="size-4" weight="fill" /> Book a demo</Link></motion.div>
              <motion.div variants={reveal} transition={{ duration: 0.85, ease }} className="mt-10 grid max-w-xl grid-cols-1 gap-5 sm:grid-cols-3">{[[ShieldCheck, "Shared inbox", "Keep replies together"], [Database, "2,000 credits", "Included each month"], [Clock, "Fast setup", "Import with CSV"]].map(([Icon, title, copy]) => { const IconComponent = Icon as typeof ShieldCheck; return <div key={String(title)} className="flex items-start gap-2"><IconComponent className="mt-0.5 size-4 shrink-0 text-[#16933b]" /><div><p className="text-[10px] font-semibold text-[#2c342e]">{String(title)}</p><p className="mt-1 text-[10px] text-[#828a83]">{String(copy)}</p></div></div>; })}</motion.div>
            </motion.div>
            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 1, delay: 0.15, ease }} className="relative -mx-4 sm:mx-0"><HeroScene /></motion.div>
          </div>
        </section>
        <Features />
        <TaglineReveal />
        <Integrations />
        <Pricing />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  );
}
