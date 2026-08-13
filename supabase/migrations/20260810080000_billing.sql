begin;

-- Stripe identifiers, payment state, invoice runs, and every provider-facing
-- billing detail are intentionally private. Workspace clients receive only the
-- product-safe summary exposed near the end of this migration.
create table private.workspace_billing_accounts (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  stripe_customer_id text unique,
  default_payment_method_id text,
  latest_setup_intent_id text,
  last_payment_method_event_at timestamptz,
  last_payment_method_event_id text,
  payment_method_status text not null default 'missing',
  stripe_subscription_id text unique,
  subscription_price_id text,
  subscription_status text not null default 'not_started',
  current_period_start timestamptz,
  current_period_end timestamptz,
  latest_invoice_id text,
  cancel_at_period_end boolean not null default false,
  grace_ends_at timestamptz,
  terminal_at timestamptz,
  last_lifecycle_event_at timestamptz,
  last_lifecycle_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_billing_accounts_payment_status_valid check (
    payment_method_status in ('missing', 'setup_required', 'saved')
  ),
  constraint workspace_billing_accounts_subscription_status_valid check (
    subscription_status in (
      'not_started',
      'setup_required',
      'active',
      'cancellation_scheduled',
      'incomplete',
      'past_due',
      'unpaid',
      'grace',
      'ended',
      'canceled'
    )
  ),
  constraint workspace_billing_accounts_values_not_blank check (
    (stripe_customer_id is null or char_length(btrim(stripe_customer_id)) > 0)
    and (
      default_payment_method_id is null
      or char_length(btrim(default_payment_method_id)) > 0
    )
    and (
      latest_setup_intent_id is null
      or char_length(btrim(latest_setup_intent_id)) > 0
    )
    and (
      stripe_subscription_id is null
      or char_length(btrim(stripe_subscription_id)) > 0
    )
    and (
      subscription_price_id is null
      or char_length(btrim(subscription_price_id)) > 0
    )
  ),
  constraint workspace_billing_accounts_period_shape check (
    (
      current_period_start is null
      and current_period_end is null
    )
    or (
      current_period_start is not null
      and current_period_end is not null
      and current_period_end > current_period_start
    )
  ),
  constraint workspace_billing_accounts_subscription_shape check (
    (
      stripe_subscription_id is null
      and subscription_price_id is null
      and subscription_status in ('not_started', 'setup_required')
      and current_period_start is null
      and current_period_end is null
      and terminal_at is null
    )
    or (
      stripe_subscription_id is not null
      and subscription_price_id is not null
    )
  ),
  constraint workspace_billing_accounts_grace_shape check (
    (subscription_status = 'grace' and grace_ends_at is not null and terminal_at is not null)
    or (subscription_status <> 'grace' and grace_ends_at is null)
  ),
  constraint workspace_billing_accounts_terminal_shape check (
    (subscription_status in ('grace', 'ended', 'canceled') and terminal_at is not null)
    or (subscription_status not in ('grace', 'ended', 'canceled') and terminal_at is null)
  )
);

create trigger workspace_billing_accounts_touch_updated_at
before update on private.workspace_billing_accounts
for each row execute function private.touch_updated_at();

create table private.billing_setup_intents (
  setup_intent_id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  customer_id text not null,
  recorded_at timestamptz not null,
  applied_event_id text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint billing_setup_intents_values_not_blank check (
    char_length(btrim(setup_intent_id)) > 0
    and char_length(btrim(customer_id)) > 0
    and (applied_event_id is null or char_length(btrim(applied_event_id)) > 0)
  ),
  constraint billing_setup_intents_applied_shape check (
    (applied_event_id is null and applied_at is null)
    or (applied_event_id is not null and applied_at is not null)
  )
);

create index billing_setup_intents_workspace_recorded_idx
  on private.billing_setup_intents (workspace_id, recorded_at desc);

create table private.billing_period_provider_details (
  billing_period_id uuid primary key references public.billing_periods (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subscription_id text not null,
  activated_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint billing_period_provider_details_values_not_blank check (
    char_length(btrim(subscription_id)) > 0
  ),
  constraint billing_period_provider_details_workspace_period_key
    unique (workspace_id, billing_period_id)
);

create index billing_period_provider_details_subscription_idx
  on private.billing_period_provider_details (subscription_id, activated_at desc);

create table private.billing_webhook_events (
  event_id text primary key,
  event_type text not null,
  event_created_at timestamptz not null,
  first_received_at timestamptz not null,
  last_received_at timestamptz not null,
  event_status text not null default 'processing',
  claim_token uuid not null,
  claimed_at timestamptz not null,
  attempt_count integer not null default 1,
  outcome text,
  failure_code text,
  provider_error_code text,
  provider_error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhook_events_values_not_blank check (
    char_length(btrim(event_id)) > 0
    and char_length(btrim(event_type)) > 0
  ),
  constraint billing_webhook_events_status_valid check (
    event_status in ('processing', 'completed', 'failed')
  ),
  constraint billing_webhook_events_outcome_valid check (
    outcome is null or outcome in ('ignored', 'processed')
  ),
  constraint billing_webhook_events_attempt_count_positive check (attempt_count > 0),
  constraint billing_webhook_events_terminal_shape check (
    (
      event_status = 'processing'
      and processed_at is null
      and outcome is null
    )
    or (
      event_status = 'completed'
      and processed_at is not null
      and outcome is not null
      and failure_code is null
    )
    or (
      event_status = 'failed'
      and processed_at is not null
      and outcome is null
      and failure_code is not null
    )
  )
);

create trigger billing_webhook_events_touch_updated_at
before update on private.billing_webhook_events
for each row execute function private.touch_updated_at();

create table private.billing_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  billing_event_id text not null,
  billing_reason text not null,
  invoice_created_at timestamptz not null,
  invoice_period_start timestamptz not null,
  invoice_period_end timestamptz not null,
  idempotency_key text not null unique,
  run_state text not null,
  additional_segments integer not null default 0,
  amount_micro_usd bigint not null default 0,
  ledger_entry_count integer not null default 0,
  source_period_ids uuid[] not null default '{}',
  stripe_invoice_item_id text unique,
  amount_cents integer,
  prepared_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_invoice_runs_values_not_blank check (
    char_length(btrim(stripe_invoice_id)) > 0
    and char_length(btrim(stripe_customer_id)) > 0
    and char_length(btrim(stripe_subscription_id)) > 0
    and char_length(btrim(billing_event_id)) > 0
    and char_length(btrim(billing_reason)) > 0
    and char_length(btrim(idempotency_key)) > 0
  ),
  constraint billing_invoice_runs_period_valid check (
    invoice_period_end > invoice_period_start
  ),
  constraint billing_invoice_runs_state_valid check (
    run_state in ('ready', 'completed', 'no_usage')
  ),
  constraint billing_invoice_runs_counts_nonnegative check (
    additional_segments >= 0
    and amount_micro_usd >= 0
    and ledger_entry_count >= 0
    and (amount_cents is null or amount_cents >= 0)
  ),
  constraint billing_invoice_runs_state_shape check (
    (
      run_state = 'ready'
      and additional_segments > 0
      and amount_micro_usd > 0
      and ledger_entry_count > 0
      and cardinality(source_period_ids) > 0
      and stripe_invoice_item_id is null
      and amount_cents is null
      and completed_at is null
    )
    or (
      run_state = 'completed'
      and additional_segments > 0
      and amount_micro_usd > 0
      and ledger_entry_count > 0
      and cardinality(source_period_ids) > 0
      and stripe_invoice_item_id is not null
      and amount_cents is not null
      and completed_at is not null
    )
    or (
      run_state = 'no_usage'
      and additional_segments = 0
      and amount_micro_usd = 0
      and ledger_entry_count = 0
      and cardinality(source_period_ids) = 0
      and stripe_invoice_item_id is null
      and amount_cents is null
      and completed_at is not null
    )
  )
);

create trigger billing_invoice_runs_touch_updated_at
before update on private.billing_invoice_runs
for each row execute function private.touch_updated_at();

alter table private.billing_usage_ledger
  add column billed_overage_segments integer not null default 0,
  add column billed_customer_amount_micro_usd bigint not null default 0,
  add column reserved_overage_segments integer not null default 0,
  add column reserved_customer_amount_micro_usd bigint not null default 0,
  add column reserved_billing_invoice_run_id uuid
    references private.billing_invoice_runs (id) on delete restrict,
  add constraint billing_usage_ledger_billed_values_valid check (
    billed_overage_segments >= 0
    and billed_customer_amount_micro_usd >= 0
    and reserved_overage_segments >= 0
    and reserved_customer_amount_micro_usd >= 0
    and billed_overage_segments + reserved_overage_segments <= overage_segments
    and billed_customer_amount_micro_usd + reserved_customer_amount_micro_usd
      <= customer_billable_amount_micro_usd
  ),
  add constraint billing_usage_ledger_invoice_reservation_shape check (
    (
      reserved_billing_invoice_run_id is null
      and reserved_overage_segments = 0
      and reserved_customer_amount_micro_usd = 0
    )
    or (
      reserved_billing_invoice_run_id is not null
      and reserved_overage_segments > 0
      and reserved_customer_amount_micro_usd > 0
      and direction = 'outbound'
    )
  );

create index billing_usage_ledger_unpaid_idx
  on private.billing_usage_ledger (workspace_id, billing_period_id, usage_position)
  where direction = 'outbound' and num_segments is not null;

create table private.billing_invoice_run_entries (
  id uuid primary key default gen_random_uuid(),
  billing_invoice_run_id uuid not null
    references private.billing_invoice_runs (id) on delete restrict,
  billing_usage_ledger_id uuid not null
    references private.billing_usage_ledger (id) on delete restrict,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  billing_period_id uuid not null references public.billing_periods (id) on delete restrict,
  message_id uuid not null references public.messages (id) on delete restrict,
  usage_position bigint not null,
  overage_segments_delta integer not null,
  customer_amount_micro_usd_delta bigint not null,
  created_at timestamptz not null default now(),
  constraint billing_invoice_run_entries_run_ledger_key
    unique (billing_invoice_run_id, billing_usage_ledger_id),
  constraint billing_invoice_run_entries_delta_positive check (
    overage_segments_delta > 0
    and customer_amount_micro_usd_delta > 0
    and usage_position > 0
  )
);

create index billing_invoice_run_entries_period_idx
  on private.billing_invoice_run_entries (billing_period_id, usage_position);

create table private.billing_subscription_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subscription_id text not null,
  state text not null default 'ready',
  requested_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_subscription_cancellation_workspace_subscription_key
    unique (workspace_id, subscription_id),
  constraint billing_subscription_cancellation_state_valid check (
    state in ('ready', 'completed')
  ),
  constraint billing_subscription_cancellation_shape check (
    (state = 'ready' and completed_at is null)
    or (state = 'completed' and completed_at is not null)
  ),
  constraint billing_subscription_cancellation_subscription_not_blank check (
    char_length(btrim(subscription_id)) > 0
  )
);

