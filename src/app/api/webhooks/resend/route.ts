import { NextResponse } from "next/server";
import { Resend } from "resend";

const SUPPORT_ADDRESS = "support@riink.app";

function recipients(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" ? [value] : [];
}

export async function POST(request: Request) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  const forwardTo = process.env.SUPPORT_FORWARD_TO_EMAIL?.trim() ?? "tychique@verytis.com";
  const forwardFrom = process.env.RESEND_FORWARD_FROM_EMAIL?.trim() ?? "Riink Support <support@riink.app>";
  if (!apiKey || !webhookSecret) {
    return NextResponse.json({ message: "Resend webhook is not configured." }, { status: 503 });
  }

  const id = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ message: "Webhook signature headers are missing." }, { status: 400 });
  }

  const resend = new Resend(apiKey);
  const payload = await request.text();
  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    event = resend.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return NextResponse.json({ message: "Webhook signature is invalid." }, { status: 400 });
  }

  if (event.type !== "email.received") return NextResponse.json({ received: true });
  const to = recipients(event.data.to).map((address) => address.toLowerCase());
  if (!to.includes(SUPPORT_ADDRESS)) return NextResponse.json({ received: true, forwarded: false });

  const { data, error } = await resend.emails.receiving.forward({
    emailId: event.data.email_id,
    from: forwardFrom,
    to: forwardTo,
  });
  if (error) {
    return NextResponse.json({ message: "The support email could not be forwarded." }, { status: 502 });
  }

  return NextResponse.json({ received: true, forwarded: true, id: data?.id ?? null });
}
