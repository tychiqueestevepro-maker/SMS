# Riink database foundation

The initial migration provisions a confirmed Supabase user atomically with:

- one profile;
- one owned workspace on the `riink-v1` billing plan;
- one `New` pipeline stage marked as the workspace default.

Pipeline stages are readable from the client but cannot be mutated directly.
Use `set_default_pipeline_stage(stage_id)` and
`reorder_pipeline_stages(workspace_id, stage_ids)` so ownership, locking, and
the exact-one-default invariant stay enforced by the database.

The workspace stores an IANA timezone and a local daily send window. The window
defaults to `09:00` through `20:00`, and its end must be later than its start.

The billing plan row is the only source for the V1 price and limits. Application
code should read it rather than duplicate those constants.

## Local verification

With the Supabase CLI installed:

```powershell
supabase start
supabase db reset
supabase test db
```

`tests/database/foundation.test.sql` checks the seed values, exact-one database
guards, RLS presence, and RPC grants without persisting test data.

## Contacts and pipeline mutations

Contacts keep a permanent `(workspace_id, phone_e164)` identity even after soft
deletion. Client code can read owner-scoped rows but must use these RPCs to
mutate them:

- `create_contact`, `update_contact`, `move_contact_to_stage`;
- `soft_delete_contact`, `restore_contact`;
- `bulk_upsert_contacts` for CSV create/restore/duplicate semantics.

`bulk_upsert_contacts` accepts a JSON array using either snake-case or camel-case
contact field names. It restores deleted matches with the imported values,
leaves active duplicates unchanged, assigns new rows to the current default
stage, preserves a restored row's stage, and never removes an existing
suppression.

Pipeline structure uses `create_pipeline_stage`, `rename_pipeline_stage`, and
`delete_pipeline_stage`. Deleting the default or final stage is rejected. If a
stage contains active or deleted contacts, a valid destination stage is required
and every contact is reassigned in the same transaction.

## Campaign dispatch primitives

Drafts are saved atomically with `save_campaign_draft`. The RPC replaces the
1–3 steps and the `campaign_draft_contacts` selection together. Launch derives
recipients from that stored selection, rechecks eligibility and consent, and
uses the large-launch thresholds from `billing_plans`.

Worker-facing RPCs are in `public` so PostgREST can expose them, but only
`service_role` can execute them:

- `dispatch_claim_and_reserve_next(text, timestamptz)`;
- `dispatch_final_validate_and_begin_attempt(uuid, uuid, timestamptz)`;
- `dispatch_mark_accepted(...)`;
- `dispatch_mark_known_failure_and_release(...)`;
- `dispatch_mark_unknown_and_stop(...)`;
- `reconciliation_claim_next(text, timestamptz)`;
- `reconciliation_complete(...)` and `reconciliation_defer(...)`.

The underlying functions remain in `private`. Claims use `FOR UPDATE SKIP
LOCKED`; final validation records `dispatch_unknown` before authorizing the one
external call. Accepted estimates remain reserved until reconciliation replaces
them transactionally with actual segments. Provider identifiers, raw errors,
costs, and reconciliation state live only in private tables.

`tests/database/campaigns_behavior.test.sql` exercises worker contention,
reservation idempotency, pause/resume, ambiguous dispatch, actual segment
reconciliation, null-safe Reply Rate, transactional deletion, configurable
safety caps, and contact soft-delete cancellation.

## Inbox and inbound messaging

Signed messaging webhooks are resolved and verified in the server-side
messaging adapter before the service role calls `apply_verified_sms_webhook_event`.
The database re-resolves and locks the product context, rejects stale or
mismatched context, and records every provider event idempotently.

Inbound messages reuse a matching soft-deleted contact without restoring it,
while an unknown number creates a minimal contact in the current default stage.
STOP-family commands suppress the contact and stop active campaign recipients;
START/UNSTOP removes suppression only when the signed provider event confirms
the opt-in, and never resumes a previous campaign. Provider identifiers, raw
errors, costs, webhook payloads, and reconciliation metadata remain private.

`tests/database/inbox_behavior.test.sql` covers unknown and deleted contacts,
webhook replay, STOP and confirmed START, reply races, late Failed transitions,
and inbound cost/segment reconciliation. Real manual-send behavior moves to the
provider-onboarding suite below once the simulated adapter is retired.

## Provider and phone-number onboarding

Slice 5/6 stores encrypted workspace credentials, provider identifiers, raw
errors, setup evidence, operation fences, and reconciliation decisions only in
the `private` schema. Public phone-number rows expose just the Riink product
state. Purchase, release, workspace setup, real manual dispatch, and operator
reconciliation RPCs are executable only by `service_role`.

Manual sends use a durable request ID, a database-recomputed SMS-credit
estimate, transactional reservation, and a second validation immediately before
the provider call. An ambiguous result remains `dispatch_unknown` and cannot be
retried; an operator must explicitly confirm sent or not sent. Delivery state,
actual segments, and provider cost reconcile independently without changing the
original billing attribution.

A purchased number remains Pending after technical approval. Billing activation
can be claimed only after A2P approval and a private admin attestation that
Advanced Opt-Out is enabled. Slice 6 deliberately cannot mark it Ready; the
Stripe-backed Slice 7 completion performs that final atomic transition.

`tests/database/provider_onboarding_behavior.test.sql` covers setup and number
operation idempotency, plan capacity including in-flight purchases, approval and
opt-out gates, real manual-send races, cost-before-segments reconciliation,
late Failed handling, safety-cap enforcement, operator resolutions, and masked
number release.
