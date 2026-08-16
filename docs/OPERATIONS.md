# Riink V1 operations

This document is for Riink operators. Provider identifiers, errors, costs, and
reconciliation details belong only in server logs and `/admin`; they must never
be copied into customer-facing support messages.

## Deployment gate

Before the first remote migration or deployment:

1. Rotate any database password or API credential that has been shared outside
   the secret manager. In particular, rotate the PostgreSQL password previously
   exposed during development.
2. Configure every variable listed in `.env.example` in the deployment secret
   store. Never commit real values.
3. Verify `APP_URL=https://www.riink.app`. Webhook signature verification uses
   this canonical origin and intentionally ignores the incoming Host header.
4. Replay all Supabase migrations from zero in a disposable environment and run
   the database and application quality gates from `README.md`.
5. Confirm that the Stripe recurring Price referenced by
   `STRIPE_BASE_PRICE_ID` is active, fixed (`licensed`) usage, exactly USD 89.99,
   and recurs every one month (`interval=month`, `interval_count=1`). Overage is
   produced by Riink as one aggregate invoice item and must not be encoded in
   that base Price.

## Webhooks and scheduled work

Configure these HTTPS endpoints:

- SMS provider inbound and status callbacks: `POST /api/webhooks/sms`.
- Hosted-number import status callbacks: `POST /api/webhooks/number-imports`.
- Stripe notifications: `POST /api/webhooks/stripe`.

The Stripe endpoint accepts the event families used by the billing runtime:

- `setup_intent.succeeded`;
- `invoice.created`, `invoice.paid`, and `invoice.payment_failed`;
- `customer.subscription.created`, `customer.subscription.updated`, and
  `customer.subscription.deleted`.

Inngest polls messaging maintenance every minute and schedules billing
maintenance hourly through `GET|POST|PUT /api/inngest`. Install the official
Inngest integration on the Vercel project so it configures
`INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, and synchronizes the functions after
each deployment. The database permits at most one dispatch attempt per campaign
during that campaign's configured `drip_interval_minutes`; the worker's limit of
50 is only a global bound across different campaigns. Messaging runs directly,
while hourly billing keeps its durable step. This keeps expected Hobby usage
around 44,640 executions per 30-day month, leaving retry headroom below the
current 50,000-execution allowance.

The legacy `/api/cron/messaging` and `/api/cron/billing` routes remain as
operator-only fallbacks and require `CRON_SECRET`, but they are no longer
declared as Vercel Cron Jobs. A failed job must be retried through Inngest or the
same protected route; never bypass the database claim or reconciliation RPCs
with an ad-hoc provider call. `dispatch_unknown` must never be resent
automatically.

Campaign operators may use **Retry failed messages** from the campaign page.
That action requeues only a definite `message_send_failed` recorded before any
provider acceptance, billing allocation, or provider message identifier. It
preserves the former failure in the private retry audit and returns the message
to the regular campaign scheduler, so the campaign's configured interval,
sending days, and sending window still apply. Delivery failures,
`dispatch_unknown`, suppressed contacts, and contacts that replied are never
included in this bulk retry.

A campaign reply is product-confirmed only after the SMS webhook signature has
been verified, its provider message ID has passed idempotency checks, and the
database has linked the inbound message to an accepted, non-failed outbound
message from that campaign. Only that transaction sets `replied_at` and stops
the recipient's sequence. This confirms the reply arrived through the assigned
phone number; it does not prove the legal identity of the person holding the
recipient's phone.

## Resend email and support forwarding

Resend handles demo request notifications and support email forwarding. Verify
`riink.app` for sending, then enable Receiving for the domain only after
confirming that its MX records do not conflict with another mailbox provider.
Configure an `email.received` webhook pointing to:

`https://www.riink.app/api/webhooks/resend`

Copy the webhook signing secret into `RESEND_WEBHOOK_SECRET`. Incoming mail is
forwarded only when the recipient is exactly `support@riink.app`; the forwarding
destination is `SUPPORT_FORWARD_TO_EMAIL`. Resend recommends using a receiving
subdomain when the root domain already has MX records. In that case, retain the
existing provider for `support@riink.app` and configure its forwarding rule
instead of replacing the root MX records.

## Phone number activation

Number setup is intentionally two-stage:

1. The workspace can request a number and continue using contacts, pipeline,
   and campaign drafts while it remains Pending.
2. A Riink administrator verifies the external registration, confirms that
   Advanced Opt-Out is enabled for the workspace Messaging Service, and only
   then uses the `/admin` activation control.

The activation action records that compliance confirmation before it records
registration approval or attempts subscription activation. Do not mark a
number Ready directly in SQL. If any external result is ambiguous, leave the
operation in its reconciliation state and resolve it through `/admin`; do not
repeat the external call.

## Billing and reconciliation

- Customer usage is real outbound SMS segments; the UI names them SMS credits.
- Inbound usage never consumes included credits and is never customer billable.
- Reconciled and estimated provider cost remains internal accounting data and
  never determines V1 customer pricing. Never serialize Twilio estimates,
  destination prices, carrier fee ranges, or provider cost breakdowns to the
  customer campaign UI. Customers only see credits, projected plan usage, and
  their additional Riink charge.
- Destination estimates are versioned in
  `src/lib/messaging/destination-pricing.ts`. As of 2026-08-14 the supported
  outbound rates per segment are France $0.0798, United States $0.0118 to
  $0.0133 including the carrier fee range, and Canada $0.0147 to $0.0170
  including the carrier fee range. Recheck Twilio before changing that table.
- A message keeps its original `billing_period_id`, `usage_position`, and plan
  snapshots forever. Late segment reconciliation may create an unpaid delta for
  a later invoice, but it must never use a later period's included credits.
- An invoice gets at most one aggregate `Additional SMS usage` item. Replayed
  webhook events and cron runs must reuse the durable invoice run.
- `dispatch_unknown` is never retried automatically. Resolve it only after an
  operator has established whether the provider accepted the original attempt.

## Incident checks

Use structured server logs and `/admin` to correlate, when available:

`workspace_id`, `campaign_id`, `campaign_recipient_id`, `contact_id`,
`message_id`, `provider_message_id`, `stripe_event_id`, `dispatch_state`,
`event`, and `timestamp`.

Do not paste credentials, webhook signatures, raw provider payloads, card data,
or customer message bodies into logs or tickets. Invalid webhook signatures are
acknowledged without processing and emit the safe `signature_rejected` event;
investigate repeated events as either configuration drift or abuse.
