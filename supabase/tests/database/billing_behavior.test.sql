begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select no_plan();

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-000000002001',
  'authenticated',
  'authenticated',
  'billing-behavior@riink.invalid',
  '',
  timestamptz '2026-07-01 00:00:00+00',
  '{}'::jsonb,
  '{}'::jsonb,
  timestamptz '2026-07-01 00:00:00+00',
  timestamptz '2026-07-01 00:00:00+00'
);

update public.billing_periods as period
set
  period_start = timestamptz '2026-07-01 00:00:00+00',
  period_end = timestamptz '2026-08-01 00:00:00+00',
  is_provisional = false
from public.workspaces as workspace
where period.workspace_id = workspace.id
  and workspace.owner_id = '00000000-0000-4000-8000-000000002001'
  and period.status = 'open';

insert into private.billing_period_provider_details (
  billing_period_id,
  workspace_id,
  subscription_id,
  activated_at
)
select
  period.id,
  period.workspace_id,
  'subscription-billing-behavior',
  timestamptz '2026-07-01 00:00:00+00'
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
  and period.status = 'open';

update private.workspace_billing_accounts as account
set
  stripe_customer_id = 'customer-billing-behavior',
  default_payment_method_id = 'payment-billing-behavior',
  payment_method_status = 'saved',
  stripe_subscription_id = 'subscription-billing-behavior',
  subscription_price_id = 'price-billing-behavior',
  subscription_status = 'active',
  current_period_start = period.period_start,
  current_period_end = period.period_end
from public.billing_periods as period
where account.workspace_id = period.workspace_id
  and period.status = 'open'
  and period.workspace_id = (
    select workspace.id
    from public.workspaces as workspace
    where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
  );

insert into public.phone_numbers (
  id,
  workspace_id,
  phone_e164,
  status
)
select
  '00000000-0000-4000-8000-000000002101',
  workspace.id,
  '+14155552001',
  'ready'
from public.workspaces as workspace
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

insert into public.contacts (
  id,
  workspace_id,
  pipeline_stage_id,
  first_name,
  phone_e164
)
select
  '00000000-0000-4000-8000-000000002201',
  workspace.id,
  stage.id,
  'Billing',
  '+14155552002'
from public.workspaces as workspace
join public.pipeline_stages as stage
  on stage.workspace_id = workspace.id
  and stage.is_default
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

insert into public.messages (
  id,
  workspace_id,
  contact_id,
  phone_number_id,
  direction,
  body,
  dispatch_state,
  delivery_state,
  estimated_segments,
  reserved_segments,
  num_segments,
  billing_period_id,
  usage_position,
  included_segments_snapshot,
  overage_price_micro_usd_snapshot,
  accepted_at,
  sent_at,
  created_at
)
select
  '00000000-0000-4000-8000-000000002301',
  workspace.id,
  '00000000-0000-4000-8000-000000002201',
  '00000000-0000-4000-8000-000000002101',
  'outbound',
  'Prior July usage',
  'accepted',
  'sent',
  1,
  0,
  1999,
  period.id,
  1,
  period.included_segments_snapshot,
  period.overage_price_micro_usd_snapshot,
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00',
  timestamptz '2026-07-30 12:00:00+00'
from public.workspaces as workspace
join public.billing_periods as period
  on period.workspace_id = workspace.id
  and period.status = 'open'
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

insert into public.messages (
  id,
  workspace_id,
  contact_id,
  phone_number_id,
  direction,
  body,
  dispatch_state,
  estimated_segments,
  reserved_segments,
  reserved_billing_period_id,
  billing_period_id,
  usage_position,
  included_segments_snapshot,
  overage_price_micro_usd_snapshot,
  accepted_at,
  sent_at,
  created_at
)
select
  '00000000-0000-4000-8000-000000002302',
  workspace.id,
  '00000000-0000-4000-8000-000000002201',
  '00000000-0000-4000-8000-000000002101',
  'outbound',
  'Late multipart July usage',
  'accepted',
  1,
  1,
  period.id,
  period.id,
  2,
  period.included_segments_snapshot,
  period.overage_price_micro_usd_snapshot,
  timestamptz '2026-07-31 23:59:00+00',
  timestamptz '2026-07-31 23:59:00+00',
  timestamptz '2026-07-31 23:59:00+00'
from public.workspaces as workspace
join public.billing_periods as period
  on period.workspace_id = workspace.id
  and period.status = 'open'
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

update public.billing_period_usage as usage
set
  actual_outbound_segments = 1999,
  reserved_outbound_segments = 1,
  next_usage_position = 2
where usage.workspace_id = (
  select workspace.id
  from public.workspaces as workspace
  where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
);

update public.billing_periods as period
set status = 'closed'
where period.workspace_id = (
  select workspace.id
  from public.workspaces as workspace
  where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
)
  and period.period_start = timestamptz '2026-07-01 00:00:00+00';

