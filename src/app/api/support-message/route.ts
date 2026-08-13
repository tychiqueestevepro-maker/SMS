import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  message: z.string().trim().min(10).max(3000),
  website: z.string().max(0).optional().default(""),
});

const attempts = new Map<string, { count: number; resetAt: number }>();

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function isAllowed(key: string) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 }); return true; }
  if (current.count >= 6) return false;
  current.count += 1;
  return true;
}

async function sendEmail(apiKey: string, payload: Record<string, unknown>, idempotencyKey: string) {
  return fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(process.env.APP_URL ?? request.url).origin;
  if (origin && origin !== expectedOrigin && !origin.startsWith("http://localhost:")) return NextResponse.json({ message: "Request origin is not allowed." }, { status: 403 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!isAllowed(forwarded)) return NextResponse.json({ message: "Too many requests. Please try again later." }, { status: 429 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "Check your email and message." }, { status: 400 });
  if (parsed.data.website) return NextResponse.json({ ok: true });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: "Authentication is required." }, { status: 401 });
  const email = user.email?.trim();
  if (!email) return NextResponse.json({ message: "The account email is unavailable." }, { status: 400 });

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  const supportTo = process.env.SUPPORT_FORWARD_TO_EMAIL?.trim() ?? "tychique@verytis.com";
  if (!apiKey || !from) return NextResponse.json({ message: "Support messaging is temporarily unavailable." }, { status: 503 });

  const safeMessage = escapeHtml(parsed.data.message).replace(/\n/g, "<br>");
  const fingerprint = createHash("sha256").update(`${user.id}|${parsed.data.message}`).digest("hex").slice(0, 24);
  const support = await sendEmail(apiKey, { from, to: [supportTo], reply_to: email, subject: `Riink support message from ${email}`, html: `<div style="font-family:Arial,sans-serif;color:#0a0d0a;line-height:1.6"><h1>New support message</h1><p><strong>Customer:</strong> ${escapeHtml(email)}</p><p><strong>Account ID:</strong> ${escapeHtml(user.id)}</p><p>${safeMessage}</p></div>`, text: `Customer: ${email}\nAccount ID: ${user.id}\n\n${parsed.data.message}` }, `support/${fingerprint}`);
  if (!support.ok) return NextResponse.json({ message: "We could not send your message." }, { status: 502 });

  await sendEmail(apiKey, { from, to: [email], reply_to: "support@riink.app", subject: "We received your Riink support request", html: `<div style="font-family:Arial,sans-serif;color:#0a0d0a;line-height:1.6"><h1>We received your message</h1><p>Thank you for contacting Riink. You will be contacted in the next few minutes.</p><p>You can reply directly to this message if you need to add more information.</p></div>`, text: "We received your message. You will be contacted in the next few minutes. You can reply to this message to add more information." }, `support-confirmation/${fingerprint}`);
  return NextResponse.json({ ok: true });
}