create trigger billing_subscription_cancellation_touch_updated_at
before update on private.billing_subscription_cancellation_requests
for each row execute function private.touch_updated_at();

create table private.provider_fixed_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  billing_period_id uuid references public.billing_periods (id) on delete restrict,
  cost_kind text not null,
  provider_cost_micro_usd bigint not null,
  provider_currency text not null default 'USD',
  provider_reference text,
  incurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint provider_fixed_cost_ledger_cost_nonnegative check (
    provider_cost_micro_usd >= 0
  ),
  constraint provider_fixed_cost_ledger_values_not_blank check (
    char_length(btrim(cost_kind)) > 0
    and char_length(btrim(provider_currency)) > 0
    and (
      provider_reference is null
      or char_length(btrim(provider_reference)) > 0
    )
  )
);

create index provider_fixed_cost_ledger_workspace_period_idx
  on private.provider_fixed_cost_ledger (workspace_id, billing_period_id, incurred_at);

create table private.operation_rate_limit_policies (
  operation text primary key,
  max_attempts integer not null,
  window_seconds integer not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint operation_rate_limit_policies_values_valid check (
    char_length(btrim(operation)) > 0
    and max_attempts > 0
    and window_seconds > 0
  )
);

insert into private.operation_rate_limit_policies (
  operation,
  max_attempts,
  window_seconds
)
values
  ('workspace_setup', 5, 3600),
  ('number_search', 30, 600),
  ('number_purchase', 5, 86400),
  ('number_release', 5, 86400),
  ('billing_setup_intent', 5, 3600);

create table private.operation_rate_limit_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operation text not null references private.operation_rate_limit_policies (operation),
  request_key text not null,
  attempted_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint operation_rate_limit_attempts_request_not_blank check (
    char_length(btrim(request_key)) > 0
  ),
  constraint operation_rate_limit_attempts_workspace_request_key
    unique (workspace_id, operation, request_key)
);

create index operation_rate_limit_attempts_window_idx
  on private.operation_rate_limit_attempts (workspace_id, operation, attempted_at);

create or replace function private.workspace_allows_number_onboarding(
  p_workspace_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      select
        account.terminal_at is null
        and account.subscription_status in (
          'not_started', 'setup_required', 'active', 'cancellation_scheduled'
        )
      from private.workspace_billing_accounts as account
      where account.workspace_id = p_workspace_id
    ),
    false
  );
$$;

create or replace function private.workspace_can_send_at(
  p_workspace_id uuid,
  p_at timestamptz
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      select
        control.messaging_enabled
        and account.subscription_status in ('active', 'cancellation_scheduled')
        and account.terminal_at is null
        and account.stripe_subscription_id is not null
        and account.current_period_start is not null
        and account.current_period_end is not null
        and p_at >= account.current_period_start
        and p_at < account.current_period_end
        and period.status = 'open'
        and not period.is_provisional
        and period.period_start = account.current_period_start
        and period.period_end = account.current_period_end
        and detail.subscription_id = account.stripe_subscription_id
      from private.workspace_messaging_controls as control
      join private.workspace_billing_accounts as account
        on account.workspace_id = control.workspace_id
      join public.billing_periods as period
        on period.workspace_id = control.workspace_id
        and period.status = 'open'
      join private.billing_period_provider_details as detail
        on detail.billing_period_id = period.id
        and detail.workspace_id = control.workspace_id
      where control.workspace_id = p_workspace_id
    ),
    false
  );
$$;