insert into public.billing_periods (
  id,
  workspace_id,
  billing_plan_id,
  period_start,
  period_end,
  status,
  is_provisional,
  monthly_price_cents_snapshot,
  included_segments_snapshot,
  overage_price_micro_usd_snapshot,
  max_phone_numbers_snapshot,
  safety_cap_segments_snapshot
)
select
  '00000000-0000-4000-8000-000000002401',
  workspace.id,
  plan.id,
  timestamptz '2026-08-01 00:00:00+00',
  timestamptz '2026-09-01 00:00:00+00',
  'open',
  false,
  plan.monthly_price_cents,
  plan.included_segments,
  plan.overage_price_micro_usd,
  plan.max_phone_numbers,
  plan.safety_cap_segments
from public.workspaces as workspace
join public.billing_plans as plan on plan.id = workspace.billing_plan_id
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

insert into private.billing_period_provider_details (
  billing_period_id,
  workspace_id,
  subscription_id,
  activated_at
)
select
  period.id,
  period.workspace_id,
  'subscription-billing-behavior',
  timestamptz '2026-08-01 00:00:00+00'
from public.billing_periods as period
where period.id = '00000000-0000-4000-8000-000000002401';

update private.workspace_billing_accounts as account
set
  current_period_start = timestamptz '2026-08-01 00:00:00+00',
  current_period_end = timestamptz '2026-09-01 00:00:00+00'
where account.workspace_id = (
  select workspace.id
  from public.workspaces as workspace
  where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
);

select lives_ok(
  $$
    select private.record_message_actual_segments(
      '00000000-0000-4000-8000-000000002302',
      3
    )
  $$,
  'late multipart usage reconciles after the original period has closed'
);

select ok(
  (
    select message.billing_period_id = july.id
      and message.usage_position = 2
      and ledger.included_segments = 1
      and ledger.overage_segments = 2
      and ledger.customer_billable_amount_micro_usd = 80000
    from public.messages as message
    join private.billing_usage_ledger as ledger on ledger.message_id = message.id
    join public.billing_periods as july on july.id = message.billing_period_id
    where message.id = '00000000-0000-4000-8000-000000002302'
      and july.period_start = timestamptz '2026-07-01 00:00:00+00'
  ),
  'late usage keeps July attribution and splits 1 included plus 2 overage credits'
);

select ok(
  (
    select july_usage.actual_outbound_segments = 2002
      and july_usage.reserved_outbound_segments = 0
      and august_usage.actual_outbound_segments = 0
      and august_usage.reserved_outbound_segments = 0
    from public.billing_period_usage as july_usage
    join public.billing_periods as july on july.id = july_usage.billing_period_id
    cross join public.billing_period_usage as august_usage
    join public.billing_periods as august on august.id = august_usage.billing_period_id
    where july.period_start = timestamptz '2026-07-01 00:00:00+00'
      and august.period_start = timestamptz '2026-08-01 00:00:00+00'
      and july.workspace_id = august.workspace_id
  ),
  'July reconciliation never consumes August included credits'
);

insert into public.messages (
  id,
  workspace_id,
  contact_id,
  phone_number_id,
  direction,
  body,
  dispatch_state,
  delivery_state,
  num_segments,
  billing_period_id,
  received_at,
  accepted_at,
  sent_at,
  created_at
)
select
  '00000000-0000-4000-8000-000000002303',
  workspace.id,
  '00000000-0000-4000-8000-000000002201',
  '00000000-0000-4000-8000-000000002101',
  'inbound',
  'Inbound provider cost',
  'accepted',
  'delivered',
  2,
  period.id,
  timestamptz '2026-07-31 23:59:30+00',
  timestamptz '2026-07-31 23:59:30+00',
  timestamptz '2026-07-31 23:59:30+00',
  timestamptz '2026-07-31 23:59:30+00'
from public.workspaces as workspace
join public.billing_periods as period
  on period.workspace_id = workspace.id
  and period.period_start = timestamptz '2026-07-01 00:00:00+00'
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

insert into private.billing_usage_ledger (
  workspace_id,
  billing_period_id,
  message_id,
  direction,
  num_segments,
  provider_cost_micro_usd,
  included_segments,
  overage_segments,
  customer_billable_amount_micro_usd
)
select
  message.workspace_id,
  message.billing_period_id,
  message.id,
  'inbound',
  message.num_segments,
  1500,
  0,
  0,
  0
from public.messages as message
where message.id = '00000000-0000-4000-8000-000000002303';

select ok(
  (
    select ledger.provider_cost_micro_usd = 1500
      and ledger.included_segments = 0
      and ledger.overage_segments = 0
      and ledger.customer_billable_amount_micro_usd = 0
      and ledger.usage_position is null
    from private.billing_usage_ledger as ledger
    where ledger.message_id = '00000000-0000-4000-8000-000000002303'
  ),
  'inbound provider cost remains internal and never becomes customer usage'
);

select is(
  (
    select claim.claim_state
    from public.billing_claim_webhook_event(
      timestamptz '2026-09-01 00:00:00+00',
      'event-billing-behavior-invoice',
      'invoice.created',
      timestamptz '2026-09-01 00:00:01+00'
    ) as claim
  ),
  'claimed'::text,
  'the next invoice event is claimed exactly once'
);

