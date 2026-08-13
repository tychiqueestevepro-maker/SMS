# Riink

Riink is a focused SMS outreach CRM for campaigns, contacts, conversations, and a customizable sales pipeline.

`PLAN.md` is the implementation source of truth. The customer-facing product must remain provider-neutral and entirely in English.

## Local setup

1. Copy `.env.example` to `.env.local` and provide valid Supabase credentials.
2. Install dependencies with `npm install`.
3. Start local Supabase with `npx supabase start`.
4. Start the app with `npm run dev`.

Scheduled production maintenance is orchestrated by Inngest. For local workflow
inspection, run the app and the Inngest Dev Server with `npx inngest-cli@latest
dev`; production setup is documented in `docs/OPERATIONS.md`.

Quality checks:

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test
npx.cmd supabase db reset
npx.cmd supabase test db
npx.cmd supabase db lint --level error
npm.cmd run test:client-copy
npm.cmd run test:provider-boundary
npm.cmd run build
npm.cmd audit --omit=dev
```

Targeted browser acceptance tests:

```powershell
npm.cmd run test:e2e:list
npm.cmd run test:e2e
```

`test:e2e` requires local Supabase and an already-installed Playwright Chromium
binary. The runner derives its credentials from `supabase status`, refuses every
non-loopback Supabase or PostgreSQL URL, and never downloads a browser. The
`postgres` development dependency is used only to seed and clean local E2E rows
because the product service role intentionally has no direct table grants.
Playwright reports, traces, videos, and screenshots are ignored by Git.

Supabase migrations live under `supabase/migrations`, apply in order, and are replayed from zero during database validation.

Production activation, webhook, compliance, billing, and reconciliation steps
are documented in [`docs/OPERATIONS.md`](docs/OPERATIONS.md). Remote migrations
must not run until every previously exposed credential has been rotated.
