import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

const demoRequestSchema = z.object({
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  goal: z.string().trim().min(10).max(1200),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^[+0-9 ()-]{7,24}$/),
  teamSize: z.string().trim().min(1).max(80),
  volume: z.string().trim().min(1).max(80),
  website: z.string().max(0).optional().default(""),
});

const attempts = new Map<string, { count: number; resetAt: number }>();

function escaped(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function allowed(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (current.count >= 5) return false;
  current.count += 1;
  return true;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(process.env.APP_URL ?? request.url).origin;
  if (origin && origin !== expectedOrigin && !origin.startsWith("http://localhost:")) {
    return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!allowed(forwarded)) {
    return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "The request could not be read." }, { status: 400 });
  }
  const parsed = demoRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: "Check the highlighted information and try again." }, { status: 400 });
  }
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const to = process.env.DEMO_REQUEST_TO_EMAIL?.trim() ?? "tychique@verytis.com";
  if (!apiKey || !from) {
    return NextResponse.json({ message: "Demo requests are temporarily unavailable." }, { status: 503 });
  }

  const data = parsed.data;
  const fingerprint = createHash("sha256").update(`${data.email}|${data.company}|${data.goal}`).digest("hex").slice(0, 24);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `demo-request/${fingerprint}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: data.email,
      subject: `Riink demo request from ${data.company}`,
      html: `<div style="font-family:Arial,sans-serif;color:#17211b;line-height:1.6"><h1>New Riink demo request</h1><p><strong>Name:</strong> ${escaped(data.name)}</p><p><strong>Work email:</strong> ${escaped(data.email)}</p><p><strong>Phone:</strong> ${escaped(data.phone)}</p><p><strong>Company:</strong> ${escaped(data.company)}</p><p><strong>Team size:</strong> ${escaped(data.teamSize)}</p><p><strong>Monthly outreach:</strong> ${escaped(data.volume)}</p><h2>What they want to cover</h2><p>${escaped(data.goal).replace(/\n/g, "<br>")}</p></div>`,
      text: `New Riink demo request\n\nName: ${data.name}\nWork email: ${data.email}\nPhone: ${data.phone}\nCompany: ${data.company}\nTeam size: ${data.teamSize}\nMonthly outreach: ${data.volume}\n\nWhat they want to cover:\n${data.goal}`,
      headers: { "X-Entity-Ref-ID": randomUUID() },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ message: "We could not send your request. Please try again." }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
