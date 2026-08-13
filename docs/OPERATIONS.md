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
- Stripe notifications: `POST /api/webhooks/stripe`.

The Stripe endpoint accepts the event families used by the billing runtime:

- `setup_intent.succeeded`;
- `invoice.created`, `invoice.paid`, and `invoice.payment_failed`;
- `customer.subscription.created`, `customer.subscription.updated`, and
  `customer.subscription.deleted`.

Vercel schedules `/api/cron/messaging` every minute and `/api/cron/billing`
hourly. Both require the configured `CRON_SECRET`. A failed job must be retried
through the same endpoint; never bypass the database claim or reconciliation
RPCs with an ad-hoc provider call.

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
- Provider cost is internal accounting data and never determines V1 customer
  pricing.
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