select is(
  (
    select run.amount_micro_usd
    from public.billing_prepare_additional_usage_invoice_run(
      'subscription_cycle',
      (select event.claim_token from private.billing_webhook_events as event where event.event_id = 'event-billing-behavior-invoice'),
      'customer-billing-behavior',
      'event-billing-behavior-invoice',
      timestamptz '2026-09-01 00:00:02+00',
      'invoice-billing-behavior-august',
      timestamptz '2026-09-01 00:00:00+00',
      timestamptz '2026-08-01 00:00:00+00',
      timestamptz '2026-09-01 00:00:02+00',
      'subscription-billing-behavior'
    ) as run
  ),
  80000::bigint,
  'the next invoice aggregates only the unpaid July overage delta'
);

select is(
  (
    select run.run_state
    from public.billing_prepare_additional_usage_invoice_run(
      'subscription_cycle',
      (select event.claim_token from private.billing_webhook_events as event where event.event_id = 'event-billing-behavior-invoice'),
      'customer-billing-behavior',
      'event-billing-behavior-invoice',
      timestamptz '2026-09-01 00:00:02+00',
      'invoice-billing-behavior-august',
      timestamptz '2026-09-01 00:00:00+00',
      timestamptz '2026-08-01 00:00:00+00',
      timestamptz '2026-09-01 00:00:03+00',
      'subscription-billing-behavior'
    ) as run
  ),
  'ready'::text,
  'replaying invoice preparation reuses the same aggregate run'
);

select ok(
  (select count(*) = 1 from private.billing_invoice_runs where stripe_invoice_id = 'invoice-billing-behavior-august')
  and (select count(*) = 1 from private.billing_invoice_run_entries),
  'one invoice and one ledger delta exist after replay'
);

select is(
  (
    select completion.run_state
    from public.billing_complete_additional_usage_invoice_run(
      8,
      (select run.id from private.billing_invoice_runs as run where run.stripe_invoice_id = 'invoice-billing-behavior-august'),
      (select event.claim_token from private.billing_webhook_events as event where event.event_id = 'event-billing-behavior-invoice'),
      timestamptz '2026-09-01 00:00:04+00',
      'event-billing-behavior-invoice',
      'invoice-billing-behavior-august',
      'invoice-item-billing-behavior',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000002001')
    ) as completion
  ),
  'completed'::text,
  'the aggregate invoice item completes once'
);

select ok(
  (
    select ledger.billed_overage_segments = 2
      and ledger.billed_customer_amount_micro_usd = 80000
      and ledger.reserved_overage_segments = 0
      and ledger.reserved_billing_invoice_run_id is null
    from private.billing_usage_ledger as ledger
    where ledger.message_id = '00000000-0000-4000-8000-000000002302'
  ),
  'invoice completion marks the exact original ledger delta as paid'
);

select is(
  (
    select claim.claim_state
    from public.billing_claim_webhook_event(
      timestamptz '2026-09-02 00:00:00+00',
      'event-billing-behavior-ended',
      'customer.subscription.deleted',
      timestamptz '2026-09-02 00:00:01+00'
    ) as claim
  ),
  'claimed'::text,
  'the terminal lifecycle event is claimed'
);

select lives_ok(
  $$
    select public.billing_apply_lifecycle_event(
      false,
      false,
      (select event.claim_token from private.billing_webhook_events as event where event.event_id = 'event-billing-behavior-ended'),
      'customer-billing-behavior',
      'event-billing-behavior-ended',
      'subscription_ended',
      timestamptz '2026-09-02 00:00:00+00',
      null,
      null,
      null,
      null,
      'canceled',
      'subscription-billing-behavior',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000002001')
    )
  $$,
  'a terminal subscription event starts the seven-day grace state'
);

select ok(
  (
    select account.subscription_status = 'grace'
      and account.grace_ends_at = timestamptz '2026-09-09 00:00:00+00'
      and account.terminal_at = timestamptz '2026-09-02 00:00:00+00'
      and not control.messaging_enabled
    from private.workspace_billing_accounts as account
    join private.workspace_messaging_controls as control
      on control.workspace_id = account.workspace_id
    where account.workspace_id = (
      select workspace.id
      from public.workspaces as workspace
      where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
    )
  ),
  'terminal billing disables sending while preserving the exact grace deadline'
);

select is(
  (
    select expiration.expired_count
    from public.billing_expire_grace_periods(
      100,
      timestamptz '2026-09-09 00:00:01+00'
    ) as expiration
  ),
  1,
  'the grace period expires exactly once'
);

select is(
  (
    select account.subscription_status
    from private.workspace_billing_accounts as account
    where account.workspace_id = (
      select workspace.id
      from public.workspaces as workspace
      where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
    )
  ),
  'ended'::text,
  'expired grace becomes terminal without automatic reactivation'
);

select * from finish();

rollback;