create or replace function private.consume_operation_rate_limit(
  p_workspace_id uuid,
  p_operation text,
  p_request_key text,
  p_requested_at timestamptz
)
returns table (
  allowed boolean,
  replayed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_oldest timestamptz;
  v_policy private.operation_rate_limit_policies;
  v_request_key text := pg_catalog.btrim(coalesce(p_request_key, ''));
begin
  if v_request_key = '' or p_requested_at is null then
    raise exception using errcode = '22023', message = 'Invalid rate limit request.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select policy.*
  into v_policy
  from private.operation_rate_limit_policies as policy
  where policy.operation = p_operation
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Unknown rate-limited operation.';
  end if;

  if exists (
    select 1
    from private.operation_rate_limit_attempts as attempt
    where attempt.workspace_id = p_workspace_id
      and attempt.operation = p_operation
      and attempt.request_key = v_request_key
  ) then
    return query select true, true, 0;
    return;
  end if;

  if not v_policy.is_enabled then
    return query select true, false, 0;
    return;
  end if;

  select count(*)::integer, min(attempt.attempted_at)
  into v_count, v_oldest
  from private.operation_rate_limit_attempts as attempt
  where attempt.workspace_id = p_workspace_id
    and attempt.operation = p_operation
    and attempt.attempted_at > p_requested_at
      - pg_catalog.make_interval(secs => v_policy.window_seconds);

  if v_count >= v_policy.max_attempts then
    return query select
      false,
      false,
      greatest(
        1,
        pg_catalog.ceil(
          extract(epoch from (
            v_oldest + pg_catalog.make_interval(secs => v_policy.window_seconds)
            - p_requested_at
          ))
        )::integer
      );
    return;
  end if;

  insert into private.operation_rate_limit_attempts (
    workspace_id,
    operation,
    request_key,
    attempted_at
  )
  values (p_workspace_id, p_operation, v_request_key, p_requested_at);

  return query select true, false, 0;
end;
$$;

create or replace function private.enforce_operation_rate_limit_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_operation text;
  v_request_key text;
begin
  if tg_table_name = 'workspace_provider_setup_operations' then
    v_operation := 'workspace_setup';
    v_request_key := new.operation_id::text;
    if not private.workspace_allows_number_onboarding(new.workspace_id) then
      raise exception using errcode = '55000', message = 'Number setup is unavailable.';
    end if;
  elsif tg_table_name = 'phone_number_operations' then
    v_operation := case new.operation_type
      when 'purchase' then 'number_purchase'
      else 'number_release'
    end;
    v_request_key := new.operation_id::text;
    if new.operation_type = 'purchase'
      and not private.workspace_allows_number_onboarding(new.workspace_id)
    then
      raise exception using errcode = '55000', message = 'Number setup is unavailable.';
    end if;
  else
    raise exception using errcode = '22023', message = 'Unsupported rate limit trigger.';
  end if;

  select result.allowed
  into v_allowed
  from private.consume_operation_rate_limit(
    new.workspace_id,
    v_operation,
    v_request_key,
    coalesce(new.created_at, pg_catalog.now())
  ) as result;

  if not coalesce(v_allowed, false) then
    raise exception using errcode = '54000', message = 'Operation rate limit reached.';
  end if;

  return new;
end;
$$;

create trigger workspace_provider_setup_rate_limit
before insert on private.workspace_provider_setup_operations
for each row execute function private.enforce_operation_rate_limit_on_insert();

create trigger phone_number_operations_rate_limit
before insert on private.phone_number_operations
for each row execute function private.enforce_operation_rate_limit_on_insert();

create or replace function public.messaging_claim_number_search(
  p_workspace_id uuid,
  p_request_id uuid,
  p_requested_at timestamptz
)
returns table (
  allowed boolean,
  replayed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.workspace_allows_number_onboarding(p_workspace_id) then
    return query select false, false, 0;
    return;
  end if;

  return query
  select result.allowed, result.replayed, result.retry_after_seconds
  from private.consume_operation_rate_limit(
    p_workspace_id,
    'number_search',
    p_request_id::text,
    p_requested_at
  ) as result;
end;
$$;

create or replace function public.billing_claim_payment_setup_attempt(
  p_workspace_id uuid,
  p_request_id text,
  p_requested_at timestamptz
)
returns table (
  allowed boolean,
  replayed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.workspace_billing_accounts as account
    where account.workspace_id = p_workspace_id
      and account.stripe_subscription_id is null
      and account.terminal_at is null
      and account.subscription_status in ('not_started', 'setup_required')
  ) then
    return query select false, false, 0;
    return;
  end if;

  return query
  select result.allowed, result.replayed, result.retry_after_seconds
  from private.consume_operation_rate_limit(
    p_workspace_id,
    'billing_setup_intent',
    p_request_id,
    p_requested_at
  ) as result;
end;
$$;

create or replace function private.initialize_workspace_billing_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.workspace_billing_accounts (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;
  return new;
end;
$$;

create or replace function private.require_billing_webhook_claim(
  p_event_id text,
  p_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.btrim(coalesce(p_event_id, '')) = '' or p_claim_token is null then
    raise exception using errcode = '22023', message = 'Invalid billing event claim.';
  end if;

  perform 1
  from private.billing_webhook_events as event
  where event.event_id = p_event_id
    and event.event_status = 'processing'
    and event.claim_token = p_claim_token
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Billing event claim is no longer valid.';
  end if;
end;
$$;

create or replace function public.billing_get_workspace_account(
  p_workspace_id uuid
)
returns table (
  workspace_id uuid,
  customer_id text,
  default_payment_method_id text,
  subscription_id text,
  subscription_status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  monthly_price_cents integer,
  subscription_price_id text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    account.workspace_id,
    account.stripe_customer_id,
    account.default_payment_method_id,
    account.stripe_subscription_id,
    account.subscription_status,
    account.current_period_start,
    account.current_period_end,
    coalesce(period.monthly_price_cents_snapshot, plan.monthly_price_cents),
    account.subscription_price_id
  from private.workspace_billing_accounts as account
  join public.workspaces as workspace on workspace.id = account.workspace_id
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  left join public.billing_periods as period
    on period.workspace_id = account.workspace_id
    and period.status = 'open'
  where account.workspace_id = p_workspace_id;
$$;

create or replace function public.billing_record_customer(
  p_workspace_id uuid,
  p_customer_id text,
  p_recorded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_customer_id text := pg_catalog.btrim(coalesce(p_customer_id, ''));
begin
  if v_customer_id = '' or p_recorded_at is null then
    raise exception using errcode = '22023', message = 'Invalid billing customer.';
  end if;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace billing account not found.';
  end if;

  if v_account.stripe_customer_id is not null
    and v_account.stripe_customer_id <> v_customer_id
  then
    raise exception using errcode = '23514', message = 'Billing customer is immutable.';
  end if;

  update private.workspace_billing_accounts
  set
    stripe_customer_id = v_customer_id,
    payment_method_status = case
      when payment_method_status = 'missing' then 'setup_required'
      else payment_method_status
    end,
    subscription_status = case
      when subscription_status = 'not_started' then 'setup_required'
      else subscription_status
    end
  where workspace_id = p_workspace_id;
end;
$$;

create or replace function public.billing_record_setup_intent(
  p_workspace_id uuid,
  p_customer_id text,
  p_setup_intent_id text,
  p_recorded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_setup_intent_id text := pg_catalog.btrim(coalesce(p_setup_intent_id, ''));
begin
  if pg_catalog.btrim(coalesce(p_customer_id, '')) = ''
    or v_setup_intent_id = ''
    or p_recorded_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid payment setup record.';
  end if;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if not found or v_account.stripe_customer_id is distinct from p_customer_id then
    raise exception using errcode = '23514', message = 'Billing customer correlation failed.';
  end if;

  if v_account.stripe_subscription_id is not null
    or v_account.subscription_status not in ('not_started', 'setup_required')
  then
    raise exception using errcode = '55000', message = 'Payment setup is unavailable.';
  end if;

  insert into private.billing_setup_intents (
    setup_intent_id,
    workspace_id,
    customer_id,
    recorded_at
  )
  values (
    v_setup_intent_id,
    p_workspace_id,
    p_customer_id,
    p_recorded_at
  )
  on conflict (setup_intent_id) do update
  set recorded_at = least(
    private.billing_setup_intents.recorded_at,
    excluded.recorded_at
  )
  where private.billing_setup_intents.workspace_id = excluded.workspace_id
    and private.billing_setup_intents.customer_id = excluded.customer_id;

  if not found then
    raise exception using errcode = '23514', message = 'Payment setup correlation failed.';
  end if;

  update private.workspace_billing_accounts
  set
    latest_setup_intent_id = v_setup_intent_id,
    payment_method_status = case
      when payment_method_status = 'saved' then 'saved'
      else 'setup_required'
    end,
    subscription_status = 'setup_required'
  where workspace_id = p_workspace_id;
end;
$$;

create or replace function public.billing_record_subscription(
  p_workspace_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_price_id text,
  p_latest_invoice_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_status text,
  p_recorded_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_price_id text := pg_catalog.btrim(coalesce(p_price_id, ''));
  v_subscription_id text := pg_catalog.btrim(coalesce(p_subscription_id, ''));
begin
  if pg_catalog.btrim(coalesce(p_customer_id, '')) = ''
    or v_subscription_id = ''
    or v_price_id = ''
    or p_status <> 'active'
    or p_period_start is null
    or p_period_end is null
    or p_period_end <= p_period_start
    or p_recorded_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid active subscription.';
  end if;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if not found
    or v_account.stripe_customer_id is distinct from p_customer_id
    or v_account.default_payment_method_id is null
    or v_account.payment_method_status <> 'saved'
    or v_account.terminal_at is not null
    or (
      v_account.stripe_subscription_id is not null
      and v_account.stripe_subscription_id <> v_subscription_id
    )
    or (
      v_account.subscription_price_id is not null
      and v_account.subscription_price_id <> v_price_id
    )
  then
    raise exception using errcode = '23514', message = 'Subscription correlation failed.';
  end if;

  update private.workspace_billing_accounts
  set
    stripe_subscription_id = v_subscription_id,
    subscription_price_id = v_price_id,
    subscription_status = 'active',
    current_period_start = p_period_start,
    current_period_end = p_period_end,
    latest_invoice_id = nullif(pg_catalog.btrim(coalesce(p_latest_invoice_id, '')), ''),
    cancel_at_period_end = false,
    grace_ends_at = null,
    terminal_at = null
  where workspace_id = p_workspace_id;

  perform private.activate_exact_billing_period(
    p_workspace_id,
    v_subscription_id,
    p_period_start,
    p_period_end,
    p_recorded_at
  );

  update private.workspace_messaging_controls
  set messaging_enabled = true,
      suspension_reason = null
  where workspace_id = p_workspace_id;
end;
$$;

create or replace function public.billing_claim_webhook_event(
  p_event_created_at timestamptz,
  p_event_id text,
  p_event_type text,
  p_received_at timestamptz
)
returns table (
  event_id text,
  claim_state text,
  claim_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event private.billing_webhook_events;
  v_event_id text := pg_catalog.btrim(coalesce(p_event_id, ''));
  v_event_type text := pg_catalog.btrim(coalesce(p_event_type, ''));
  v_token uuid;
begin
  if v_event_id = ''
    or v_event_type = ''
    or p_event_created_at is null
    or p_received_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid billing event.';
  end if;

  select event.*
  into v_event
  from private.billing_webhook_events as event
  where event.event_id = v_event_id
  for update;

  if found then
    if v_event.event_type <> v_event_type
      or v_event.event_created_at <> p_event_created_at
    then
      raise exception using errcode = '23514', message = 'Billing event correlation failed.';
    end if;

    if v_event.event_status = 'completed' then
      return query select v_event_id, 'completed'::text, null::uuid;
      return;
    end if;

    if v_event.event_status = 'processing'
      and v_event.claimed_at > p_received_at - interval '5 minutes'
    then
      update private.billing_webhook_events
      set last_received_at = greatest(last_received_at, p_received_at)
      where private.billing_webhook_events.event_id = v_event_id;
      return query select v_event_id, 'busy'::text, null::uuid;
      return;
    end if;

    v_token := gen_random_uuid();
    update private.billing_webhook_events
    set
      event_status = 'processing',
      claim_token = v_token,
      claimed_at = p_received_at,
      last_received_at = greatest(last_received_at, p_received_at),
      attempt_count = attempt_count + 1,
      outcome = null,
      failure_code = null,
      provider_error_code = null,
      provider_error_message = null,
      processed_at = null
    where private.billing_webhook_events.event_id = v_event_id;
  else
    v_token := gen_random_uuid();
    insert into private.billing_webhook_events (
      event_id,
      event_type,
      event_created_at,
      first_received_at,
      last_received_at,
      claim_token,
      claimed_at
    )
    values (
      v_event_id,
      v_event_type,
      p_event_created_at,
      p_received_at,
      p_received_at,
      v_token,
      p_received_at
    );
  end if;

  return query select v_event_id, 'claimed'::text, v_token;
end;
$$;

create or replace function public.billing_complete_webhook_event(
  p_claim_token uuid,
  p_event_id text,
  p_outcome text,
  p_processed_at timestamptz
)
returns table (
  event_id text,
  event_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('ignored', 'processed') or p_processed_at is null then
    raise exception using errcode = '22023', message = 'Invalid billing event completion.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  update private.billing_webhook_events as event
  set
    event_status = 'completed',
    outcome = p_outcome,
    processed_at = p_processed_at,
    failure_code = null,
    provider_error_code = null,
    provider_error_message = null
  where event.event_id = p_event_id;

  return query select p_event_id, 'completed'::text;
end;
$$;

create or replace function public.billing_fail_webhook_event(
  p_claim_token uuid,
  p_event_id text,
  p_failed_at timestamptz,
  p_failure_code text,
  p_provider_code text,
  p_provider_message text
)
returns table (
  event_id text,
  event_status text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_failed_at is null or pg_catalog.btrim(coalesce(p_failure_code, '')) = '' then
    raise exception using errcode = '22023', message = 'Invalid billing event failure.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  update private.billing_webhook_events as event
  set
    event_status = 'failed',
    processed_at = p_failed_at,
    failure_code = pg_catalog.left(pg_catalog.btrim(p_failure_code), 200),
    provider_error_code = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_provider_code, '')), 200), ''),
    provider_error_message = nullif(pg_catalog.left(pg_catalog.btrim(coalesce(p_provider_message, '')), 2000), '')
  where event.event_id = p_event_id;

  return query select p_event_id, 'failed'::text;
end;
$$;

create or replace function public.billing_apply_payment_method_event(
  p_claim_token uuid,
  p_customer_id text,
  p_event_id text,
  p_occurred_at timestamptz,
  p_payment_method_id text,
  p_setup_intent_id text,
  p_workspace_id_hint uuid
)
returns table (
  event_id text,
  customer_id text,
  payment_method_id text,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
begin
  if pg_catalog.btrim(coalesce(p_customer_id, '')) = ''
    or pg_catalog.btrim(coalesce(p_payment_method_id, '')) = ''
    or pg_catalog.btrim(coalesce(p_setup_intent_id, '')) = ''
    or p_occurred_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid payment method event.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.stripe_customer_id = p_customer_id
  for update;

  if not found
    or (p_workspace_id_hint is not null and v_account.workspace_id <> p_workspace_id_hint)
    or v_account.terminal_at is not null
    or not exists (
      select 1
      from private.billing_setup_intents as setup
      where setup.setup_intent_id = p_setup_intent_id
        and setup.workspace_id = v_account.workspace_id
        and setup.customer_id = p_customer_id
    )
  then
    raise exception using errcode = '23514', message = 'Payment method correlation failed.';
  end if;

  if v_account.last_payment_method_event_at is not null
    and p_occurred_at < v_account.last_payment_method_event_at
  then
    return query select
      p_event_id,
      p_customer_id,
      pg_catalog.btrim(p_payment_method_id),
      v_account.workspace_id;
    return;
  end if;

  update private.workspace_billing_accounts as account
  set
    default_payment_method_id = pg_catalog.btrim(p_payment_method_id),
    payment_method_status = 'saved',
    last_payment_method_event_at = p_occurred_at,
    last_payment_method_event_id = p_event_id,
    subscription_status = case
      when account.subscription_status = 'not_started' then 'setup_required'
      else account.subscription_status
    end
  where account.workspace_id = v_account.workspace_id;

  update private.billing_setup_intents as intent
  set
    applied_event_id = p_event_id,
    applied_at = p_occurred_at
  where intent.setup_intent_id = p_setup_intent_id
    and intent.workspace_id = v_account.workspace_id;

  return query select
    p_event_id,
    p_customer_id,
    pg_catalog.btrim(p_payment_method_id),
    v_account.workspace_id;
end;
$$;

create or replace function public.billing_prepare_additional_usage_invoice_run(
  p_billing_reason text,
  p_claim_token uuid,
  p_customer_id text,
  p_event_id text,
  p_invoice_created_at timestamptz,
  p_invoice_id text,
  p_invoice_period_end timestamptz,
  p_invoice_period_start timestamptz,
  p_prepared_at timestamptz,
  p_subscription_id text
)
returns table (
  event_id text,
  customer_id text,
  invoice_id text,
  run_state text,
  amount_micro_usd bigint,
  billing_invoice_run_id uuid,
  ledger_entry_count integer,
  source_period_ids uuid[],
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_amount bigint := 0;
  v_candidate record;
  v_count integer := 0;
  v_period_ids uuid[] := '{}';
  v_run private.billing_invoice_runs;
  v_segments integer := 0;
begin
  if p_billing_reason not in ('subscription_cycle', 'subscription')
    or pg_catalog.btrim(coalesce(p_customer_id, '')) = ''
    or pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
    or pg_catalog.btrim(coalesce(p_invoice_id, '')) = ''
    or p_invoice_created_at is null
    or p_invoice_period_start is null
    or p_invoice_period_end is null
    or p_invoice_period_end <= p_invoice_period_start
    or p_prepared_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid period invoice.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.stripe_customer_id = p_customer_id
    and account.stripe_subscription_id = p_subscription_id
  for update;

  if not found then
    raise exception using errcode = '23514', message = 'Invoice workspace correlation failed.';
  end if;

  select run.*
  into v_run
  from private.billing_invoice_runs as run
  where run.stripe_invoice_id = p_invoice_id
  for update;

  if found then
    if v_run.workspace_id <> v_account.workspace_id
      or v_run.stripe_customer_id <> p_customer_id
      or v_run.stripe_subscription_id <> p_subscription_id
      or v_run.invoice_period_start <> p_invoice_period_start
      or v_run.invoice_period_end <> p_invoice_period_end
    then
      raise exception using errcode = '23514', message = 'Invoice run correlation failed.';
    end if;

    if v_run.run_state in ('completed', 'no_usage') then
      return query select
        p_event_id,
        p_customer_id,
        p_invoice_id,
        v_run.run_state,
        null::bigint,
        null::uuid,
        null::integer,
        null::uuid[],
        null::uuid;
      return;
    end if;

    return query select
      p_event_id,
      p_customer_id,
      p_invoice_id,
      'ready'::text,
      v_run.amount_micro_usd,
      v_run.id,
      v_run.ledger_entry_count,
      v_run.source_period_ids,
      v_run.workspace_id;
    return;
  end if;

  -- The invoice period represents the usage window that has just ended. Lock
  -- every eligible original period before reading deltas so reconciliation and
  -- invoice preparation serialize on the same period rows.
  perform 1
  from public.billing_periods as period
  where period.workspace_id = v_account.workspace_id
    and period.period_end <= p_invoice_period_end
    and period.period_end <= p_invoice_created_at
  order by period.id
  for update;

  update public.billing_periods as period
  set status = 'closed'
  where period.workspace_id = v_account.workspace_id
    and period.status = 'open'
    and period.period_end <= p_invoice_period_end
    and period.period_end <= p_invoice_created_at;

  insert into private.billing_invoice_runs (
    workspace_id,
    stripe_invoice_id,
    stripe_customer_id,
    stripe_subscription_id,
    billing_event_id,
    billing_reason,
    invoice_created_at,
    invoice_period_start,
    invoice_period_end,
    idempotency_key,
    run_state,
    prepared_at,
    completed_at
  )
  values (
    v_account.workspace_id,
    pg_catalog.btrim(p_invoice_id),
    pg_catalog.btrim(p_customer_id),
    pg_catalog.btrim(p_subscription_id),
    pg_catalog.btrim(p_event_id),
    p_billing_reason,
    p_invoice_created_at,
    p_invoice_period_start,
    p_invoice_period_end,
    'additional-sms-usage:' || v_account.workspace_id::text || ':' || pg_catalog.btrim(p_invoice_id),
    'no_usage',
    p_prepared_at,
    p_prepared_at
  )
  returning * into v_run;

  for v_candidate in
    select
      ledger.id as ledger_id,
      ledger.billing_period_id,
      ledger.message_id,
      ledger.usage_position,
      ledger.overage_segments
        - ledger.billed_overage_segments
        - ledger.reserved_overage_segments as segment_delta,
      ledger.customer_billable_amount_micro_usd
        - ledger.billed_customer_amount_micro_usd
        - ledger.reserved_customer_amount_micro_usd as amount_delta
    from private.billing_usage_ledger as ledger
    join public.billing_periods as period on period.id = ledger.billing_period_id
    where ledger.workspace_id = v_account.workspace_id
      and ledger.direction = 'outbound'
      and ledger.num_segments is not null
      and ledger.usage_position is not null
      and ledger.reserved_billing_invoice_run_id is null
      and ledger.overage_segments > ledger.billed_overage_segments
      and ledger.customer_billable_amount_micro_usd
        > ledger.billed_customer_amount_micro_usd
      and period.status = 'closed'
      and period.period_end <= p_invoice_period_end
      and period.period_end <= p_invoice_created_at
    order by period.period_start, ledger.usage_position, ledger.id
    for update of ledger
  loop
    if v_candidate.segment_delta <= 0 or v_candidate.amount_delta <= 0 then
      continue;
    end if;

    insert into private.billing_invoice_run_entries (
      billing_invoice_run_id,
      billing_usage_ledger_id,
      workspace_id,
      billing_period_id,
      message_id,
      usage_position,
      overage_segments_delta,
      customer_amount_micro_usd_delta
    )
    values (
      v_run.id,
      v_candidate.ledger_id,
      v_account.workspace_id,
      v_candidate.billing_period_id,
      v_candidate.message_id,
      v_candidate.usage_position,
      v_candidate.segment_delta,
      v_candidate.amount_delta
    );

    update private.billing_usage_ledger as ledger
    set
      reserved_overage_segments = v_candidate.segment_delta,
      reserved_customer_amount_micro_usd = v_candidate.amount_delta,
      reserved_billing_invoice_run_id = v_run.id
    where ledger.id = v_candidate.ledger_id;

    v_segments := v_segments + v_candidate.segment_delta;
    v_amount := v_amount + v_candidate.amount_delta;
    v_count := v_count + 1;
    if not v_candidate.billing_period_id = any(v_period_ids) then
      v_period_ids := pg_catalog.array_append(v_period_ids, v_candidate.billing_period_id);
    end if;
  end loop;

  if v_count = 0 then
    update private.billing_invoice_runs as run
    set completed_at = p_prepared_at
    where run.id = v_run.id
    returning * into v_run;

    return query select
      p_event_id,
      p_customer_id,
      p_invoice_id,
      'no_usage'::text,
      null::bigint,
      null::uuid,
      null::integer,
      null::uuid[],
      null::uuid;
    return;
  end if;

  update private.billing_invoice_runs as run
  set
    run_state = 'ready',
    additional_segments = v_segments,
    amount_micro_usd = v_amount,
    ledger_entry_count = v_count,
    source_period_ids = (
      select pg_catalog.array_agg(period_id order by period_id)
      from pg_catalog.unnest(v_period_ids) as period_id
    ),
    completed_at = null
  where run.id = v_run.id
  returning * into v_run;

  return query select
    p_event_id,
    p_customer_id,
    p_invoice_id,
    'ready'::text,
    v_run.amount_micro_usd,
    v_run.id,
    v_run.ledger_entry_count,
    v_run.source_period_ids,
    v_run.workspace_id;
end;
$$;

create or replace function public.billing_complete_additional_usage_invoice_run(
  p_amount_cents integer,
  p_billing_invoice_run_id uuid,
  p_claim_token uuid,
  p_completed_at timestamptz,
  p_event_id text,
  p_invoice_id text,
  p_invoice_item_id text,
  p_workspace_id uuid
)
returns table (
  billing_invoice_run_id uuid,
  event_id text,
  invoice_id text,
  invoice_item_id text,
  workspace_id uuid,
  run_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry record;
  v_run private.billing_invoice_runs;
begin
  if p_amount_cents is null
    or p_amount_cents < 1
    or p_completed_at is null
    or pg_catalog.btrim(coalesce(p_invoice_item_id, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Invalid invoice run completion.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  select run.*
  into v_run
  from private.billing_invoice_runs as run
  where run.id = p_billing_invoice_run_id
  for update;

  if not found
    or v_run.workspace_id <> p_workspace_id
    or v_run.stripe_invoice_id <> p_invoice_id
    or v_run.run_state not in ('ready', 'completed')
    or pg_catalog.floor((v_run.amount_micro_usd + 5000)::numeric / 10000)::integer
      <> p_amount_cents
  then
    raise exception using errcode = '23514', message = 'Invoice run completion correlation failed.';
  end if;

  if v_run.run_state = 'completed' then
    if v_run.stripe_invoice_item_id <> p_invoice_item_id
      or v_run.amount_cents <> p_amount_cents
    then
      raise exception using errcode = '23514', message = 'Completed invoice run is immutable.';
    end if;

    return query select
      v_run.id,
      p_event_id,
      v_run.stripe_invoice_id,
      v_run.stripe_invoice_item_id,
      v_run.workspace_id,
      'completed'::text;
    return;
  end if;

  for v_entry in
    select entry.*
    from private.billing_invoice_run_entries as entry
    where entry.billing_invoice_run_id = v_run.id
    order by entry.billing_usage_ledger_id
  loop
    perform 1
    from private.billing_usage_ledger as ledger
    where ledger.id = v_entry.billing_usage_ledger_id
      and ledger.reserved_billing_invoice_run_id = v_run.id
      and ledger.reserved_overage_segments = v_entry.overage_segments_delta
      and ledger.reserved_customer_amount_micro_usd =
        v_entry.customer_amount_micro_usd_delta
    for update;

    if not found then
      raise exception using errcode = '23514', message = 'Reserved invoice delta is inconsistent.';
    end if;

    update private.billing_usage_ledger as ledger
    set
      billed_overage_segments = billed_overage_segments
        + v_entry.overage_segments_delta,
      billed_customer_amount_micro_usd = billed_customer_amount_micro_usd
        + v_entry.customer_amount_micro_usd_delta,
      reserved_overage_segments = 0,
      reserved_customer_amount_micro_usd = 0,
      reserved_billing_invoice_run_id = null
    where ledger.id = v_entry.billing_usage_ledger_id;
  end loop;

  update private.billing_invoice_runs as run
  set
    run_state = 'completed',
    stripe_invoice_item_id = pg_catalog.btrim(p_invoice_item_id),
    amount_cents = p_amount_cents,
    completed_at = p_completed_at
  where run.id = v_run.id
  returning * into v_run;

  return query select
    v_run.id,
    p_event_id,
    v_run.stripe_invoice_id,
    v_run.stripe_invoice_item_id,
    v_run.workspace_id,
    'completed'::text;
end;
$$;

create or replace function private.resolve_billing_workspace(
  p_customer_id text,
  p_subscription_id text,
  p_workspace_id_hint uuid
)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select account.workspace_id
  into v_workspace_id
  from private.workspace_billing_accounts as account
  where account.stripe_customer_id = p_customer_id
    and (
      p_subscription_id is null
      or account.stripe_subscription_id = p_subscription_id
    );

  if v_workspace_id is null
    or (p_workspace_id_hint is not null and p_workspace_id_hint <> v_workspace_id)
  then
    raise exception using errcode = '23514', message = 'Billing workspace correlation failed.';
  end if;

  return v_workspace_id;
end;
$$;

create or replace function public.billing_apply_lifecycle_event(
  p_allow_terminal_reactivation boolean,
  p_cancel_at_period_end boolean,
  p_claim_token uuid,
  p_customer_id text,
  p_event_id text,
  p_event_kind text,
  p_event_occurred_at timestamptz,
  p_grace_ends_at timestamptz,
  p_invoice_id text,
  p_period_end timestamptz,
  p_period_start timestamptz,
  p_status text,
  p_subscription_id text,
  p_workspace_id_hint uuid
)
returns table (
  event_id text,
  workspace_id uuid,
  subscription_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_can_message boolean := false;
  v_effective_grace_end timestamptz;
  v_invoice_period_id uuid;
  v_next_status text;
  v_workspace_id uuid;
begin
  if p_allow_terminal_reactivation is distinct from false
    or p_event_kind not in (
      'invoice_paid',
      'invoice_payment_failed',
      'subscription_changed',
      'subscription_ended'
    )
    or pg_catalog.btrim(coalesce(p_customer_id, '')) = ''
    or p_event_occurred_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid subscription lifecycle event.';
  end if;

  if p_event_kind <> 'subscription_ended'
    and pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Subscription ID is required.';
  end if;

  perform private.require_billing_webhook_claim(p_event_id, p_claim_token);

  v_workspace_id := private.resolve_billing_workspace(
    p_customer_id,
    p_subscription_id,
    p_workspace_id_hint
  );

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = v_workspace_id
  for update;

  -- Provider webhooks may arrive out of order. Older notifications and any
  -- attempted automatic resurrection after a terminal event are harmless.
  if (v_account.last_lifecycle_event_at is not null
      and p_event_occurred_at < v_account.last_lifecycle_event_at)
    or (
      v_account.terminal_at is not null
      and p_event_kind <> 'subscription_ended'
    )
  then
    return query select p_event_id, v_workspace_id, p_subscription_id;
    return;
  end if;

  if p_event_kind in ('invoice_paid', 'invoice_payment_failed') then
    if pg_catalog.btrim(coalesce(p_invoice_id, '')) = ''
      or p_period_start is null
      or p_period_end is null
      or p_period_end <= p_period_start
    then
      raise exception using
        errcode = '22023',
        message = 'Invoice lifecycle period is required.';
    end if;

    select period.id
    into v_invoice_period_id
    from public.billing_periods as period
    join private.billing_period_provider_details as detail
      on detail.billing_period_id = period.id
    where period.workspace_id = v_workspace_id
      and period.period_start = p_period_start
      and period.period_end = p_period_end
      and detail.subscription_id = p_subscription_id
    for update of period;

    if v_invoice_period_id is null then
      raise exception using
        errcode = '23514',
        message = 'Invoice period correlation failed.';
    end if;

    if p_period_end <= p_event_occurred_at then
      update public.billing_periods
      set status = 'closed'
      where id = v_invoice_period_id;
    end if;
  end if;

  if p_event_kind = 'subscription_ended'
    or (p_event_kind = 'subscription_changed' and p_status = 'canceled')
  then
    if pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
      or v_account.stripe_subscription_id is distinct from p_subscription_id
    then
      raise exception using errcode = '23514', message = 'Ended subscription correlation failed.';
    end if;

    v_effective_grace_end := greatest(
      coalesce(p_grace_ends_at, p_event_occurred_at + interval '7 days'),
      p_event_occurred_at + interval '7 days'
    );

    update private.workspace_billing_accounts as billing_account
    set
      subscription_status = 'grace',
      cancel_at_period_end = false,
      grace_ends_at = v_effective_grace_end,
      terminal_at = coalesce(billing_account.terminal_at, p_event_occurred_at),
      last_lifecycle_event_at = greatest(
        coalesce(billing_account.last_lifecycle_event_at, p_event_occurred_at),
        p_event_occurred_at
      ),
      last_lifecycle_event_id = p_event_id
    where billing_account.workspace_id = v_workspace_id;

    update private.workspace_messaging_controls as control
    set
      messaging_enabled = false,
      suspension_reason = 'subscription_ended'
    where control.workspace_id = v_workspace_id;

    return query select p_event_id, v_workspace_id, p_subscription_id;
    return;
  end if;

  if v_account.stripe_subscription_id is distinct from p_subscription_id then
    raise exception using errcode = '23514', message = 'Subscription correlation failed.';
  end if;

  if p_event_kind = 'invoice_paid' then
    v_next_status := case
      when v_account.cancel_at_period_end then 'cancellation_scheduled'
      else 'active'
    end;
  elsif p_event_kind = 'invoice_payment_failed' then
    v_next_status := 'past_due';
  else
    if p_status = 'active' then
      v_next_status := case
        when coalesce(p_cancel_at_period_end, false) then 'cancellation_scheduled'
        else 'active'
      end;
    elsif p_status in ('incomplete', 'past_due', 'canceled') then
      v_next_status := p_status;
    else
      raise exception using errcode = '22023', message = 'Unsupported subscription status.';
    end if;
  end if;

  if v_next_status in ('active', 'cancellation_scheduled')
    and p_event_kind = 'subscription_changed'
  then
    if p_period_start is null
      or p_period_end is null
      or p_period_end <= p_period_start
    then
      raise exception using errcode = '22023', message = 'Active subscription period is required.';
    end if;

    perform private.activate_exact_billing_period(
      v_workspace_id,
      p_subscription_id,
      p_period_start,
      p_period_end,
      p_event_occurred_at
    );
  end if;

  update private.workspace_billing_accounts as billing_account
  set
    subscription_status = v_next_status,
    current_period_start = case
      when p_event_kind = 'subscription_changed'
        and v_next_status in ('active', 'cancellation_scheduled')
        then p_period_start
      else current_period_start
    end,
    current_period_end = case
      when p_event_kind = 'subscription_changed'
        and v_next_status in ('active', 'cancellation_scheduled')
        then p_period_end
      else current_period_end
    end,
    latest_invoice_id = coalesce(
      nullif(pg_catalog.btrim(coalesce(p_invoice_id, '')), ''),
      billing_account.latest_invoice_id
    ),
    cancel_at_period_end = v_next_status = 'cancellation_scheduled',
    last_lifecycle_event_at = p_event_occurred_at,
    last_lifecycle_event_id = p_event_id
  where billing_account.workspace_id = v_workspace_id;

  v_can_message := v_next_status in ('active', 'cancellation_scheduled')
    and exists (
      select 1
      from public.billing_periods as period
      join private.billing_period_provider_details as detail
        on detail.billing_period_id = period.id
      where period.workspace_id = v_workspace_id
        and period.status = 'open'
        and not period.is_provisional
        and detail.subscription_id = p_subscription_id
        and p_event_occurred_at >= period.period_start
        and p_event_occurred_at < period.period_end
    );

  update private.workspace_messaging_controls as control
  set
    messaging_enabled = v_can_message,
    suspension_reason = case
      when v_can_message then null
      when v_next_status in ('active', 'cancellation_scheduled')
        then 'billing_period_rollover_pending'
      when v_next_status = 'past_due' then 'payment_required'
      when v_next_status = 'incomplete' then 'subscription_incomplete'
      else 'subscription_unavailable'
    end
  where control.workspace_id = v_workspace_id;

  return query select p_event_id, v_workspace_id, p_subscription_id;
end;
$$;

create or replace function public.billing_prepare_subscription_cancellation(
  p_requested_at timestamptz,
  p_workspace_id uuid
)
returns table (
  workspace_id uuid,
  request_state text,
  cancellation_request_id uuid,
  subscription_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_request private.billing_subscription_cancellation_requests;
begin
  if p_requested_at is null then
    raise exception using errcode = '22023', message = 'Cancellation timestamp is required.';
  end if;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if not found or v_account.stripe_subscription_id is null then
    raise exception using errcode = 'P0002', message = 'Active subscription not found.';
  end if;

  if v_account.subscription_status = 'cancellation_scheduled' then
    return query select p_workspace_id, 'completed'::text, null::uuid, null::text;
    return;
  end if;

  if v_account.subscription_status <> 'active' or v_account.terminal_at is not null then
    raise exception using errcode = '55000', message = 'Subscription cancellation is unavailable.';
  end if;

  insert into private.billing_subscription_cancellation_requests (
    workspace_id,
    subscription_id,
    requested_at
  )
  values (
    p_workspace_id,
    v_account.stripe_subscription_id,
    p_requested_at
  )
  on conflict on constraint billing_subscription_cancellation_workspace_subscription_key do update
  set requested_at = least(
    private.billing_subscription_cancellation_requests.requested_at,
    excluded.requested_at
  )
  returning * into v_request;

  if v_request.state = 'completed' then
    return query select p_workspace_id, 'completed'::text, null::uuid, null::text;
    return;
  end if;

  return query select
    p_workspace_id,
    'ready'::text,
    v_request.id,
    v_request.subscription_id;
end;
$$;

create or replace function public.billing_complete_subscription_cancellation(
  p_cancellation_request_id uuid,
  p_completed_at timestamptz,
  p_subscription_id text,
  p_workspace_id uuid
)
returns table (
  cancellation_request_id uuid,
  subscription_id text,
  workspace_id uuid,
  request_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_request private.billing_subscription_cancellation_requests;
begin
  if p_completed_at is null or pg_catalog.btrim(coalesce(p_subscription_id, '')) = '' then
    raise exception using errcode = '22023', message = 'Invalid cancellation completion.';
  end if;

  select request.*
  into v_request
  from private.billing_subscription_cancellation_requests as request
  where request.id = p_cancellation_request_id
    and request.workspace_id = p_workspace_id
    and request.subscription_id = p_subscription_id
  for update;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if v_request.id is null
    or v_account.workspace_id is null
    or v_account.stripe_subscription_id is distinct from p_subscription_id
    or v_account.terminal_at is not null
  then
    raise exception using errcode = '23514', message = 'Cancellation correlation failed.';
  end if;

  if v_request.state = 'ready' then
    update private.billing_subscription_cancellation_requests
    set
      state = 'completed',
      completed_at = p_completed_at
    where id = v_request.id;

    update private.workspace_billing_accounts as billing_account
    set
      subscription_status = 'cancellation_scheduled',
      cancel_at_period_end = true
    where billing_account.workspace_id = p_workspace_id;

    -- Scheduled cancellation is still paid and active until the provider sends
    -- the terminal subscription-ended event.
    update private.workspace_messaging_controls as control
    set messaging_enabled = true,
        suspension_reason = null
    where control.workspace_id = p_workspace_id;
  end if;

  return query select
    p_cancellation_request_id,
    p_subscription_id,
    p_workspace_id,
    'completed'::text;
end;
$$;

create or replace function public.billing_expire_grace_periods(
  p_limit integer,
  p_now timestamptz
)
returns table (
  expired_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_now is null then
    raise exception using errcode = '22023', message = 'Invalid grace expiration request.';
  end if;

  with candidates as (
    select account.workspace_id
    from private.workspace_billing_accounts as account
    where account.subscription_status = 'grace'
      and account.grace_ends_at <= p_now
    order by account.grace_ends_at, account.workspace_id
    limit p_limit
    for update skip locked
  ), expired as (
    update private.workspace_billing_accounts as account
    set
      subscription_status = 'ended',
      grace_ends_at = null,
      cancel_at_period_end = false
    from candidates
    where account.workspace_id = candidates.workspace_id
    returning account.workspace_id
  )
  select count(*)::integer into v_count from expired;

  update private.workspace_messaging_controls as control
  set
    messaging_enabled = false,
    suspension_reason = 'subscription_ended'
  where exists (
    select 1
    from private.workspace_billing_accounts as account
    where account.workspace_id = control.workspace_id
      and account.subscription_status = 'ended'
  );

  return query select v_count;
end;
$$;

create or replace function public.admin_complete_approved_number_activation(
  p_activation_id uuid,
  p_admin_user_id uuid,
  p_completed_at timestamptz,
  p_number_id uuid,
  p_period_end timestamptz,
  p_period_start timestamptz,
  p_subscription_id text,
  p_workspace_id uuid
)
returns table (
  activated boolean,
  activation_id uuid,
  number_id uuid,
  product_status text,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_activation private.phone_number_activation_attempts;
  v_detail private.phone_number_provider_details;
  v_phone public.phone_numbers;
begin
  if p_admin_user_id is null
    or p_completed_at is null
    or p_period_start is null
    or p_period_end is null
    or p_period_end <= p_period_start
    or pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Invalid number activation completion.';
  end if;

  if not exists (
    select 1 from auth.users as app_user where app_user.id = p_admin_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Admin user not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select activation.*
  into v_activation
  from private.phone_number_activation_attempts as activation
  where activation.activation_id = p_activation_id
    and activation.workspace_id = p_workspace_id
    and activation.phone_number_id = p_number_id
  for update;

  select phone.*
  into v_phone
  from public.phone_numbers as phone
  where phone.id = p_number_id
    and phone.workspace_id = p_workspace_id
  for update;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = p_number_id
  for update;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if v_activation.state = 'completed' and v_phone.status = 'ready' then
    return query select true, p_activation_id, p_number_id, 'ready'::text, p_workspace_id;
    return;
  end if;

  if v_activation.activation_id is null
    or v_activation.state <> 'claimed'
    or v_activation.requested_by <> p_admin_user_id
    or v_phone.id is null
    or v_phone.deleted_at is not null
    or v_phone.status <> 'pending'
    or v_detail.phone_number_id is null
    or v_detail.setup_state <> 'approved'
    or v_detail.a2p_state <> 'approved'
    or not exists (
      select 1
      from private.workspace_provider_accounts as provider_account
      where provider_account.workspace_id = p_workspace_id
        and provider_account.setup_state = 'ready'
        and provider_account.advanced_opt_out_enabled
        and provider_account.advanced_opt_out_confirmed_at is not null
    )
    or v_account.workspace_id is null
    or v_account.subscription_status <> 'active'
    or v_account.terminal_at is not null
    or v_account.stripe_subscription_id is distinct from p_subscription_id
    or v_account.current_period_start is distinct from p_period_start
    or v_account.current_period_end is distinct from p_period_end
    or not exists (
      select 1
      from public.billing_periods as period
      join private.billing_period_provider_details as period_detail
        on period_detail.billing_period_id = period.id
      where period.workspace_id = p_workspace_id
        and period.status = 'open'
        and not period.is_provisional
        and period.period_start = p_period_start
        and period.period_end = p_period_end
        and period_detail.subscription_id = p_subscription_id
    )
  then
    raise exception using errcode = '55000', message = 'Number activation prerequisites are not satisfied.';
  end if;

  update public.phone_numbers
  set status = 'ready'
  where id = p_number_id;

  update private.phone_number_provider_details
  set
    setup_state = 'ready',
    provider_status = coalesce(provider_status, 'ready'),
    provider_error_code = null,
    provider_error_message = null
  where phone_number_id = p_number_id;

  update private.phone_number_activation_attempts as activation
  set
    state = 'completed',
    completed_at = p_completed_at
  where activation.activation_id = p_activation_id;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status,
    a2p_state,
    changed_by,
    changed_at
  )
  values (
    p_workspace_id,
    p_number_id,
    'approved',
    'ready',
    v_detail.provider_status,
    v_detail.a2p_state,
    p_admin_user_id,
    p_completed_at
  );

  update private.workspace_messaging_controls as control
  set
    messaging_enabled = true,
    suspension_reason = null
  where control.workspace_id = p_workspace_id;

  return query select true, p_activation_id, p_number_id, 'ready'::text, p_workspace_id;
end;
$$;

create or replace function public.get_billing_usage_summary()
returns table (
  actual_credits integer,
  reserved_credits integer,
  effective_credits integer,
  included_credits integer,
  additional_credits integer,
  additional_credit_price_micro_usd bigint,
  additional_usage_amount_micro_usd bigint,
  monthly_price_cents integer,
  max_phone_numbers integer,
  safety_cap_credits integer,
  safety_cap_reached boolean,
  messaging_enabled boolean,
  payment_method_status text,
  subscription_status text,
  can_setup_payment boolean,
  can_open_portal boolean,
  can_cancel_subscription boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_control private.workspace_messaging_controls;
  v_period public.billing_periods;
  v_plan public.billing_plans;
  v_usage public.billing_period_usage;
  v_workspace public.workspaces;
  v_actual integer;
  v_cap integer;
  v_effective integer;
  v_included integer;
  v_overage integer;
  v_overage_price bigint;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select workspace.*
  into v_workspace
  from public.workspaces as workspace
  where workspace.owner_id = (select auth.uid());

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select plan.* into v_plan
  from public.billing_plans as plan
  where plan.id = v_workspace.billing_plan_id;

  select account.* into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = v_workspace.id;

  select control.* into v_control
  from private.workspace_messaging_controls as control
  where control.workspace_id = v_workspace.id;

  select period.*
  into v_period
  from public.billing_periods as period
  where period.workspace_id = v_workspace.id
    and (
      (
        v_account.stripe_subscription_id is null
        and period.status = 'open'
        and pg_catalog.now() >= period.period_start
        and pg_catalog.now() < period.period_end
      )
      or (
        v_account.stripe_subscription_id is not null
        and period.period_start = v_account.current_period_start
        and period.period_end = v_account.current_period_end
        and not period.is_provisional
        and exists (
          select 1
          from private.billing_period_provider_details as detail
          where detail.billing_period_id = period.id
            and detail.workspace_id = v_workspace.id
            and detail.subscription_id = v_account.stripe_subscription_id
        )
      )
    )
  order by
    (
      period.status = 'open'
      and pg_catalog.now() >= period.period_start
      and pg_catalog.now() < period.period_end
    ) desc,
    period.period_start desc
  limit 1;

  if v_period.id is not null then
    select usage.* into v_usage
    from public.billing_period_usage as usage
    where usage.billing_period_id = v_period.id;
  end if;

  v_actual := coalesce(v_usage.actual_outbound_segments, 0);
  v_effective := v_actual + coalesce(v_usage.reserved_outbound_segments, 0);
  v_included := coalesce(v_period.included_segments_snapshot, v_plan.included_segments);
  v_overage_price := coalesce(
    v_period.overage_price_micro_usd_snapshot,
    v_plan.overage_price_micro_usd
  );
  v_overage := greatest(0, v_actual - v_included);
  v_cap := coalesce(
    v_control.safety_cap_segments_override,
    v_period.safety_cap_segments_snapshot,
    v_plan.safety_cap_segments
  );

  return query select
    v_actual,
    coalesce(v_usage.reserved_outbound_segments, 0),
    v_effective,
    v_included,
    v_overage,
    v_overage_price,
    v_overage::bigint * v_overage_price,
    coalesce(v_period.monthly_price_cents_snapshot, v_plan.monthly_price_cents),
    coalesce(v_period.max_phone_numbers_snapshot, v_plan.max_phone_numbers),
    v_cap,
    v_effective >= v_cap,
    private.workspace_can_send_at(v_workspace.id, pg_catalog.now()),
    coalesce(v_account.payment_method_status, 'missing'),
    coalesce(v_account.subscription_status, 'not_started'),
    v_account.stripe_subscription_id is null
      and v_account.terminal_at is null
      and v_account.subscription_status in ('not_started', 'setup_required'),
    v_account.stripe_customer_id is not null
      and v_account.stripe_subscription_id is not null
      and v_account.subscription_status in (
        'active', 'cancellation_scheduled', 'past_due', 'unpaid', 'incomplete'
      ),
    v_account.subscription_status = 'active'
      and v_account.terminal_at is null;
end;
$$;

create or replace function public.admin_set_workspace_safety_cap(
  p_safety_cap_credits integer,
  p_workspace_id uuid
)
returns table (
  safety_cap_credits integer,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_included integer;
begin
  select plan.included_segments
  into v_included
  from public.workspaces as workspace
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  where workspace.id = p_workspace_id
  for update of workspace;

  if v_included is null then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  if p_safety_cap_credits is null or p_safety_cap_credits < v_included then
    raise exception using errcode = '22023', message = 'Safety cap is below included usage.';
  end if;

  update private.workspace_messaging_controls as control
  set safety_cap_segments_override = p_safety_cap_credits
  where control.workspace_id = p_workspace_id;

  return query select p_safety_cap_credits, p_workspace_id;
end;
$$;

create or replace function public.admin_get_customers(
  p_limit integer default 100
)
returns table (
  workspace_id uuid,
  workspace_name text,
  owner_email text,
  owner_name text,
  created_at timestamptz,
  subscription_status text,
  payment_method_status text,
  messaging_enabled boolean,
  suspension_reason text,
  actual_credits integer,
  reserved_credits integer,
  included_credits integer,
  safety_cap_credits integer,
  phone_count integer,
  pending_phone_count integer
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Invalid admin result limit.';
  end if;

  return query
  select
    workspace.id,
    workspace.name,
    profile.email,
    profile.display_name,
    workspace.created_at,
    account.subscription_status,
    account.payment_method_status,
    control.messaging_enabled
      and account.subscription_status in ('active', 'cancellation_scheduled')
      and account.terminal_at is null,
    control.suspension_reason,
    coalesce(usage.actual_outbound_segments, 0),
    coalesce(usage.reserved_outbound_segments, 0),
    coalesce(period.included_segments_snapshot, plan.included_segments),
    coalesce(
      control.safety_cap_segments_override,
      period.safety_cap_segments_snapshot,
      plan.safety_cap_segments
    ),
    coalesce(phone_counts.phone_count, 0),
    coalesce(phone_counts.pending_phone_count, 0)
  from public.workspaces as workspace
  join public.profiles as profile on profile.id = workspace.owner_id
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  join private.workspace_billing_accounts as account
    on account.workspace_id = workspace.id
  join private.workspace_messaging_controls as control
    on control.workspace_id = workspace.id
  left join lateral (
    select current_period.*
    from public.billing_periods as current_period
    where current_period.workspace_id = workspace.id
      and current_period.status = 'open'
    order by current_period.period_start desc
    limit 1
  ) as period on true
  left join public.billing_period_usage as usage
    on usage.billing_period_id = period.id
  left join lateral (
    select
      count(*) filter (where phone.deleted_at is null)::integer as phone_count,
      count(*) filter (
        where phone.deleted_at is null and phone.status = 'pending'
      )::integer as pending_phone_count
    from public.phone_numbers as phone
    where phone.workspace_id = workspace.id
  ) as phone_counts on true
  order by workspace.created_at desc, workspace.id
  limit p_limit;
end;
$$;

create or replace function public.admin_get_message_operations(
  p_limit integer default 100
)
returns table (
  message_id uuid,
  workspace_id uuid,
  workspace_name text,
  direction text,
  dispatch_state text,
  delivery_state text,
  provider text,
  provider_message_id text,
  provider_status text,
  provider_error_code text,
  provider_error_message text,
  provider_cost_micro_usd bigint,
  provider_currency text,
  num_segments integer,
  reconciliation_reason text,
  accepted_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Invalid admin result limit.';
  end if;

  return query
  select
    message.id,
    message.workspace_id,
    workspace.name,
    message.direction,
    message.dispatch_state,
    message.delivery_state,
    detail.provider,
    detail.provider_message_id,
    detail.provider_status,
    detail.provider_error_code,
    detail.provider_error_message,
    detail.provider_cost_micro_usd,
    detail.provider_currency,
    message.num_segments,
    coalesce(reconciliation.resolution_note, reconciliation.resolution),
    message.accepted_at,
    message.created_at
  from public.messages as message
  join public.workspaces as workspace on workspace.id = message.workspace_id
  left join private.message_provider_details as detail on detail.message_id = message.id
  left join private.dispatch_reconciliation_resolutions as reconciliation
    on reconciliation.message_id = message.id
  order by message.created_at desc, message.id
  limit p_limit;
end;
$$;

create or replace function public.admin_get_billing_operations(
  p_limit integer default 100
)
returns table (
  period_id uuid,
  workspace_id uuid,
  workspace_name text,
  period_start timestamptz,
  period_end timestamptz,
  period_status text,
  actual_outbound_segments integer,
  reserved_outbound_segments integer,
  included_segments integer,
  overage_segments integer,
  overage_amount_micro_usd bigint,
  billed_amount_micro_usd bigint,
  safety_cap_segments integer,
  provider_message_cost_micro_usd bigint,
  provider_fixed_cost_micro_usd bigint,
  provider_cost_micro_usd bigint,
  invoice_run_id uuid,
  invoice_id text,
  invoice_status text,
  subscription_id text,
  reconciliation_status text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using errcode = '22023', message = 'Invalid admin result limit.';
  end if;

  return query
  select
    period.id,
    period.workspace_id,
    workspace.name,
    period.period_start,
    period.period_end,
    period.status,
    usage.actual_outbound_segments,
    usage.reserved_outbound_segments,
    period.included_segments_snapshot,
    greatest(0, usage.actual_outbound_segments - period.included_segments_snapshot),
    greatest(0, usage.actual_outbound_segments - period.included_segments_snapshot)::bigint
      * period.overage_price_micro_usd_snapshot,
    coalesce(costs.billed_amount_micro_usd, 0),
    coalesce(control.safety_cap_segments_override, period.safety_cap_segments_snapshot),
    coalesce(costs.provider_message_cost_micro_usd, 0),
    coalesce(fixed.provider_fixed_cost_micro_usd, 0),
    coalesce(costs.provider_message_cost_micro_usd, 0)
      + coalesce(fixed.provider_fixed_cost_micro_usd, 0),
    invoice_run.id,
    invoice_run.stripe_invoice_id,
    invoice_run.run_state,
    period_detail.subscription_id,
    case
      when coalesce(costs.pending_reconciliation_count, 0) > 0 then 'pending'
      else 'reconciled'
    end
  from public.billing_periods as period
  join public.workspaces as workspace on workspace.id = period.workspace_id
  join public.billing_period_usage as usage on usage.billing_period_id = period.id
  join private.workspace_messaging_controls as control
    on control.workspace_id = period.workspace_id
  left join private.billing_period_provider_details as period_detail
    on period_detail.billing_period_id = period.id
  left join lateral (
    select
      coalesce(sum(ledger.provider_cost_micro_usd), 0)::bigint
        as provider_message_cost_micro_usd,
      coalesce(sum(ledger.billed_customer_amount_micro_usd), 0)::bigint
        as billed_amount_micro_usd,
      count(*) filter (
        where ledger.direction = 'outbound' and ledger.num_segments is null
      )::integer as pending_reconciliation_count
    from private.billing_usage_ledger as ledger
    where ledger.billing_period_id = period.id
  ) as costs on true
  left join lateral (
    select coalesce(sum(fixed_cost.provider_cost_micro_usd), 0)::bigint
      as provider_fixed_cost_micro_usd
    from private.provider_fixed_cost_ledger as fixed_cost
    where fixed_cost.billing_period_id = period.id
  ) as fixed on true
  left join lateral (
    select run.*
    from private.billing_invoice_runs as run
    where period.id = any(run.source_period_ids)
    order by run.prepared_at desc, run.id
    limit 1
  ) as invoice_run on true
  order by period.period_start desc, period.id
  limit p_limit;
end;
$$;

revoke all on table private.workspace_billing_accounts
  from public, anon, authenticated;
revoke all on table private.billing_setup_intents
  from public, anon, authenticated;
revoke all on table private.billing_period_provider_details
  from public, anon, authenticated;
revoke all on table private.billing_webhook_events
  from public, anon, authenticated;
revoke all on table private.billing_invoice_runs
  from public, anon, authenticated;
revoke all on table private.billing_invoice_run_entries
  from public, anon, authenticated;
revoke all on table private.billing_subscription_cancellation_requests
  from public, anon, authenticated;
revoke all on table private.provider_fixed_cost_ledger
  from public, anon, authenticated;
revoke all on table private.operation_rate_limit_policies
  from public, anon, authenticated;
revoke all on table private.operation_rate_limit_attempts
  from public, anon, authenticated;

revoke all on function public.billing_get_workspace_account(uuid)
  from public, anon, authenticated;
revoke all on function public.billing_record_customer(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.billing_record_setup_intent(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.billing_record_subscription(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.billing_claim_webhook_event(
  timestamptz,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.billing_complete_webhook_event(
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.billing_fail_webhook_event(
  uuid,
  text,
  timestamptz,
  text,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.billing_apply_payment_method_event(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.billing_prepare_additional_usage_invoice_run(
  text,
  uuid,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text
) from public, anon, authenticated;
revoke all on function public.billing_complete_additional_usage_invoice_run(
  integer,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.billing_apply_lifecycle_event(
  boolean,
  boolean,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.billing_prepare_subscription_cancellation(
  timestamptz,
  uuid
) from public, anon, authenticated;
revoke all on function public.billing_complete_subscription_cancellation(
  uuid,
  timestamptz,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.billing_expire_grace_periods(integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public.billing_claim_payment_setup_attempt(
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.messaging_claim_number_search(
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_complete_approved_number_activation(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz,
  timestamptz,
  text,
  uuid
) from public, anon, authenticated;
revoke all on function public.admin_set_workspace_safety_cap(integer, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_get_customers(integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_message_operations(integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_billing_operations(integer)
  from public, anon, authenticated;

grant execute on function public.billing_get_workspace_account(uuid)
  to service_role;
grant execute on function public.billing_record_customer(uuid, text, timestamptz)
  to service_role;
grant execute on function public.billing_record_setup_intent(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.billing_record_subscription(
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  timestamptz
) to service_role;
grant execute on function public.billing_claim_webhook_event(
  timestamptz,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.billing_complete_webhook_event(
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.billing_fail_webhook_event(
  uuid,
  text,
  timestamptz,
  text,
  text,
  text
) to service_role;
grant execute on function public.billing_apply_payment_method_event(
  uuid,
  text,
  text,
  timestamptz,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.billing_prepare_additional_usage_invoice_run(
  text,
  uuid,
  text,
  text,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text
) to service_role;
grant execute on function public.billing_complete_additional_usage_invoice_run(
  integer,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.billing_apply_lifecycle_event(
  boolean,
  boolean,
  uuid,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  uuid
) to service_role;
grant execute on function public.billing_prepare_subscription_cancellation(
  timestamptz,
  uuid
) to service_role;
grant execute on function public.billing_complete_subscription_cancellation(
  uuid,
  timestamptz,
  text,
  uuid
) to service_role;
grant execute on function public.billing_expire_grace_periods(integer, timestamptz)
  to service_role;
grant execute on function public.billing_claim_payment_setup_attempt(
  uuid,
  text,
  timestamptz
) to service_role;
grant execute on function public.messaging_claim_number_search(
  uuid,
  uuid,
  timestamptz
) to service_role;
grant execute on function public.admin_complete_approved_number_activation(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz,
  timestamptz,
  text,
  uuid
) to service_role;
grant execute on function public.admin_set_workspace_safety_cap(integer, uuid)
  to service_role;
grant execute on function public.admin_get_customers(integer)
  to service_role;
grant execute on function public.admin_get_message_operations(integer)
  to service_role;
grant execute on function public.admin_get_billing_operations(integer)
  to service_role;

revoke all on function public.get_billing_usage_summary()
  from public, anon;
grant execute on function public.get_billing_usage_summary()
  to authenticated;

comment on table private.billing_invoice_run_entries is
  'Immutable per-message deltas reserved by one aggregated Additional SMS usage line.';
comment on column private.billing_usage_ledger.reserved_billing_invoice_run_id is
  'Durable invoice claim. It is never released automatically after an ambiguous external result.';
comment on function public.get_billing_usage_summary() is
  'Provider-neutral SMS credit and subscription summary for the authenticated workspace owner.';

create trigger workspaces_initialize_billing_account
after insert on public.workspaces
for each row execute function private.initialize_workspace_billing_account();

insert into private.workspace_billing_accounts (workspace_id)
select workspace.id
from public.workspaces as workspace
on conflict (workspace_id) do nothing;

create or replace function private.prevent_billing_period_overlap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.billing_periods as period
    where period.workspace_id = new.workspace_id
      and period.id <> new.id
      and tstzrange(period.period_start, period.period_end, '[)')
        && tstzrange(new.period_start, new.period_end, '[)')
  ) then
    raise exception using
      errcode = '23P01',
      constraint = 'billing_periods_no_overlap',
      message = 'Billing periods for a workspace cannot overlap.';
  end if;
  return new;
end;
$$;

create trigger billing_periods_prevent_overlap
before insert or update of workspace_id, period_start, period_end
on public.billing_periods
for each row execute function private.prevent_billing_period_overlap();

-- Closed periods are historical. Outbound reservations may use only the one
-- open period. Once a subscription exists, absence of its exact open Stripe
-- period fails closed instead of inventing a provisional allowance.
create or replace function private.ensure_current_billing_period(
  p_workspace_id uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_period_id uuid;
begin
  if p_at is null then
    raise exception using errcode = '22023', message = 'Billing timestamp is required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  select period.id
  into v_period_id
  from public.billing_periods as period
  where period.workspace_id = p_workspace_id
    and period.status = 'open'
    and p_at >= period.period_start
    and p_at < period.period_end
  for update;

  if v_period_id is not null then
    if v_account.stripe_subscription_id is not null
      and not exists (
        select 1
        from private.billing_period_provider_details as detail
        where detail.billing_period_id = v_period_id
          and detail.workspace_id = p_workspace_id
          and detail.subscription_id = v_account.stripe_subscription_id
      )
    then
      raise exception using
        errcode = '55000',
        message = 'An exact active billing period is unavailable.';
    end if;
    return v_period_id;
  end if;

  update public.billing_periods
  set status = 'closed'
  where workspace_id = p_workspace_id
    and status = 'open'
    and period_end <= p_at;

  if v_account.stripe_subscription_id is not null then
    raise exception using
      errcode = '55000',
      message = 'An exact active billing period is unavailable.';
  end if;

  return private.create_billing_period(
    p_workspace_id,
    p_at,
    p_at + interval '1 month',
    true
  );
end;
$$;

create or replace function private.activate_exact_billing_period(
  p_workspace_id uuid,
  p_subscription_id text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_activated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open public.billing_periods;
  v_period public.billing_periods;
begin
  if pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
    or p_period_start is null
    or p_period_end is null
    or p_period_end <= p_period_start
    or p_activated_at is null
  then
    raise exception using errcode = '22023', message = 'Invalid exact billing period.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select period.*
  into v_open
  from public.billing_periods as period
  where period.workspace_id = p_workspace_id
    and period.status = 'open'
  for update;

  if found and v_open.period_start = p_period_start then
    if not v_open.is_provisional and v_open.period_end <> p_period_end then
      raise exception using
        errcode = '23514',
        message = 'Existing exact billing period does not match.';
    end if;

    update public.billing_periods
    set
      period_end = p_period_end,
      status = 'open',
      is_provisional = false
    where id = v_open.id
    returning * into v_period;
  else
    if found then
      update public.billing_periods
      set
        status = 'closed',
        period_end = case
          when is_provisional and period_start < p_period_start
            then least(period_end, p_period_start)
          else period_end
        end
      where id = v_open.id;
    end if;

    select period.*
    into v_period
    from public.billing_periods as period
    where period.workspace_id = p_workspace_id
      and period.period_start = p_period_start
    for update;

    if found then
      if v_period.is_provisional or v_period.period_end <> p_period_end then
        raise exception using
          errcode = '23514',
          message = 'Existing billing period does not match the subscription.';
      end if;
      update public.billing_periods
      set status = 'open'
      where id = v_period.id
      returning * into v_period;
    else
      v_period.id := private.create_billing_period(
        p_workspace_id,
        p_period_start,
        p_period_end,
        false
      );
      select period.* into v_period
      from public.billing_periods as period
      where period.id = v_period.id;
    end if;
  end if;

  insert into private.billing_period_provider_details (
    billing_period_id,
    workspace_id,
    subscription_id,
    activated_at
  )
  values (
    v_period.id,
    p_workspace_id,
    pg_catalog.btrim(p_subscription_id),
    p_activated_at
  )
  on conflict (billing_period_id) do update
  set
    subscription_id = excluded.subscription_id,
    activated_at = least(
      private.billing_period_provider_details.activated_at,
      excluded.activated_at
    )
  where private.billing_period_provider_details.workspace_id = excluded.workspace_id
    and private.billing_period_provider_details.subscription_id = excluded.subscription_id;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Billing period subscription correlation failed.';
  end if;

  return v_period.id;
end;
$$;

create or replace function private.move_message_reservation_to_current_period(
  p_message_id uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_current_effective integer;
  v_current_period_id uuid;
  v_message public.messages;
  v_old_reserved integer;
begin
  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found
    or v_message.dispatch_state <> 'reserved'
    or v_message.reserved_segments <= 0
    or v_message.reserved_billing_period_id is null
  then
    return null;
  end if;

  begin
    v_current_period_id := private.ensure_current_billing_period(
      v_message.workspace_id,
      p_at
    );
  exception
    when sqlstate '55000' then
      return null;
  end;

  perform 1
  from public.billing_period_usage as usage
  where usage.billing_period_id in (
    v_message.reserved_billing_period_id,
    v_current_period_id
  )
  order by usage.billing_period_id
  for update;

  select
    usage.actual_outbound_segments + usage.reserved_outbound_segments,
    coalesce(
      control.safety_cap_segments_override,
      period.safety_cap_segments_snapshot
    )
  into v_current_effective, v_cap
  from public.billing_period_usage as usage
  join public.billing_periods as period on period.id = usage.billing_period_id
  join private.workspace_messaging_controls as control
    on control.workspace_id = usage.workspace_id
  where usage.billing_period_id = v_current_period_id;

  if v_current_effective is null then
    return null;
  end if;

  if v_message.reserved_billing_period_id = v_current_period_id then
    if v_current_effective > v_cap then
      return null;
    end if;
    return v_current_period_id;
  end if;

  if v_current_effective + v_message.reserved_segments > v_cap then
    return null;
  end if;

  select usage.reserved_outbound_segments
  into v_old_reserved
  from public.billing_period_usage as usage
  where usage.billing_period_id = v_message.reserved_billing_period_id;

  if v_old_reserved is null or v_old_reserved < v_message.reserved_segments then
    raise exception using errcode = '23514', message = 'Reserved SMS usage is inconsistent.';
  end if;

  update public.billing_period_usage
  set reserved_outbound_segments =
    reserved_outbound_segments - v_message.reserved_segments
  where billing_period_id = v_message.reserved_billing_period_id;

  update public.billing_period_usage
  set reserved_outbound_segments =
    reserved_outbound_segments + v_message.reserved_segments
  where billing_period_id = v_current_period_id;

  update public.messages
  set reserved_billing_period_id = v_current_period_id
  where id = p_message_id;

  return v_current_period_id;
end;
$$;

drop function if exists private.begin_message_dispatch_before_billing_rollover(uuid, uuid, timestamptz);
alter function private.begin_message_dispatch(uuid, uuid, timestamptz)
  rename to begin_message_dispatch_before_billing_rollover;

create or replace function private.begin_message_dispatch(
  p_message_id uuid,
  p_reservation_token uuid,
  p_now timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_period_id uuid;
begin
  if exists (
    select 1
    from public.messages as message
    where message.id = p_message_id
      and message.dispatch_state = 'reserved'
      and message.reservation_token = p_reservation_token
  ) then
    v_period_id := private.move_message_reservation_to_current_period(
      p_message_id,
      p_now
    );

    if v_period_id is null then
      v_code := case
        when private.workspace_can_send_at(
          (select message.workspace_id from public.messages as message where message.id = p_message_id),
          p_now
        ) then 'usage_safety_cap_reached'
        else 'messaging_unavailable'
      end;
      perform private.release_reserved_message(p_message_id, 'pending', null);
      return pg_catalog.jsonb_build_object(
        'authorized', false,
        'code', v_code
      );
    end if;
  end if;

  -- The wrapped validator establishes the dispatch_unknown provider fence.
  return private.begin_message_dispatch_before_billing_rollover(
    p_message_id,
    p_reservation_token,
    p_now
  );
end;
$$;

alter function public.manual_message_final_validate_and_begin_attempt(
  uuid,
  uuid,
  uuid,
  timestamptz
)
  rename to manual_message_final_validate_before_billing_rollover;

revoke all on function public.manual_message_final_validate_before_billing_rollover(
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;

create or replace function public.manual_message_final_validate_and_begin_attempt(
  p_workspace_id uuid,
  p_message_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_period_id uuid;
begin
  if exists (
    select 1
    from public.messages as message
    join private.manual_message_dispatches as manual
      on manual.message_id = message.id
    where message.id = p_message_id
      and message.workspace_id = p_workspace_id
      and message.dispatch_state = 'reserved'
      and manual.claim_token = p_claim_token
  ) then
    v_period_id := private.move_message_reservation_to_current_period(
      p_message_id,
      p_now
    );

    if v_period_id is null then
      v_code := case
        when private.workspace_can_send_at(p_workspace_id, p_now)
          then 'usage_safety_cap_reached'
        else 'messaging_unavailable'
      end;
      perform private.reject_manual_message_reservation(
        p_message_id,
        v_code,
        p_now
      );
      return pg_catalog.jsonb_build_object(
        'authorized', false,
        'code', v_code
      );
    end if;
  end if;

  -- The wrapped validator establishes the dispatch_unknown provider fence.
  return public.manual_message_final_validate_before_billing_rollover(
    p_workspace_id,
    p_message_id,
    p_claim_token,
    p_now
  );
end;
$$;

revoke all on function public.manual_message_final_validate_and_begin_attempt(
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.manual_message_final_validate_and_begin_attempt(
  uuid,
  uuid,
  uuid,
  timestamptz
) to service_role;

create or replace function private.workspace_below_safety_cap_at(
  p_workspace_id uuid,
  p_at timestamptz
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      select
        usage.actual_outbound_segments + usage.reserved_outbound_segments
          < coalesce(
              control.safety_cap_segments_override,
              period.safety_cap_segments_snapshot
            )
      from public.billing_periods as period
      join public.billing_period_usage as usage
        on usage.billing_period_id = period.id
        and usage.workspace_id = period.workspace_id
      join private.workspace_messaging_controls as control
        on control.workspace_id = period.workspace_id
      where period.workspace_id = p_workspace_id
        and period.status = 'open'
        and p_at >= period.period_start
        and p_at < period.period_end
    ),
    false
  );
$$;

create or replace function private.enforce_customer_messaging_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := pg_catalog.now();
begin
  if tg_table_name = 'campaigns' then
    if new.status = 'active'
      and old.status is distinct from new.status
    then
      if not private.workspace_can_send_at(new.workspace_id, v_at) then
        raise exception using
          errcode = '55000',
          message = 'Messaging is not available for this workspace.';
      end if;

      if not private.workspace_below_safety_cap_at(new.workspace_id, v_at) then
        raise exception using
          errcode = '55000',
          message = 'The workspace SMS credit safety limit has been reached.';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'messages' then
    if tg_op = 'INSERT' then
      if new.direction = 'outbound'
        and new.dispatch_state = 'reserved'
        and not private.workspace_can_send_at(new.workspace_id, v_at)
      then
        raise exception using
          errcode = '55000',
          message = 'Messaging is not available for this workspace.';
      end if;
    elsif tg_op = 'UPDATE' then
      if old.dispatch_state = 'reserved'
        and new.dispatch_state = 'dispatch_unknown'
        and not private.workspace_can_send_at(new.workspace_id, v_at)
      then
        raise exception using
          errcode = '55000',
          message = 'Messaging is not available for this workspace.';
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

create trigger campaigns_enforce_customer_messaging_gate
before update of status on public.campaigns
for each row execute function private.enforce_customer_messaging_gate();

create trigger messages_enforce_customer_messaging_gate
before insert or update of dispatch_state on public.messages
for each row execute function private.enforce_customer_messaging_gate();

commit;
