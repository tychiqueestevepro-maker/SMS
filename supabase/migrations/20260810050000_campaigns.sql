begin;

alter table public.billing_plans
  add column large_campaign_recipient_threshold integer not null default 1000,
  add column large_campaign_overage_credit_threshold integer not null default 1,
  add constraint billing_plans_large_campaign_recipient_threshold_valid
    check (large_campaign_recipient_threshold > 0),
  add constraint billing_plans_large_campaign_overage_threshold_valid
    check (large_campaign_overage_credit_threshold > 0);

update public.billing_plans
set
  large_campaign_recipient_threshold = 1000,
  large_campaign_overage_credit_threshold = 1
where code = 'riink-v1';

alter table public.contacts
  add constraint contacts_workspace_id_id_key unique (workspace_id, id);

create table public.billing_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  billing_plan_id uuid not null references public.billing_plans (id) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  status text not null default 'open',
  is_provisional boolean not null default true,
  monthly_price_cents_snapshot integer not null,
  included_segments_snapshot integer not null,
  overage_price_micro_usd_snapshot bigint not null,
  max_phone_numbers_snapshot integer not null,
  safety_cap_segments_snapshot integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_periods_workspace_id_id_key unique (workspace_id, id),
  constraint billing_periods_workspace_start_key unique (workspace_id, period_start),
  constraint billing_periods_dates_valid check (period_end > period_start),
  constraint billing_periods_status_valid check (status in ('open', 'closed')),
  constraint billing_periods_snapshots_valid check (
    monthly_price_cents_snapshot >= 0
    and included_segments_snapshot >= 0
    and overage_price_micro_usd_snapshot >= 0
    and max_phone_numbers_snapshot > 0
    and safety_cap_segments_snapshot >= included_segments_snapshot
  )
);

create unique index billing_periods_one_open_per_workspace
  on public.billing_periods (workspace_id)
  where status = 'open';

create index billing_periods_workspace_dates_idx
  on public.billing_periods (workspace_id, period_start, period_end);

create table public.billing_period_usage (
  billing_period_id uuid primary key,
  workspace_id uuid not null,
  actual_outbound_segments integer not null default 0,
  reserved_outbound_segments integer not null default 0,
  next_usage_position bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_period_usage_period_fkey
    foreign key (workspace_id, billing_period_id)
    references public.billing_periods (workspace_id, id)
    on delete cascade,
  constraint billing_period_usage_counts_nonnegative check (
    actual_outbound_segments >= 0
    and reserved_outbound_segments >= 0
    and next_usage_position >= 0
  )
);

create table private.workspace_messaging_controls (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  messaging_enabled boolean not null default true,
  suspension_reason text,
  safety_cap_segments_override integer,
  updated_at timestamptz not null default now(),
  constraint workspace_messaging_controls_safety_cap_override_valid
    check (safety_cap_segments_override is null or safety_cap_segments_override > 0)
);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_e164 text not null,
  status text not null default 'pending',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_numbers_workspace_id_id_key unique (workspace_id, id),
  constraint phone_numbers_workspace_phone_key unique (workspace_id, phone_e164),
  constraint phone_numbers_phone_e164_us_format check (
    phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  ),
  constraint phone_numbers_status_valid check (status in ('pending', 'ready'))
);

create index phone_numbers_workspace_active_idx
  on public.phone_numbers (workspace_id, status)
  where deleted_at is null;

create table private.phone_number_provider_details (
  phone_number_id uuid primary key references public.phone_numbers (id) on delete cascade,
  provider text not null,
  provider_number_id text not null,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_number_provider_details_provider_id_key
    unique (provider, provider_number_id),
  constraint phone_number_provider_details_values_not_blank check (
    char_length(btrim(provider)) > 0
    and char_length(btrim(provider_number_id)) > 0
  )
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_number_id uuid,
  name text not null,
  status text not null default 'draft',
  launched_at timestamptz,
  paused_at timestamptz,
  finished_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_workspace_id_id_key unique (workspace_id, id),
  constraint campaigns_workspace_phone_number_fkey
    foreign key (workspace_id, phone_number_id)
    references public.phone_numbers (workspace_id, id)
    on delete restrict,
  constraint campaigns_name_not_blank check (
    name = btrim(name) and char_length(name) > 0
  ),
  constraint campaigns_status_valid check (
    status in ('draft', 'active', 'paused', 'finished')
  )
);

create index campaigns_workspace_status_idx
  on public.campaigns (workspace_id, status, created_at desc)
  where deleted_at is null;

create table public.campaign_draft_contacts (
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (campaign_id, contact_id)
);

create table public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  step_order smallint not null,
  body text not null,
  wait_days_after_previous smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_steps_campaign_order_key unique (campaign_id, step_order),
  constraint campaign_steps_order_valid check (step_order between 1 and 3),
  constraint campaign_steps_body_not_blank check (char_length(btrim(body)) > 0),
  constraint campaign_steps_wait_valid check (
    (step_order = 1 and wait_days_after_previous = 0)
    or
    (step_order > 1 and wait_days_after_previous between 1 and 365)
  ),
  constraint campaign_steps_template_valid check (
    replace(
      replace(
        replace(body, '{{first_name}}', ''),
        '{{last_name}}',
        ''
      ),
      '{{company}}',
      ''
    ) !~ '{{|}}'
  )
);

create table public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null,
  contact_id uuid not null,
  state text not null default 'active',
  current_step_order smallint not null default 1,
  next_send_at timestamptz,
  replied_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  enrolled_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_recipients_workspace_campaign_fkey
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id)
    on delete cascade,
  constraint campaign_recipients_workspace_contact_fkey
    foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id)
    on delete restrict,
  constraint campaign_recipients_campaign_contact_key
    unique (campaign_id, contact_id),
  constraint campaign_recipients_workspace_id_id_key
    unique (workspace_id, id),
  constraint campaign_recipients_state_valid check (
    state in ('active', 'stopped', 'finished')
  ),
  constraint campaign_recipients_stop_reason_valid check (
    stop_reason is null
    or stop_reason in (
      'reply',
      'opt_out',
      'failed',
      'contact_deleted',
      'campaign_deleted',
      'dispatch_unknown'
    )
  ),
  constraint campaign_recipients_state_shape_valid check (
    (state = 'active' and stop_reason is null and stopped_at is null)
    or (state = 'stopped' and stop_reason is not null and stopped_at is not null)
    or (state = 'finished' and stop_reason is null and finished_at is not null)
  ),
  constraint campaign_recipients_step_valid check (
    current_step_order between 1 and 3
  )
);

create unique index campaign_recipients_one_active_sequence_per_contact
  on public.campaign_recipients (workspace_id, contact_id)
  where state = 'active'
    or (state = 'stopped' and stop_reason = 'dispatch_unknown');

create index campaign_recipients_due_idx
  on public.campaign_recipients (next_send_at, id)
  where state = 'active' and next_send_at is not null;

create index campaign_recipients_campaign_state_idx
  on public.campaign_recipients (campaign_id, state);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  contact_id uuid not null,
  phone_number_id uuid not null,
  campaign_id uuid,
  campaign_recipient_id uuid,
  step_order smallint,
  direction text not null,
  body text not null,
  dispatch_state text not null default 'pending',
  delivery_state text,
  estimated_segments integer,
  reserved_segments integer not null default 0,
  num_segments integer,
  reserved_billing_period_id uuid,
  billing_period_id uuid,
  usage_position bigint,
  included_segments_snapshot integer,
  overage_price_micro_usd_snapshot bigint,
  reservation_token uuid,
  scheduled_for timestamptz,
  reserved_at timestamptz,
  dispatch_started_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  reservation_released_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messages_workspace_contact_fkey
    foreign key (workspace_id, contact_id)
    references public.contacts (workspace_id, id)
    on delete restrict,
  constraint messages_workspace_phone_fkey
    foreign key (workspace_id, phone_number_id)
    references public.phone_numbers (workspace_id, id)
    on delete restrict,
  constraint messages_workspace_campaign_fkey
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id)
    on delete restrict,
  constraint messages_workspace_recipient_fkey
    foreign key (workspace_id, campaign_recipient_id)
    references public.campaign_recipients (workspace_id, id)
    on delete restrict,
  constraint messages_reserved_period_fkey
    foreign key (workspace_id, reserved_billing_period_id)
    references public.billing_periods (workspace_id, id)
    on delete restrict,
  constraint messages_billing_period_fkey
    foreign key (workspace_id, billing_period_id)
    references public.billing_periods (workspace_id, id)
    on delete restrict,
  constraint messages_recipient_step_key unique (campaign_recipient_id, step_order),
  constraint messages_direction_valid check (direction in ('inbound', 'outbound')),
  constraint messages_dispatch_state_valid check (
    dispatch_state in ('pending', 'reserved', 'accepted', 'failed', 'dispatch_unknown')
  ),
  constraint messages_delivery_state_valid check (
    delivery_state is null or delivery_state in ('sent', 'delivered', 'failed')
  ),
  constraint messages_body_not_blank check (char_length(body) > 0),
  constraint messages_segments_valid check (
    (estimated_segments is null or estimated_segments > 0)
    and reserved_segments >= 0
    and (num_segments is null or num_segments > 0)
  ),
  constraint messages_campaign_shape_valid check (
    (
      campaign_recipient_id is null
      and campaign_id is null
      and step_order is null
    )
    or
    (
      campaign_recipient_id is not null
      and campaign_id is not null
      and step_order between 1 and 3
    )
  )
);

create index messages_campaign_recipient_idx
  on public.messages (campaign_recipient_id, step_order);

create index messages_campaign_statistics_idx
  on public.messages (campaign_id, dispatch_state, delivery_state)
  where direction = 'outbound';

create index messages_reserved_period_idx
  on public.messages (reserved_billing_period_id)
  where reserved_segments > 0;

create table private.message_provider_details (
  message_id uuid primary key references public.messages (id) on delete cascade,
  provider text not null,
  provider_message_id text,
  provider_status text,
  provider_error_code text,
  provider_error_message text,
  provider_cost_micro_usd bigint,
  provider_currency text,
  provider_cost_pending boolean not null default true,
  reconciliation_state text not null default 'pending',
  reconciliation_token uuid,
  reconciliation_claimed_at timestamptz,
  reconciliation_next_attempt_at timestamptz,
  reconciliation_attempt_count integer not null default 0,
  reconciliation_reason text,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_provider_details_provider_message_key
    unique (provider, provider_message_id),
  constraint message_provider_details_provider_not_blank check (
    char_length(btrim(provider)) > 0
  ),
  constraint message_provider_details_reconciliation_state_valid check (
    reconciliation_state in ('pending', 'claimed', 'deferred', 'complete')
  ),
  constraint message_provider_details_reconciliation_attempts_valid check (
    reconciliation_attempt_count >= 0
  )
);

create table public.consent_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  campaign_id uuid not null unique,
  confirmed_by uuid not null references auth.users (id) on delete restrict,
  recipient_count integer not null,
  consent_confirmed boolean not null,
  large_launch_confirmed boolean not null,
  launch_assessment jsonb not null,
  confirmed_at timestamptz not null default now(),
  constraint consent_confirmations_workspace_campaign_fkey
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id)
    on delete cascade,
  constraint consent_confirmations_recipient_count_positive check (
    recipient_count > 0
  )
);

create trigger billing_periods_touch_updated_at
before update on public.billing_periods
for each row execute function private.touch_updated_at();

create trigger billing_period_usage_touch_updated_at
before update on public.billing_period_usage
for each row execute function private.touch_updated_at();

create trigger phone_numbers_touch_updated_at
before update on public.phone_numbers
for each row execute function private.touch_updated_at();

create trigger campaigns_touch_updated_at
before update on public.campaigns
for each row execute function private.touch_updated_at();

create trigger campaign_steps_touch_updated_at
before update on public.campaign_steps
for each row execute function private.touch_updated_at();

create trigger campaign_recipients_touch_updated_at
before update on public.campaign_recipients
for each row execute function private.touch_updated_at();

create trigger messages_touch_updated_at
before update on public.messages
for each row execute function private.touch_updated_at();

create trigger phone_number_provider_details_touch_updated_at
before update on private.phone_number_provider_details
for each row execute function private.touch_updated_at();

create trigger message_provider_details_touch_updated_at
before update on private.message_provider_details
for each row execute function private.touch_updated_at();

create or replace function private.validate_campaign_draft_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.campaigns as campaign
    join public.contacts as contact
      on contact.id = new.contact_id
      and contact.workspace_id = campaign.workspace_id
    where campaign.id = new.campaign_id
      and campaign.status = 'draft'
      and campaign.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Draft campaign contact must belong to the same workspace.';
  end if;

  return new;
end;
$$;

create trigger campaign_draft_contacts_validate
before insert or update on public.campaign_draft_contacts
for each row execute function private.validate_campaign_draft_contact();

create or replace function private.initialize_billing_period_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_period_usage (billing_period_id, workspace_id)
  values (new.id, new.workspace_id)
  on conflict (billing_period_id) do nothing;

  return new;
end;
$$;

create trigger billing_periods_initialize_usage
after insert on public.billing_periods
for each row execute function private.initialize_billing_period_usage();

create or replace function private.create_billing_period(
  p_workspace_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_is_provisional boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  insert into public.billing_periods (
    workspace_id,
    billing_plan_id,
    period_start,
    period_end,
    is_provisional,
    monthly_price_cents_snapshot,
    included_segments_snapshot,
    overage_price_micro_usd_snapshot,
    max_phone_numbers_snapshot,
    safety_cap_segments_snapshot
  )
  select
    workspace.id,
    plan.id,
    p_period_start,
    p_period_end,
    p_is_provisional,
    plan.monthly_price_cents,
    plan.included_segments,
    plan.overage_price_micro_usd,
    plan.max_phone_numbers,
    plan.safety_cap_segments
  from public.workspaces as workspace
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  where workspace.id = p_workspace_id
  returning id into v_period_id;

  if v_period_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace billing plan not found.';
  end if;

  return v_period_id;
end;
$$;

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
  v_period_id uuid;
begin
  select period.id
  into v_period_id
  from public.billing_periods as period
  where period.workspace_id = p_workspace_id
    and p_at >= period.period_start
    and p_at < period.period_end
  for update;

  if v_period_id is not null then
    return v_period_id;
  end if;

  update public.billing_periods
  set status = 'closed'
  where workspace_id = p_workspace_id
    and status = 'open'
    and period_end <= p_at;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select period.id
  into v_period_id
  from public.billing_periods as period
  where period.workspace_id = p_workspace_id
    and period.status = 'open'
    and p_at >= period.period_start
    and p_at < period.period_end
  for update;

  if v_period_id is null then
    v_period_id := private.create_billing_period(
      p_workspace_id,
      p_at,
      p_at + interval '1 month',
      true
    );
  end if;

  return v_period_id;
end;
$$;

-- Historical events (notably delayed inbound callbacks) must remain attached
-- to the period in which they occurred. Outbound reservations intentionally
-- continue to use ensure_current_billing_period(), which is tightened by the
-- billing slice to require the active open period.
create or replace function private.billing_period_for_occurrence(
  p_workspace_id uuid,
  p_occurred_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
begin
  select period.id
  into v_period_id
  from public.billing_periods as period
  where period.workspace_id = p_workspace_id
    and p_occurred_at >= period.period_start
    and p_occurred_at < period.period_end
  order by
    (period.status = 'open') desc,
    period.is_provisional asc,
    period.period_start desc,
    period.id
  limit 1;

  if v_period_id is not null then
    return v_period_id;
  end if;

  return private.ensure_current_billing_period(p_workspace_id, p_occurred_at);
end;
$$;

create or replace function private.initialize_campaign_workspace()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.workspace_messaging_controls (workspace_id)
  values (new.id)
  on conflict (workspace_id) do nothing;

  perform private.create_billing_period(
    new.id,
    pg_catalog.now(),
    pg_catalog.now() + interval '1 month',
    true
  );

  return new;
end;
$$;

create trigger workspaces_initialize_campaign_foundation
after insert on public.workspaces
for each row execute function private.initialize_campaign_workspace();

insert into private.workspace_messaging_controls (workspace_id)
select workspace.id
from public.workspaces as workspace
on conflict (workspace_id) do nothing;

insert into public.billing_periods (
  workspace_id,
  billing_plan_id,
  period_start,
  period_end,
  is_provisional,
  monthly_price_cents_snapshot,
  included_segments_snapshot,
  overage_price_micro_usd_snapshot,
  max_phone_numbers_snapshot,
  safety_cap_segments_snapshot
)
select
  workspace.id,
  plan.id,
  pg_catalog.now(),
  pg_catalog.now() + interval '1 month',
  true,
  plan.monthly_price_cents,
  plan.included_segments,
  plan.overage_price_micro_usd,
  plan.max_phone_numbers,
  plan.safety_cap_segments
from public.workspaces as workspace
join public.billing_plans as plan on plan.id = workspace.billing_plan_id
where not exists (
  select 1
  from public.billing_periods as period
  where period.workspace_id = workspace.id
    and period.status = 'open'
);

create or replace function private.enforce_phone_number_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_number_count integer;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = new.workspace_id
  for update;

  select coalesce(period.max_phone_numbers_snapshot, plan.max_phone_numbers)
  into v_limit
  from public.workspaces as workspace
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  left join public.billing_periods as period
    on period.workspace_id = workspace.id
    and period.status = 'open'
  where workspace.id = new.workspace_id;

  select count(*)::integer
  into v_number_count
  from public.phone_numbers as phone_number
  where phone_number.workspace_id = new.workspace_id
    and phone_number.deleted_at is null
    and phone_number.id <> new.id;

  if v_number_count >= v_limit then
    raise exception using
      errcode = '23514',
      message = 'This workspace already has the maximum number of phone numbers.';
  end if;

  return new;
end;
$$;

create trigger phone_numbers_enforce_limit
before insert or update of deleted_at on public.phone_numbers
for each row execute function private.enforce_phone_number_limit();

create or replace function private.normalize_campaign_template(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text;
  v_without_variables text;
begin
  v_body := pg_catalog.btrim(coalesce(p_body, ''));
  v_body := pg_catalog.regexp_replace(
    v_body,
    '{{[[:space:]]*first_name[[:space:]]*}}',
    '{{first_name}}',
    'g'
  );
  v_body := pg_catalog.regexp_replace(
    v_body,
    '{{[[:space:]]*last_name[[:space:]]*}}',
    '{{last_name}}',
    'g'
  );
  v_body := pg_catalog.regexp_replace(
    v_body,
    '{{[[:space:]]*company[[:space:]]*}}',
    '{{company}}',
    'g'
  );

  v_without_variables := pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(v_body, '{{first_name}}', ''),
      '{{last_name}}',
      ''
    ),
    '{{company}}',
    ''
  );

  if v_body = '' or v_without_variables ~ '{{|}}' then
    raise exception using
      errcode = '22023',
      message = 'Campaign messages must use only supported contact variables.';
  end if;

  return v_body;
end;
$$;

create or replace function private.render_campaign_template(
  p_body text,
  p_first_name text,
  p_last_name text,
  p_company text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.replace(
    pg_catalog.replace(
      pg_catalog.replace(
        p_body,
        '{{first_name}}',
        coalesce(p_first_name, '')
      ),
      '{{last_name}}',
      coalesce(p_last_name, '')
    ),
    '{{company}}',
    coalesce(p_company, '')
  );
$$;

create or replace function private.estimate_sms_segments(p_body text)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_character text;
  v_gsm_basic text :=
    '@£$¥èéùìòÇ' || E'\n' || 'Øø' || E'\r'
    || 'ÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&''()*+,-./0123456789:;<=>?¡'
    || 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
  v_gsm_extended text := '^{}' || E'\\' || '[~]|€';
  v_gsm_units integer := 0;
  v_index integer;
  v_is_gsm boolean := true;
  v_length integer;
  v_unicode_units integer := 0;
begin
  v_length := pg_catalog.char_length(p_body);
  if v_length = 0 then
    return 0;
  end if;

  for v_index in 1..v_length loop
    v_character := pg_catalog.substr(p_body, v_index, 1);

    if pg_catalog.strpos(v_gsm_basic, v_character) > 0 then
      v_gsm_units := v_gsm_units + 1;
    elsif pg_catalog.strpos(v_gsm_extended, v_character) > 0 then
      v_gsm_units := v_gsm_units + 2;
    else
      v_is_gsm := false;
    end if;

    v_unicode_units := v_unicode_units + case
      when pg_catalog.ascii(v_character) > 65535 then 2
      else 1
    end;
  end loop;

  if v_is_gsm then
    if v_gsm_units <= 160 then
      return 1;
    end if;
    return pg_catalog.ceil(v_gsm_units::numeric / 153)::integer;
  end if;

  if v_unicode_units <= 70 then
    return 1;
  end if;
  return pg_catalog.ceil(v_unicode_units::numeric / 67)::integer;
end;
$$;

create or replace function private.replace_campaign_steps(
  p_campaign_id uuid,
  p_steps jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text;
  v_item record;
  v_step_count integer;
  v_wait_text text;
  v_wait_days integer;
begin
  if p_steps is null or pg_catalog.jsonb_typeof(p_steps) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Campaign steps must be provided as an array.';
  end if;

  v_step_count := pg_catalog.jsonb_array_length(p_steps);
  if v_step_count < 1 or v_step_count > 3 then
    raise exception using
      errcode = '22023',
      message = 'A campaign must contain between one and three messages.';
  end if;

  delete from public.campaign_steps
  where campaign_id = p_campaign_id;

  for v_item in
    select step.value, step.ordinality
    from pg_catalog.jsonb_array_elements(p_steps)
      with ordinality as step(value, ordinality)
    order by step.ordinality
  loop
    if pg_catalog.jsonb_typeof(v_item.value) <> 'object' then
      raise exception using
        errcode = '22023',
        message = 'Each campaign step must be an object.';
    end if;

    v_body := private.normalize_campaign_template(v_item.value ->> 'body');
    v_wait_text := coalesce(
      v_item.value ->> 'wait_days_after_previous',
      v_item.value ->> 'waitDaysAfterPrevious'
    );

    if v_item.ordinality = 1 then
      if v_wait_text is not null and v_wait_text not in ('', '0') then
        raise exception using
          errcode = '22023',
          message = 'The first campaign message cannot have a delay.';
      end if;
      v_wait_days := 0;
    else
      if v_wait_text is null or v_wait_text !~ '^[0-9]+$' then
        raise exception using
          errcode = '22023',
          message = 'Campaign delays must be whole days from 1 through 365.';
      end if;
      v_wait_days := v_wait_text::integer;
      if v_wait_days < 1 or v_wait_days > 365 then
        raise exception using
          errcode = '22023',
          message = 'Campaign delays must be whole days from 1 through 365.';
      end if;
    end if;

    insert into public.campaign_steps (
      campaign_id,
      step_order,
      body,
      wait_days_after_previous
    )
    values (
      p_campaign_id,
      v_item.ordinality::smallint,
      v_body,
      v_wait_days
    );
  end loop;
end;
$$;

create or replace function private.release_reserved_message(
  p_message_id uuid,
  p_next_dispatch_state text,
  p_failure_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_reserved_usage integer;
begin
  if p_next_dispatch_state not in ('pending', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'Invalid reservation release state.';
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found
    or v_message.dispatch_state <> 'reserved'
    or v_message.dispatch_started_at is not null
  then
    return;
  end if;

  select usage.reserved_outbound_segments
  into v_reserved_usage
  from public.billing_period_usage as usage
  where usage.billing_period_id = v_message.reserved_billing_period_id
  for update;

  if v_reserved_usage < v_message.reserved_segments then
    raise exception using
      errcode = '23514',
      message = 'Reserved SMS usage is inconsistent.';
  end if;

  update public.billing_period_usage
  set reserved_outbound_segments =
    reserved_outbound_segments - v_message.reserved_segments
  where billing_period_id = v_message.reserved_billing_period_id;

  update public.messages
  set
    dispatch_state = p_next_dispatch_state,
    reserved_segments = 0,
    reservation_token = null,
    reserved_billing_period_id = null,
    reserved_at = null,
    reservation_released_at = pg_catalog.now(),
    failed_at = case
      when p_next_dispatch_state = 'failed' then pg_catalog.now()
      else null
    end,
    failure_code = p_failure_code
  where id = p_message_id;
end;
$$;

create or replace function private.complete_campaigns_without_active_recipients(
  p_campaign_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.campaigns as campaign
  set
    status = 'finished',
    finished_at = pg_catalog.now(),
    paused_at = null
  where campaign.id = p_campaign_id
    and campaign.status = 'active'
    and campaign.deleted_at is null
    and not exists (
      select 1
      from public.campaign_recipients as recipient
      where recipient.campaign_id = campaign.id
        and recipient.state = 'active'
    )
    and not exists (
      select 1
      from public.messages as message
      where message.campaign_id = campaign.id
        and message.dispatch_state = 'dispatch_unknown'
    );
end;
$$;

create or replace function private.compute_campaign_launch_assessment(
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_sequence_count integer;
  v_current_effective integer;
  v_current_overage integer;
  v_deleted_count integer;
  v_duplicate_count integer;
  v_eligible_count integer;
  v_eligible_ids uuid[];
  v_estimated_first_step integer;
  v_found_count integer;
  v_included_segments integer;
  v_large_threshold integer;
  v_new_overage integer;
  v_opted_out_count integer;
  v_overage_threshold integer;
  v_period_id uuid;
  v_projected_overage integer;
  v_projected_usage integer;
  v_reasons jsonb := '[]'::jsonb;
  v_selected_count integer;
  v_skipped jsonb;
  v_unique_count integer;
  v_workspace_id uuid;
begin
  if p_contact_ids is null
    or pg_catalog.cardinality(p_contact_ids) = 0
    or pg_catalog.array_position(p_contact_ids, null::uuid) is not null
  then
    raise exception using
      errcode = '22023',
      message = 'Select at least one contact.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null;

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Campaign not found.';
  end if;

  v_selected_count := pg_catalog.cardinality(p_contact_ids);

  select count(distinct selected.contact_id)::integer
  into v_unique_count
  from pg_catalog.unnest(p_contact_ids) as selected(contact_id);

  select count(*)::integer
  into v_found_count
  from public.contacts as contact
  where contact.workspace_id = v_workspace_id
    and contact.id = any(p_contact_ids);

  if v_found_count <> v_unique_count then
    raise exception using
      errcode = '22023',
      message = 'One or more selected contacts are unavailable.';
  end if;

  v_duplicate_count := v_selected_count - v_unique_count;
  v_period_id := private.ensure_current_billing_period(
    v_workspace_id,
    pg_catalog.now()
  );

  select
    period.included_segments_snapshot,
    usage.actual_outbound_segments + usage.reserved_outbound_segments,
    plan.large_campaign_recipient_threshold,
    plan.large_campaign_overage_credit_threshold
  into
    v_included_segments,
    v_current_effective,
    v_large_threshold,
    v_overage_threshold
  from public.billing_periods as period
  join public.billing_period_usage as usage
    on usage.billing_period_id = period.id
  join public.billing_plans as plan
    on plan.id = period.billing_plan_id
  where period.id = v_period_id;

  with selected as (
    select distinct selected_contact.contact_id
    from pg_catalog.unnest(p_contact_ids) as selected_contact(contact_id)
  ),
  classified as (
    select
      contact.id as contact_id,
      case
        when contact.deleted_at is not null then 'deleted'
        when exists (
          select 1
          from public.suppressions as suppression
          where suppression.workspace_id = contact.workspace_id
            and suppression.phone_e164 = contact.phone_e164
        ) then 'opted_out'
        when exists (
          select 1
          from public.campaign_recipients as active_recipient
          where active_recipient.workspace_id = contact.workspace_id
            and active_recipient.contact_id = contact.id
            and (
              active_recipient.state = 'active'
              or (
                active_recipient.state = 'stopped'
                and active_recipient.stop_reason = 'dispatch_unknown'
              )
            )
        ) then 'active_sequence'
        else null
      end as reason,
      private.estimate_sms_segments(
        private.render_campaign_template(
          first_step.body,
          contact.first_name,
          contact.last_name,
          contact.company
        )
      ) as estimated_segments
    from selected
    join public.contacts as contact on contact.id = selected.contact_id
    cross join lateral (
      select step.body
      from public.campaign_steps as step
      where step.campaign_id = p_campaign_id
        and step.step_order = 1
    ) as first_step
    where contact.workspace_id = v_workspace_id
  )
  select
    count(*) filter (where reason = 'deleted')::integer,
    count(*) filter (where reason = 'opted_out')::integer,
    count(*) filter (where reason = 'active_sequence')::integer,
    count(*) filter (where reason is null)::integer,
    coalesce(sum(estimated_segments) filter (where reason is null), 0)::integer,
    coalesce(
      array_agg(contact_id order by contact_id) filter (where reason is null),
      '{}'::uuid[]
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object('contact_id', contact_id, 'reason', reason)
        order by contact_id
      ) filter (where reason is not null),
      '[]'::jsonb
    )
  into
    v_deleted_count,
    v_opted_out_count,
    v_active_sequence_count,
    v_eligible_count,
    v_estimated_first_step,
    v_eligible_ids,
    v_skipped
  from classified;

  v_projected_usage := v_current_effective + v_estimated_first_step;
  v_current_overage := greatest(
    0,
    v_current_effective - v_included_segments
  );
  v_projected_overage := greatest(
    0,
    v_projected_usage - v_included_segments
  );
  v_new_overage := v_projected_overage - v_current_overage;

  if v_eligible_count >= v_large_threshold then
    v_reasons := v_reasons || '"large_volume"'::jsonb;
  end if;
  if v_new_overage > 0 and v_new_overage >= v_overage_threshold then
    v_reasons := v_reasons || '"possible_overage"'::jsonb;
  end if;

  return jsonb_build_object(
    'selected_count', v_selected_count,
    'eligible_recipient_count', v_eligible_count,
    'skipped_count',
      v_duplicate_count + v_deleted_count + v_opted_out_count + v_active_sequence_count,
    'duplicate_selection_count', v_duplicate_count,
    'deleted_count', v_deleted_count,
    'opted_out_count', v_opted_out_count,
    'active_sequence_count', v_active_sequence_count,
    'eligible_contact_ids', to_jsonb(v_eligible_ids),
    'skipped', v_skipped,
    'estimated_first_step_credits', v_estimated_first_step,
    'current_effective_usage_credits', v_current_effective,
    'included_credits', v_included_segments,
    'included_credits_remaining',
      greatest(0, v_included_segments - v_current_effective),
    'estimated_new_overage_credits', v_new_overage,
    'projected_usage_credits', v_projected_usage,
    'large_campaign_recipient_threshold', v_large_threshold,
    'large_campaign_overage_credit_threshold', v_overage_threshold,
    'requires_confirmation', pg_catalog.jsonb_array_length(v_reasons) > 0,
    'reasons', v_reasons
  );
end;
$$;

create or replace function public.create_campaign_draft(
  p_workspace_id uuid,
  p_name text,
  p_steps jsonb,
  p_phone_number_id uuid default null
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if p_phone_number_id is not null and not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = p_phone_number_id
      and phone_number.workspace_id = p_workspace_id
      and phone_number.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Phone number not found.';
  end if;

  insert into public.campaigns (
    workspace_id,
    phone_number_id,
    name
  )
  values (
    p_workspace_id,
    p_phone_number_id,
    v_name
  )
  returning * into v_campaign;

  perform private.replace_campaign_steps(v_campaign.id, p_steps);
  return v_campaign;
end;
$$;

create or replace function public.update_campaign_draft(
  p_campaign_id uuid,
  p_name text,
  p_steps jsonb,
  p_phone_number_id uuid default null
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_name text;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if v_campaign.status <> 'draft' then
    raise exception using
      errcode = '55000',
      message = 'Only draft campaigns can change messages or recipients.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if p_phone_number_id is not null and not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = p_phone_number_id
      and phone_number.workspace_id = v_workspace_id
      and phone_number.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Phone number not found.';
  end if;

  update public.campaigns
  set
    name = v_name,
    phone_number_id = p_phone_number_id
  where id = p_campaign_id
  returning * into v_campaign;

  perform private.replace_campaign_steps(p_campaign_id, p_steps);
  return v_campaign;
end;
$$;

create or replace function public.save_campaign_draft(
  p_workspace_id uuid,
  p_campaign_id uuid,
  p_name text,
  p_steps jsonb,
  p_phone_number_id uuid,
  p_contact_ids uuid[]
)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_contact_id uuid;
  v_distinct_contact_count integer;
  v_found_contact_count integer;
begin
  if p_contact_ids is not null
    and pg_catalog.array_position(p_contact_ids, null::uuid) is not null
  then
    raise exception using
      errcode = '22023',
      message = 'Campaign contact selection is invalid.';
  end if;

  select count(distinct selected.contact_id)::integer
  into v_distinct_contact_count
  from pg_catalog.unnest(coalesce(p_contact_ids, '{}'::uuid[]))
    as selected(contact_id);

  select count(*)::integer
  into v_found_contact_count
  from public.contacts as contact
  where contact.workspace_id = p_workspace_id
    and contact.id = any(coalesce(p_contact_ids, '{}'::uuid[]));

  if v_found_contact_count <> v_distinct_contact_count then
    raise exception using
      errcode = '22023',
      message = 'One or more selected contacts are unavailable.';
  end if;

  perform 1
  from public.contacts as contact
  where contact.workspace_id = p_workspace_id
    and contact.id = any(coalesce(p_contact_ids, '{}'::uuid[]))
  order by contact.id
  for update;

  if p_campaign_id is null then
    v_campaign := public.create_campaign_draft(
      p_workspace_id,
      p_name,
      p_steps,
      p_phone_number_id
    );
  else
    v_campaign := public.update_campaign_draft(
      p_campaign_id,
      p_name,
      p_steps,
      p_phone_number_id
    );

    if v_campaign.workspace_id <> p_workspace_id then
      raise exception using
        errcode = 'P0002',
        message = 'Campaign not found.';
    end if;
  end if;

  delete from public.campaign_draft_contacts
  where campaign_id = v_campaign.id;

  foreach v_contact_id in array coalesce(p_contact_ids, '{}'::uuid[])
  loop
    insert into public.campaign_draft_contacts (campaign_id, contact_id)
    values (v_campaign.id, v_contact_id)
    on conflict (campaign_id, contact_id) do nothing;
  end loop;

  return v_campaign;
end;
$$;

create or replace function public.assess_campaign_launch(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_status text;
  v_contact_ids uuid[];
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select campaign.status
  into v_campaign_status
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and workspace.owner_id = (select auth.uid());

  if v_campaign_status is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;
  if v_campaign_status <> 'draft' then
    raise exception using errcode = '55000', message = 'Campaign is not a draft.';
  end if;

  select coalesce(array_agg(draft_contact.contact_id), '{}'::uuid[])
  into v_contact_ids
  from public.campaign_draft_contacts as draft_contact
  where draft_contact.campaign_id = p_campaign_id;

  return private.compute_campaign_launch_assessment(
    p_campaign_id,
    v_contact_ids
  );
end;
$$;

create or replace function public.launch_campaign(
  p_campaign_id uuid,
  p_confirmed_contact_count integer default null,
  p_confirmed_large_launch boolean default false,
  p_consent_confirmed boolean default false,
  p_confirmed_assessment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assessment jsonb;
  v_campaign public.campaigns;
  v_confirmation_snapshot jsonb;
  v_contact_ids uuid[];
  v_eligible_count integer;
  v_now timestamptz := pg_catalog.now();
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_consent_confirmed is distinct from true then
    raise exception using
      errcode = '22023',
      message = 'Confirm that these contacts consented to receive messages.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if v_campaign.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Campaign is not a draft.';
  end if;

  if v_campaign.phone_number_id is null or not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = v_campaign.phone_number_id
      and phone_number.workspace_id = v_workspace_id
      and phone_number.status = 'ready'
      and phone_number.deleted_at is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'This phone number is not ready for messaging yet.';
  end if;

  if not exists (
    select 1
    from private.workspace_messaging_controls as control
    where control.workspace_id = v_workspace_id
      and control.messaging_enabled
  ) then
    raise exception using
      errcode = '55000',
      message = 'Messaging is not available for this workspace.';
  end if;

  perform 1
  from public.contacts as contact
  where contact.workspace_id = v_workspace_id
    and contact.id in (
      select draft_contact.contact_id
      from public.campaign_draft_contacts as draft_contact
      where draft_contact.campaign_id = p_campaign_id
    )
  order by contact.id
  for update;

  select coalesce(array_agg(draft_contact.contact_id), '{}'::uuid[])
  into v_contact_ids
  from public.campaign_draft_contacts as draft_contact
  where draft_contact.campaign_id = p_campaign_id;

  v_assessment := private.compute_campaign_launch_assessment(
    p_campaign_id,
    v_contact_ids
  );
  v_eligible_count := (v_assessment ->> 'eligible_recipient_count')::integer;
  v_confirmation_snapshot := jsonb_build_object(
    'eligible_recipient_count', v_assessment -> 'eligible_recipient_count',
    'estimated_first_step_credits', v_assessment -> 'estimated_first_step_credits',
    'current_effective_usage_credits', v_assessment -> 'current_effective_usage_credits',
    'included_credits', v_assessment -> 'included_credits',
    'included_credits_remaining', v_assessment -> 'included_credits_remaining',
    'estimated_new_overage_credits', v_assessment -> 'estimated_new_overage_credits',
    'projected_usage_credits', v_assessment -> 'projected_usage_credits',
    'requires_confirmation', v_assessment -> 'requires_confirmation',
    'reasons', v_assessment -> 'reasons'
  );

  if v_eligible_count = 0 then
    raise exception using
      errcode = '22023',
      message = 'No selected contacts are eligible for this campaign.';
  end if;
  if p_confirmed_contact_count is not null
    and p_confirmed_contact_count <> v_eligible_count
  then
    raise exception using
      errcode = '40001',
      message = 'Campaign eligibility changed. Review the launch again.';
  end if;
  if (v_assessment ->> 'requires_confirmation')::boolean
    and p_confirmed_large_launch is distinct from true
  then
    raise exception using
      errcode = 'P0001',
      message = 'Campaign launch confirmation is required.';
  end if;
  if (v_assessment ->> 'requires_confirmation')::boolean
    and not (
      coalesce(p_confirmed_assessment, '{}'::jsonb)
      @> v_confirmation_snapshot
    )
  then
    raise exception using
      errcode = '40001',
      message = 'Campaign launch assessment changed. Review the launch again.';
  end if;

  insert into public.consent_confirmations (
    workspace_id,
    campaign_id,
    confirmed_by,
    recipient_count,
    consent_confirmed,
    large_launch_confirmed,
    launch_assessment,
    confirmed_at
  )
  values (
    v_workspace_id,
    p_campaign_id,
    (select auth.uid()),
    v_eligible_count,
    true,
    (
      (v_assessment ->> 'requires_confirmation')::boolean
      and p_confirmed_large_launch is true
    ),
    v_assessment,
    v_now
  );

  insert into public.campaign_recipients (
    workspace_id,
    campaign_id,
    contact_id,
    state,
    current_step_order,
    next_send_at,
    enrolled_at
  )
  select
    v_workspace_id,
    p_campaign_id,
    eligible.value::uuid,
    'active',
    1,
    v_now,
    v_now
  from pg_catalog.jsonb_array_elements_text(
    v_assessment -> 'eligible_contact_ids'
  ) as eligible(value);

  update public.campaigns
  set
    status = 'active',
    launched_at = v_now,
    paused_at = null,
    finished_at = null
  where id = p_campaign_id
  returning * into v_campaign;

  return v_assessment || jsonb_build_object(
    'campaign_id', p_campaign_id,
    'enrolled_recipient_count', v_eligible_count,
    'launched_at', v_now
  );
end;
$$;

create or replace function public.pause_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_message_id uuid;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  perform 1 from public.workspaces where id = v_workspace_id for update;
  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if v_campaign.status <> 'active' then
    raise exception using errcode = '55000', message = 'Only active campaigns can be paused.';
  end if;

  for v_message_id in
    select message.id
    from public.messages as message
    where message.campaign_id = p_campaign_id
      and message.dispatch_state = 'reserved'
      and message.dispatch_started_at is null
    order by message.id
    for update
  loop
    perform private.release_reserved_message(v_message_id, 'pending', null);
  end loop;

  update public.campaigns
  set
    status = 'paused',
    paused_at = pg_catalog.now()
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.resume_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_now timestamptz := pg_catalog.now();
  v_pause_duration interval;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  perform 1 from public.workspaces where id = v_workspace_id for update;
  select campaign.* into v_campaign
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if v_campaign.status <> 'paused' or v_campaign.paused_at is null then
    raise exception using errcode = '55000', message = 'Campaign is not paused.';
  end if;

  v_pause_duration := v_now - v_campaign.paused_at;

  update public.campaign_recipients
  set next_send_at = next_send_at + v_pause_duration
  where campaign_id = p_campaign_id
    and state = 'active'
    and next_send_at is not null;

  update public.campaigns
  set
    status = 'active',
    paused_at = null
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function private.is_within_workspace_send_window(
  p_workspace_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (p_at at time zone workspace.timezone)::time
      >= workspace.send_window_start
    and
    (p_at at time zone workspace.timezone)::time
      < workspace.send_window_end
  from public.workspaces as workspace
  where workspace.id = p_workspace_id;
$$;

create or replace function private.reserve_due_campaign_messages(
  p_workspace_id uuid,
  p_limit integer default 100,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  campaign_recipient_id uuid,
  contact_id uuid,
  phone_number_id uuid,
  step_order smallint,
  body text,
  reservation_token uuid,
  estimated_segments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_usage integer;
  v_body text;
  v_candidate record;
  v_estimate integer;
  v_existing public.messages;
  v_message_id uuid;
  v_period_id uuid;
  v_reserved_usage integer;
  v_safety_cap integer;
  v_token uuid;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Reservation batch size must be between 1 and 1,000.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  v_period_id := private.ensure_current_billing_period(
    p_workspace_id,
    p_now
  );

  select
    usage.actual_outbound_segments,
    usage.reserved_outbound_segments,
    coalesce(
      control.safety_cap_segments_override,
      period.safety_cap_segments_snapshot
    )
  into
    v_actual_usage,
    v_reserved_usage,
    v_safety_cap
  from public.billing_period_usage as usage
  join public.billing_periods as period
    on period.id = usage.billing_period_id
  join private.workspace_messaging_controls as control
    on control.workspace_id = usage.workspace_id
  where usage.billing_period_id = v_period_id
  for update of usage;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace usage period not found.';
  end if;

  for v_candidate in
    select
      recipient.id as recipient_id,
      recipient.campaign_id,
      recipient.contact_id,
      recipient.current_step_order,
      recipient.next_send_at,
      campaign.phone_number_id,
      step.body as template_body,
      contact.first_name,
      contact.last_name,
      contact.company
    from public.campaign_recipients as recipient
    join public.campaigns as campaign
      on campaign.id = recipient.campaign_id
    join public.contacts as contact
      on contact.id = recipient.contact_id
    join public.campaign_steps as step
      on step.campaign_id = recipient.campaign_id
      and step.step_order = recipient.current_step_order
    join public.phone_numbers as phone_number
      on phone_number.id = campaign.phone_number_id
    join private.workspace_messaging_controls as control
      on control.workspace_id = recipient.workspace_id
    where recipient.workspace_id = p_workspace_id
      and recipient.state = 'active'
      and recipient.next_send_at is not null
      and recipient.next_send_at <= p_now
      and campaign.status = 'active'
      and campaign.deleted_at is null
      and contact.deleted_at is null
      and phone_number.status = 'ready'
      and phone_number.deleted_at is null
      and control.messaging_enabled
      and private.is_within_campaign_send_window(
        campaign.id,
        p_now
      )
      and not exists (
        select 1
        from public.suppressions as suppression
        where suppression.workspace_id = contact.workspace_id
          and suppression.phone_e164 = contact.phone_e164
      )
      and not exists (
        select 1
        from public.messages as existing_message
        where existing_message.campaign_recipient_id = recipient.id
          and existing_message.step_order = recipient.current_step_order
          and existing_message.dispatch_state <> 'pending'
      )
    order by recipient.next_send_at, recipient.id
    for update of recipient skip locked
    limit p_limit
  loop
    v_body := private.render_campaign_template(
      v_candidate.template_body,
      v_candidate.first_name,
      v_candidate.last_name,
      v_candidate.company
    );
    v_estimate := private.estimate_sms_segments(v_body);

    if v_actual_usage + v_reserved_usage + v_estimate > v_safety_cap then
      continue;
    end if;

    select message.*
    into v_existing
    from public.messages as message
    where message.campaign_recipient_id = v_candidate.recipient_id
      and message.step_order = v_candidate.current_step_order
    for update;

    if found and v_existing.dispatch_state <> 'pending' then
      continue;
    end if;

    v_token := gen_random_uuid();

    if found then
      update public.messages
      set
        body = v_body,
        dispatch_state = 'reserved',
        estimated_segments = v_estimate,
        reserved_segments = v_estimate,
        reserved_billing_period_id = v_period_id,
        reservation_token = v_token,
        scheduled_for = v_candidate.next_send_at,
        reserved_at = p_now,
        reservation_released_at = null,
        failed_at = null,
        failure_code = null
      where id = v_existing.id
      returning id into v_message_id;
    else
      insert into public.messages (
        workspace_id,
        contact_id,
        phone_number_id,
        campaign_id,
        campaign_recipient_id,
        step_order,
        direction,
        body,
        dispatch_state,
        estimated_segments,
        reserved_segments,
        reserved_billing_period_id,
        reservation_token,
        scheduled_for,
        reserved_at
      )
      values (
        p_workspace_id,
        v_candidate.contact_id,
        v_candidate.phone_number_id,
        v_candidate.campaign_id,
        v_candidate.recipient_id,
        v_candidate.current_step_order,
        'outbound',
        v_body,
        'reserved',
        v_estimate,
        v_estimate,
        v_period_id,
        v_token,
        v_candidate.next_send_at,
        p_now
      )
      returning id into v_message_id;
    end if;

    update public.billing_period_usage
    set reserved_outbound_segments = reserved_outbound_segments + v_estimate
    where billing_period_id = v_period_id;

    v_reserved_usage := v_reserved_usage + v_estimate;

    return query
    select
      v_message_id,
      p_workspace_id,
      v_candidate.campaign_id,
      v_candidate.recipient_id,
      v_candidate.contact_id,
      v_candidate.phone_number_id,
      v_candidate.current_step_order,
      v_body,
      v_token,
      v_estimate;
  end loop;
end;
$$;

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
  v_campaign public.campaigns;
  v_contact public.contacts;
  v_effective_usage integer;
  v_message public.messages;
  v_recipient public.campaign_recipients;
  v_safety_cap integer;
  v_workspace_id uuid;
begin
  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    return jsonb_build_object(
      'authorized', false,
      'code', 'message_not_found'
    );
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  join public.messages as message on message.campaign_id = campaign.id
  where message.id = p_message_id
  for update of campaign;

  select recipient.*
  into v_recipient
  from public.campaign_recipients as recipient
  join public.messages as message
    on message.campaign_recipient_id = recipient.id
  where message.id = p_message_id
  for update of recipient;

  select contact.*
  into v_contact
  from public.contacts as contact
  join public.messages as message on message.contact_id = contact.id
  where message.id = p_message_id
  for update of contact;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if v_message.dispatch_state <> 'reserved'
    or v_message.reservation_token is distinct from p_reservation_token
    or v_message.dispatch_started_at is not null
  then
    return jsonb_build_object(
      'authorized', false,
      'code', case
        when v_message.dispatch_state = 'dispatch_unknown'
          then 'dispatch_already_started'
        else 'reservation_not_valid'
      end,
      'dispatch_state', v_message.dispatch_state
    );
  end if;

  if v_campaign.id is null
    or v_campaign.deleted_at is not null
    or v_campaign.status in ('finished')
  then
    perform private.release_reserved_message(
      p_message_id,
      'failed',
      'campaign_deleted'
    );
    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_now,
      stop_reason = 'campaign_deleted',
      finished_at = null
    where id = v_recipient.id
      and state = 'active';
    return jsonb_build_object(
      'authorized', false,
      'code', 'campaign_unavailable'
    );
  end if;

  if v_campaign.status = 'paused' then
    perform private.release_reserved_message(p_message_id, 'pending', null);
    return jsonb_build_object(
      'authorized', false,
      'code', 'campaign_paused'
    );
  end if;

  if v_campaign.status <> 'active' then
    perform private.release_reserved_message(p_message_id, 'failed', 'failed');
    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_now,
      stop_reason = 'failed',
      finished_at = null
    where id = v_recipient.id
      and state = 'active';
    return jsonb_build_object(
      'authorized', false,
      'code', 'campaign_unavailable'
    );
  end if;

  if v_recipient.id is null
    or v_recipient.state <> 'active'
    or v_recipient.current_step_order <> v_message.step_order
  then
    perform private.release_reserved_message(
      p_message_id,
      'failed',
      'recipient_stopped'
    );
    return jsonb_build_object(
      'authorized', false,
      'code', 'recipient_stopped'
    );
  end if;

  if v_contact.id is null or v_contact.deleted_at is not null then
    perform private.release_reserved_message(
      p_message_id,
      'failed',
      'contact_deleted'
    );
    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_now,
      stop_reason = 'contact_deleted',
      finished_at = null
    where id = v_recipient.id;
    perform private.complete_campaigns_without_active_recipients(
      v_campaign.id
    );
    return jsonb_build_object(
      'authorized', false,
      'code', 'contact_unavailable'
    );
  end if;

  if exists (
    select 1
    from public.suppressions as suppression
    where suppression.workspace_id = v_contact.workspace_id
      and suppression.phone_e164 = v_contact.phone_e164
  ) then
    perform private.release_reserved_message(
      p_message_id,
      'failed',
      'contact_opted_out'
    );
    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_now,
      stop_reason = 'opt_out',
      finished_at = null
    where id = v_recipient.id;
    perform private.complete_campaigns_without_active_recipients(
      v_campaign.id
    );
    return jsonb_build_object(
      'authorized', false,
      'code', 'contact_opted_out'
    );
  end if;

  if not exists (
    select 1
    from private.workspace_messaging_controls as control
    where control.workspace_id = v_workspace_id
      and control.messaging_enabled
  ) then
    perform private.release_reserved_message(p_message_id, 'pending', null);
    return jsonb_build_object(
      'authorized', false,
      'code', 'messaging_unavailable'
    );
  end if;

  if not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = v_message.phone_number_id
      and phone_number.workspace_id = v_workspace_id
      and phone_number.status = 'ready'
      and phone_number.deleted_at is null
  ) then
    perform private.release_reserved_message(p_message_id, 'pending', null);
    return jsonb_build_object(
      'authorized', false,
      'code', 'phone_number_not_ready'
    );
  end if;

  if not private.is_within_campaign_send_window(v_campaign.id, p_now) then
    perform private.release_reserved_message(p_message_id, 'pending', null);
    return jsonb_build_object(
      'authorized', false,
      'code', 'outside_send_window'
    );
  end if;

  select
    usage.actual_outbound_segments + usage.reserved_outbound_segments,
    coalesce(
      control.safety_cap_segments_override,
      period.safety_cap_segments_snapshot
    )
  into v_effective_usage, v_safety_cap
  from public.billing_period_usage as usage
  join public.billing_periods as period
    on period.id = usage.billing_period_id
  join private.workspace_messaging_controls as control
    on control.workspace_id = usage.workspace_id
  where usage.billing_period_id = v_message.reserved_billing_period_id
  for update of usage;

  if v_effective_usage > v_safety_cap then
    perform private.release_reserved_message(p_message_id, 'pending', null);
    return jsonb_build_object(
      'authorized', false,
      'code', 'usage_safety_cap_reached'
    );
  end if;

  update public.messages
  set
    dispatch_state = 'dispatch_unknown',
    dispatch_started_at = p_now,
    failure_code = null
  where id = p_message_id;

  update public.campaign_recipients
  set
    state = 'stopped',
    next_send_at = null,
    stopped_at = p_now,
    stop_reason = 'dispatch_unknown',
    finished_at = null
  where id = v_recipient.id;

  return jsonb_build_object(
    'authorized', true,
    'message_id', v_message.id,
    'workspace_id', v_message.workspace_id,
    'campaign_id', v_message.campaign_id,
    'campaign_recipient_id', v_message.campaign_recipient_id,
    'contact_id', v_message.contact_id,
    'phone_number_id', v_message.phone_number_id,
    'to', v_contact.phone_e164,
    'from', (
      select phone_number.phone_e164
      from public.phone_numbers as phone_number
      where phone_number.id = v_message.phone_number_id
    ),
    'body', v_message.body,
    'reservation_token', v_message.reservation_token,
    'dispatch_state', 'dispatch_unknown'
  );
end;
$$;

create or replace function private.mark_message_accepted(
  p_message_id uuid,
  p_reservation_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_accepted_at timestamptz default pg_catalog.now()
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_included_snapshot integer;
  v_message public.messages;
  v_new_period_id uuid;
  v_next_usage_position bigint;
  v_old_reserved_usage integer;
  v_overage_snapshot bigint;
  v_recipient public.campaign_recipients;
  v_wait_days integer;
  v_workspace_id uuid;
begin
  if pg_catalog.btrim(coalesce(p_provider, '')) = '' then
    raise exception using errcode = '22023', message = 'Provider is required.';
  end if;

  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  join public.messages as message on message.campaign_id = campaign.id
  where message.id = p_message_id
  for update of campaign;

  select recipient.*
  into v_recipient
  from public.campaign_recipients as recipient
  join public.messages as message
    on message.campaign_recipient_id = recipient.id
  where message.id = p_message_id
  for update of recipient;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if v_message.reservation_token is distinct from p_reservation_token then
    raise exception using
      errcode = '55000',
      message = 'Message reservation is no longer valid.';
  end if;

  if v_message.dispatch_state = 'accepted' then
    return v_message;
  end if;

  if v_message.dispatch_state <> 'dispatch_unknown'
    or v_message.dispatch_started_at is null
  then
    raise exception using
      errcode = '55000',
      message = 'Message dispatch was not started.';
  end if;

  v_new_period_id := private.ensure_current_billing_period(
    v_workspace_id,
    p_accepted_at
  );

  perform 1
  from public.billing_period_usage as usage
  where usage.billing_period_id in (
    v_message.reserved_billing_period_id,
    v_new_period_id
  )
  order by usage.billing_period_id
  for update;

  if v_message.reserved_billing_period_id is distinct from v_new_period_id then
    select usage.reserved_outbound_segments
    into v_old_reserved_usage
    from public.billing_period_usage as usage
    where usage.billing_period_id = v_message.reserved_billing_period_id;

    if v_old_reserved_usage < v_message.reserved_segments then
      raise exception using
        errcode = '23514',
        message = 'Reserved SMS usage is inconsistent.';
    end if;

    update public.billing_period_usage
    set reserved_outbound_segments =
      reserved_outbound_segments - v_message.reserved_segments
    where billing_period_id = v_message.reserved_billing_period_id;

    update public.billing_period_usage
    set reserved_outbound_segments =
      reserved_outbound_segments + v_message.reserved_segments
    where billing_period_id = v_new_period_id;
  end if;

  update public.billing_period_usage
  set next_usage_position = next_usage_position + 1
  where billing_period_id = v_new_period_id
  returning next_usage_position into v_next_usage_position;

  select
    period.included_segments_snapshot,
    period.overage_price_micro_usd_snapshot
  into v_included_snapshot, v_overage_snapshot
  from public.billing_periods as period
  where period.id = v_new_period_id;

  update public.messages
  set
    dispatch_state = 'accepted',
    delivery_state = null,
    reserved_billing_period_id = v_new_period_id,
    billing_period_id = v_new_period_id,
    usage_position = v_next_usage_position,
    included_segments_snapshot = v_included_snapshot,
    overage_price_micro_usd_snapshot = v_overage_snapshot,
    accepted_at = p_accepted_at,
    sent_at = p_accepted_at,
    failed_at = null,
    failure_code = null
  where id = p_message_id
  returning * into v_message;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    nullif(pg_catalog.btrim(p_provider_message_id), ''),
    'accepted'
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = excluded.provider_message_id,
    provider_status = excluded.provider_status,
    provider_error_code = null,
    provider_error_message = null;

  select step.wait_days_after_previous
  into v_wait_days
  from public.campaign_steps as step
  where step.campaign_id = v_message.campaign_id
    and step.step_order = v_message.step_order + 1;

  if v_campaign.status = 'active'
    and v_campaign.deleted_at is null
    and v_recipient.state = 'stopped'
    and v_recipient.stop_reason = 'dispatch_unknown'
  then
    if v_wait_days is null then
      update public.campaign_recipients
      set
        state = 'finished',
        next_send_at = null,
        stopped_at = null,
        stop_reason = null,
        finished_at = p_accepted_at
      where id = v_recipient.id;
    else
      update public.campaign_recipients
      set
        state = 'active',
        current_step_order = current_step_order + 1,
        next_send_at = p_accepted_at
          + pg_catalog.make_interval(days => v_wait_days),
        stopped_at = null,
        stop_reason = null,
        finished_at = null
      where id = v_recipient.id;
    end if;
  elsif v_recipient.state = 'stopped'
    and v_recipient.stop_reason = 'dispatch_unknown'
  then
    update public.campaign_recipients
    set
      next_send_at = null,
      stopped_at = p_accepted_at,
      stop_reason = 'campaign_deleted',
      finished_at = null
    where id = v_recipient.id;
  end if;

  perform private.complete_campaigns_without_active_recipients(
    v_message.campaign_id
  );

  return v_message;
end;
$$;

create or replace function private.release_unresolved_message_reservation(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_reserved_usage integer;
begin
  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found or v_message.reserved_segments = 0 then
    return;
  end if;

  if v_message.reserved_billing_period_id is null then
    raise exception using
      errcode = '23514',
      message = 'Reserved SMS usage is missing its billing period.';
  end if;

  select usage.reserved_outbound_segments
  into v_reserved_usage
  from public.billing_period_usage as usage
  where usage.billing_period_id = v_message.reserved_billing_period_id
  for update;

  if v_reserved_usage < v_message.reserved_segments then
    raise exception using
      errcode = '23514',
      message = 'Reserved SMS usage is inconsistent.';
  end if;

  update public.billing_period_usage
  set reserved_outbound_segments =
    reserved_outbound_segments - v_message.reserved_segments
  where billing_period_id = v_message.reserved_billing_period_id;

  update public.messages
  set
    reserved_segments = 0,
    reserved_billing_period_id = null,
    reservation_released_at = pg_catalog.now()
  where id = p_message_id;
end;
$$;

create or replace function private.mark_message_failed(
  p_message_id uuid,
  p_reservation_token uuid,
  p_provider text,
  p_provider_message_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null,
  p_failed_at timestamptz default pg_catalog.now()
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_message public.messages;
  v_recipient_id uuid;
  v_workspace_id uuid;
begin
  if pg_catalog.btrim(coalesce(p_provider, '')) = '' then
    raise exception using errcode = '22023', message = 'Provider is required.';
  end if;

  select
    message.workspace_id,
    message.campaign_id,
    message.campaign_recipient_id
  into v_workspace_id, v_campaign_id, v_recipient_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  perform 1
  from public.campaigns as campaign
  where campaign.id = v_campaign_id
  for update;

  perform 1
  from public.campaign_recipients as recipient
  where recipient.id = v_recipient_id
  for update;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if v_message.reservation_token is distinct from p_reservation_token then
    raise exception using
      errcode = '55000',
      message = 'Message reservation is no longer valid.';
  end if;

  if v_message.dispatch_state = 'failed' then
    return v_message;
  end if;

  if v_message.dispatch_state <> 'dispatch_unknown' then
    raise exception using
      errcode = '55000',
      message = 'Message dispatch was not started.';
  end if;

  perform private.release_unresolved_message_reservation(p_message_id);

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = p_failed_at,
    failure_code = 'message_send_failed'
  where id = p_message_id
  returning * into v_message;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status,
    provider_error_code,
    provider_error_message
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    nullif(pg_catalog.btrim(p_provider_message_id), ''),
    'failed',
    p_provider_error_code,
    p_provider_error_message
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = excluded.provider_message_id,
    provider_status = excluded.provider_status,
    provider_error_code = excluded.provider_error_code,
    provider_error_message = excluded.provider_error_message;

  update public.campaign_recipients
  set
    state = 'stopped',
    next_send_at = null,
    stopped_at = p_failed_at,
    stop_reason = 'failed',
    finished_at = null
  where id = v_recipient_id;

  perform private.complete_campaigns_without_active_recipients(v_campaign_id);
  return v_message;
end;
$$;

create or replace function private.record_dispatch_unknown_details(
  p_message_id uuid,
  p_reservation_token uuid,
  p_provider text,
  p_provider_message_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  if pg_catalog.btrim(coalesce(p_provider, '')) = '' then
    raise exception using errcode = '22023', message = 'Provider is required.';
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;
  if v_message.reservation_token is distinct from p_reservation_token
    or v_message.dispatch_state <> 'dispatch_unknown'
  then
    raise exception using
      errcode = '55000',
      message = 'Message is not awaiting dispatch reconciliation.';
  end if;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status,
    provider_error_code,
    provider_error_message
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    nullif(pg_catalog.btrim(p_provider_message_id), ''),
    'dispatch_unknown',
    p_provider_error_code,
    p_provider_error_message
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = excluded.provider_message_id,
    provider_status = excluded.provider_status,
    provider_error_code = excluded.provider_error_code,
    provider_error_message = excluded.provider_error_message;

  return v_message;
end;
$$;

create or replace function private.record_message_actual_segments(
  p_message_id uuid,
  p_num_segments integer
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
  v_reserved_usage integer;
  v_workspace_id uuid;
begin
  if p_num_segments < 1 then
    raise exception using
      errcode = '22023',
      message = 'Actual SMS segments must be positive.';
  end if;

  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if v_message.num_segments is not null then
    if v_message.num_segments <> p_num_segments then
      raise exception using
        errcode = '23514',
        message = 'Actual SMS segments cannot be changed after reconciliation.';
    end if;
    return v_message;
  end if;

  if v_message.dispatch_state <> 'accepted'
    or v_message.billing_period_id is null
    or v_message.usage_position is null
  then
    raise exception using
      errcode = '55000',
      message = 'Only an accepted message can reconcile actual SMS usage.';
  end if;

  select usage.reserved_outbound_segments
  into v_reserved_usage
  from public.billing_period_usage as usage
  where usage.billing_period_id = v_message.billing_period_id
  for update;

  if v_reserved_usage < v_message.reserved_segments then
    raise exception using
      errcode = '23514',
      message = 'Reserved SMS usage is inconsistent.';
  end if;

  update public.billing_period_usage
  set
    reserved_outbound_segments =
      reserved_outbound_segments - v_message.reserved_segments,
    actual_outbound_segments =
      actual_outbound_segments + p_num_segments
  where billing_period_id = v_message.billing_period_id;

  update public.messages
  set
    num_segments = p_num_segments,
    reserved_segments = 0,
    reserved_billing_period_id = null,
    reservation_released_at = pg_catalog.now()
  where id = p_message_id
  returning * into v_message;

  return v_message;
end;
$$;

create or replace function private.record_message_delivery_state(
  p_message_id uuid,
  p_delivery_state text,
  p_at timestamptz default pg_catalog.now()
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_future_message_id uuid;
  v_message public.messages;
  v_recipient public.campaign_recipients;
  v_workspace_id uuid;
begin
  if p_delivery_state not in ('sent', 'delivered', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'Invalid SMS delivery state.';
  end if;

  select
    message.workspace_id,
    message.campaign_id
  into v_workspace_id, v_campaign_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  perform 1
  from public.campaigns as campaign
  where campaign.id = v_campaign_id
  for update;

  select recipient.*
  into v_recipient
  from public.campaign_recipients as recipient
  join public.messages as message
    on message.campaign_recipient_id = recipient.id
  where message.id = p_message_id
  for update of recipient;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  if v_message.dispatch_state <> 'accepted' then
    raise exception using
      errcode = '55000',
      message = 'Only an accepted message has an SMS delivery state.';
  end if;

  if v_message.delivery_state = 'failed'
    or (
      v_message.delivery_state = 'delivered'
      and p_delivery_state = 'sent'
    )
    or v_message.delivery_state = p_delivery_state
  then
    return v_message;
  end if;

  update public.messages
  set
    delivery_state = p_delivery_state,
    failed_at = case
      when p_delivery_state = 'failed' then p_at
      else failed_at
    end,
    failure_code = case
      when p_delivery_state = 'failed' then 'message_delivery_failed'
      else failure_code
    end
  where id = p_message_id
  returning * into v_message;

  if p_delivery_state = 'failed' then
    for v_future_message_id in
      select future_message.id
      from public.messages as future_message
      where future_message.campaign_recipient_id = v_recipient.id
        and future_message.step_order > v_message.step_order
        and future_message.dispatch_state = 'reserved'
        and future_message.dispatch_started_at is null
      order by future_message.step_order
      for update
    loop
      perform private.release_reserved_message(
        v_future_message_id,
        'failed',
        'previous_message_failed'
      );
    end loop;

    update public.messages
    set
      dispatch_state = 'failed',
      delivery_state = 'failed',
      failed_at = p_at,
      failure_code = 'previous_message_failed'
    where campaign_recipient_id = v_recipient.id
      and step_order > v_message.step_order
      and dispatch_state = 'pending';

    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_at,
      stop_reason = 'failed',
      finished_at = null
    where id = v_recipient.id
      and state in ('active', 'finished');

    perform private.complete_campaigns_without_active_recipients(
      v_campaign_id
    );
  end if;

  return v_message;
end;
$$;

create or replace function private.claim_message_reconciliation(
  p_limit integer default 100,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  campaign_recipient_id uuid,
  contact_id uuid,
  provider text,
  provider_message_id text,
  reservation_id uuid,
  billing_period_id uuid,
  usage_position bigint,
  reconciliation_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Reconciliation batch size must be between 1 and 1,000.';
  end if;

  return query
  with candidates as (
    select detail.message_id
    from private.message_provider_details as detail
    join public.messages as message on message.id = detail.message_id
    where message.dispatch_state = 'accepted'
      and message.billing_period_id is not null
      and message.usage_position is not null
      and detail.provider_message_id is not null
      and detail.reconciliation_state in ('pending', 'deferred')
      and (
        detail.reconciliation_next_attempt_at is null
        or detail.reconciliation_next_attempt_at <= p_now
      )
      and (
        message.num_segments is null
        or detail.provider_cost_pending
      )
    order by
      coalesce(detail.reconciliation_next_attempt_at, message.accepted_at),
      detail.message_id
    for update of detail skip locked
    limit p_limit
  ),
  claimed as (
    update private.message_provider_details as detail
    set
      reconciliation_state = 'claimed',
      reconciliation_token = gen_random_uuid(),
      reconciliation_claimed_at = p_now,
      reconciliation_attempt_count = reconciliation_attempt_count + 1,
      reconciliation_reason = null
    from candidates
    where detail.message_id = candidates.message_id
    returning
      detail.message_id,
      detail.provider,
      detail.provider_message_id,
      detail.reconciliation_token
  )
  select
    message.id,
    message.workspace_id,
    message.campaign_id,
    message.campaign_recipient_id,
    message.contact_id,
    claimed.provider,
    claimed.provider_message_id,
    message.reservation_token,
    message.billing_period_id,
    message.usage_position,
    claimed.reconciliation_token
  from claimed
  join public.messages as message on message.id = claimed.message_id;
end;
$$;

create or replace function private.complete_message_reconciliation(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_actual_segments integer,
  p_provider_cost_micro_usd bigint,
  p_provider_cost_pending boolean,
  p_reconciled_at timestamptz default pg_catalog.now()
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail private.message_provider_details;
  v_message public.messages;
  v_workspace_id uuid;
begin
  if p_actual_segments < 1 then
    raise exception using
      errcode = '22023',
      message = 'Actual SMS segments must be positive.';
  end if;
  if p_provider_cost_micro_usd is not null
    and p_provider_cost_micro_usd < 0
  then
    raise exception using
      errcode = '22023',
      message = 'Provider cost cannot be negative.';
  end if;

  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  where message.id = p_message_id;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
  for update;

  select detail.*
  into v_detail
  from private.message_provider_details as detail
  where detail.message_id = p_message_id
  for update;

  if not found
    or v_detail.reconciliation_token is distinct from p_reconciliation_token
    or v_detail.reconciliation_state not in ('claimed', 'deferred', 'complete')
  then
    raise exception using
      errcode = '55000',
      message = 'Reconciliation claim is no longer valid.';
  end if;

  if v_message.num_segments is not null
    and v_message.num_segments <> p_actual_segments
  then
    raise exception using
      errcode = '23514',
      message = 'Actual SMS segments cannot be changed after reconciliation.';
  end if;

  if v_detail.reconciliation_state = 'complete' then
    return v_message;
  end if;

  v_message := private.record_message_actual_segments(
    p_message_id,
    p_actual_segments
  );

  update private.message_provider_details
  set
    provider_cost_micro_usd = coalesce(
      p_provider_cost_micro_usd,
      provider_cost_micro_usd
    ),
    provider_cost_pending = p_provider_cost_pending,
    reconciliation_state = case
      when p_provider_cost_pending then 'deferred'
      else 'complete'
    end,
    reconciliation_next_attempt_at = case
      when p_provider_cost_pending
        then p_reconciled_at + interval '1 day'
      else null
    end,
    reconciliation_reason = case
      when p_provider_cost_pending then 'provider_cost_pending'
      else null
    end,
    reconciled_at = p_reconciled_at
  where message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function private.defer_message_reconciliation(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_reason text,
  p_deferred_at timestamptz default pg_catalog.now(),
  p_next_attempt_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason not in (
    'segments_pending',
    'segments_lookup_failed',
    'invalid_provider_response'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid reconciliation deferral reason.';
  end if;

  update private.message_provider_details
  set
    reconciliation_state = 'deferred',
    reconciliation_next_attempt_at = coalesce(
      p_next_attempt_at,
      p_deferred_at + interval '5 minutes'
    ),
    reconciliation_reason = p_reason
  where message_id = p_message_id
    and reconciliation_token = p_reconciliation_token
    and reconciliation_state in ('claimed', 'deferred');

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Reconciliation claim is no longer valid.';
  end if;
end;
$$;

create or replace function public.dispatch_claim_and_reserve_next(
  p_worker_id text,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  campaign_recipient_id uuid,
  contact_id uuid,
  phone_number_id uuid,
  step_order smallint,
  body text,
  claim_token uuid,
  reservation_id uuid,
  estimated_segments integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if pg_catalog.btrim(coalesce(p_worker_id, '')) = '' then
    raise exception using errcode = '22023', message = 'Worker ID is required.';
  end if;

  for v_workspace_id in
    select distinct recipient.workspace_id
    from public.campaign_recipients as recipient
    join public.campaigns as campaign on campaign.id = recipient.campaign_id
    where recipient.state = 'active'
      and recipient.next_send_at is not null
      and recipient.next_send_at <= p_now
      and campaign.status = 'active'
      and campaign.deleted_at is null
    order by recipient.workspace_id
  loop
    return query
    select
      reserved.message_id,
      reserved.workspace_id,
      reserved.campaign_id,
      reserved.campaign_recipient_id,
      reserved.contact_id,
      reserved.phone_number_id,
      reserved.step_order,
      reserved.body,
      reserved.reservation_token,
      reserved.reservation_token,
      reserved.estimated_segments
    from private.reserve_due_campaign_messages(
      v_workspace_id,
      1,
      p_now
    ) as reserved;

    if found then
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.dispatch_final_validate_and_begin_attempt(
  p_message_id uuid,
  p_claim_token uuid,
  p_now timestamptz default pg_catalog.now()
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.begin_message_dispatch(
    p_message_id,
    p_claim_token,
    p_now
  );
$$;

create or replace function public.dispatch_mark_accepted(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_accepted_at timestamptz default pg_catalog.now()
)
returns public.messages
language sql
security definer
set search_path = ''
as $$
  select private.mark_message_accepted(
    p_message_id,
    p_claim_token,
    p_provider,
    p_provider_message_id,
    p_accepted_at
  );
$$;

create or replace function public.dispatch_mark_known_failure_and_release(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null,
  p_failed_at timestamptz default pg_catalog.now()
)
returns public.messages
language sql
security definer
set search_path = ''
as $$
  select private.mark_message_failed(
    p_message_id,
    p_claim_token,
    p_provider,
    p_provider_message_id,
    p_provider_error_code,
    p_provider_error_message,
    p_failed_at
  );
$$;

create or replace function public.dispatch_mark_unknown_and_stop(
  p_message_id uuid,
  p_claim_token uuid,
  p_unknown_reason text,
  p_provider text,
  p_provider_message_id text default null,
  p_provider_error_code text default null,
  p_provider_error_message text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  if p_unknown_reason not in (
    'provider_result_ambiguous',
    'post_provider_persistence_failed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid dispatch reconciliation reason.';
  end if;

  v_message := private.record_dispatch_unknown_details(
    p_message_id,
    p_claim_token,
    p_provider,
    p_provider_message_id,
    p_provider_error_code,
    p_provider_error_message
  );

  update private.message_provider_details
  set reconciliation_reason = p_unknown_reason
  where message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function public.reconciliation_claim_next(
  p_worker_id text,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  campaign_id uuid,
  campaign_recipient_id uuid,
  contact_id uuid,
  provider text,
  provider_message_id text,
  reservation_id uuid,
  billing_period_id uuid,
  usage_position bigint,
  reconciliation_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.btrim(coalesce(p_worker_id, '')) = '' then
    raise exception using errcode = '22023', message = 'Worker ID is required.';
  end if;

  return query
  select *
  from private.claim_message_reconciliation(1, p_now);
end;
$$;

create or replace function public.reconciliation_complete(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_actual_segments integer,
  p_provider_cost_micro_usd bigint,
  p_provider_cost_pending boolean,
  p_reconciled_at timestamptz default pg_catalog.now()
)
returns public.messages
language sql
security definer
set search_path = ''
as $$
  select private.complete_message_reconciliation(
    p_message_id,
    p_reconciliation_token,
    p_actual_segments,
    p_provider_cost_micro_usd,
    p_provider_cost_pending,
    p_reconciled_at
  );
$$;

create or replace function public.reconciliation_defer(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_reason text,
  p_deferred_at timestamptz default pg_catalog.now(),
  p_next_attempt_at timestamptz default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.defer_message_reconciliation(
    p_message_id,
    p_reconciliation_token,
    p_reason,
    p_deferred_at,
    p_next_attempt_at
  );
$$;

create or replace function public.delete_campaign(p_campaign_id uuid)
returns public.campaigns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_message_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
  for update;

  if v_campaign.deleted_at is not null then
    return v_campaign;
  end if;

  perform 1
  from public.campaign_recipients as recipient
  where recipient.campaign_id = p_campaign_id
  order by recipient.id
  for update;

  for v_message_id in
    select message.id
    from public.messages as message
    where message.campaign_id = p_campaign_id
      and message.dispatch_state = 'reserved'
      and message.dispatch_started_at is null
    order by message.id
    for update
  loop
    perform private.release_reserved_message(
      v_message_id,
      'failed',
      'campaign_deleted'
    );
  end loop;

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = v_now,
    failure_code = 'campaign_deleted'
  where campaign_id = p_campaign_id
    and dispatch_state = 'pending';

  update public.campaign_recipients
  set
    state = 'stopped',
    next_send_at = null,
    stopped_at = v_now,
    stop_reason = 'campaign_deleted',
    finished_at = null
  where campaign_id = p_campaign_id
    and (
      state = 'active'
      or (state = 'stopped' and stop_reason = 'dispatch_unknown')
    );

  update public.campaigns
  set
    status = 'finished',
    paused_at = null,
    finished_at = v_now,
    deleted_at = v_now
  where id = p_campaign_id
  returning * into v_campaign;

  return v_campaign;
end;
$$;

create or replace function public.soft_delete_contact(
  p_contact_id uuid
)
returns public.contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_campaign_ids uuid[];
  v_contact public.contacts;
  v_message_id uuid;
  v_now timestamptz := pg_catalog.now();
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  select contact.workspace_id
  into v_workspace_id
  from public.contacts as contact
  join public.workspaces as workspace on workspace.id = contact.workspace_id
  where contact.id = p_contact_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Contact not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
  for update;

  select coalesce(
    array_agg(distinct recipient.campaign_id),
    '{}'::uuid[]
  )
  into v_campaign_ids
  from public.campaign_recipients as recipient
  where recipient.contact_id = p_contact_id
    and (
      recipient.state = 'active'
      or (
        recipient.state = 'stopped'
        and recipient.stop_reason = 'dispatch_unknown'
      )
    );

  perform 1
  from public.campaigns as campaign
  where campaign.id = any(v_campaign_ids)
  order by campaign.id
  for update;

  perform 1
  from public.campaign_recipients as recipient
  where recipient.contact_id = p_contact_id
    and (
      recipient.state = 'active'
      or (
        recipient.state = 'stopped'
        and recipient.stop_reason = 'dispatch_unknown'
      )
    )
  order by recipient.id
  for update;

  for v_message_id in
    select message.id
    from public.messages as message
    where message.contact_id = p_contact_id
      and message.dispatch_state = 'reserved'
      and message.dispatch_started_at is null
    order by message.id
    for update
  loop
    perform private.release_reserved_message(
      v_message_id,
      'failed',
      'contact_deleted'
    );
  end loop;

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = v_now,
    failure_code = 'contact_deleted'
  where contact_id = p_contact_id
    and dispatch_state = 'pending';

  update public.campaign_recipients
  set
    state = 'stopped',
    next_send_at = null,
    stopped_at = v_now,
    stop_reason = 'contact_deleted',
    finished_at = null
  where contact_id = p_contact_id
    and (
      state = 'active'
      or (state = 'stopped' and stop_reason = 'dispatch_unknown')
    );

  update public.contacts
  set deleted_at = coalesce(deleted_at, v_now)
  where id = p_contact_id
  returning * into v_contact;

  foreach v_campaign_id in array v_campaign_ids
  loop
    perform private.complete_campaigns_without_active_recipients(
      v_campaign_id
    );
  end loop;

  return v_contact;
end;
$$;

create or replace function public.get_campaign_statistics(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer;
  v_replies integer;
  v_reply_rate numeric;
  v_sent_recipients integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.campaigns as campaign
    join public.workspaces as workspace on workspace.id = campaign.workspace_id
    where campaign.id = p_campaign_id
      and workspace.owner_id = (select auth.uid())
  ) then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  select count(distinct message.campaign_recipient_id)::integer
  into v_sent_recipients
  from public.messages as message
  where message.campaign_id = p_campaign_id
    and message.direction = 'outbound'
    and message.dispatch_state = 'accepted'
    and message.delivery_state is distinct from 'failed';

  select count(*)::integer
  into v_replies
  from public.campaign_recipients as recipient
  where recipient.campaign_id = p_campaign_id
    and recipient.replied_at is not null
    and exists (
      select 1
      from public.messages as message
      where message.campaign_recipient_id = recipient.id
        and message.direction = 'outbound'
        and message.dispatch_state = 'accepted'
        and message.delivery_state is distinct from 'failed'
        and recipient.replied_at > message.accepted_at
    );

  select count(*)::integer
  into v_remaining
  from public.campaign_recipients as recipient
  where recipient.campaign_id = p_campaign_id
    and recipient.state = 'active'
    and recipient.next_send_at is not null
    and exists (
      select 1
      from public.campaign_steps as step
      where step.campaign_id = recipient.campaign_id
        and step.step_order = recipient.current_step_order
    );

  v_reply_rate := case
    when v_sent_recipients = 0 then 0::numeric
    else v_replies::numeric / v_sent_recipients::numeric
  end;

  return jsonb_build_object(
    'replies', v_replies,
    'sent_recipients', v_sent_recipients,
    'reply_rate', v_reply_rate,
    'remaining', v_remaining
  );
end;
$$;

alter table public.billing_periods enable row level security;
alter table public.billing_period_usage enable row level security;
alter table public.phone_numbers enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_draft_contacts enable row level security;
alter table public.campaign_steps enable row level security;
alter table public.campaign_recipients enable row level security;
alter table public.messages enable row level security;
alter table public.consent_confirmations enable row level security;

create policy billing_period_usage_owner_read
on public.billing_period_usage
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = billing_period_usage.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy phone_numbers_owner_read
on public.phone_numbers
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = phone_numbers.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy campaigns_owner_read
on public.campaigns
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = campaigns.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy campaign_draft_contacts_owner_read
on public.campaign_draft_contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.campaigns as campaign
    join public.workspaces as workspace on workspace.id = campaign.workspace_id
    where campaign.id = campaign_draft_contacts.campaign_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy campaign_steps_owner_read
on public.campaign_steps
for select
to authenticated
using (
  exists (
    select 1
    from public.campaigns as campaign
    join public.workspaces as workspace on workspace.id = campaign.workspace_id
    where campaign.id = campaign_steps.campaign_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy campaign_recipients_owner_read
on public.campaign_recipients
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = campaign_recipients.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy messages_owner_read
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = messages.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

revoke all on table public.billing_periods from anon, authenticated;
revoke all on table public.billing_period_usage from anon, authenticated;
revoke all on table public.phone_numbers from anon, authenticated;
revoke all on table public.campaigns from anon, authenticated;
revoke all on table public.campaign_draft_contacts from anon, authenticated;
revoke all on table public.campaign_steps from anon, authenticated;
revoke all on table public.campaign_recipients from anon, authenticated;
revoke all on table public.messages from anon, authenticated;
revoke all on table public.consent_confirmations from anon, authenticated;

grant select on table public.billing_period_usage to authenticated;
grant select on table public.phone_numbers to authenticated;
grant select on table public.campaigns to authenticated;
grant select on table public.campaign_draft_contacts to authenticated;
grant select on table public.campaign_steps to authenticated;
grant select on table public.campaign_recipients to authenticated;
grant select on table public.messages to authenticated;

revoke all on table private.workspace_messaging_controls
  from public, anon, authenticated;
revoke all on table private.phone_number_provider_details
  from public, anon, authenticated;
revoke all on table private.message_provider_details
  from public, anon, authenticated;

revoke all on function public.create_campaign_draft(uuid, text, jsonb, uuid)
  from public, anon;
revoke all on function public.update_campaign_draft(uuid, text, jsonb, uuid)
  from public, anon;
revoke all on function public.save_campaign_draft(
  uuid,
  uuid,
  text,
  jsonb,
  uuid,
  uuid[]
) from public, anon;
revoke all on function public.assess_campaign_launch(uuid)
  from public, anon;
revoke all on function public.launch_campaign(uuid, integer, boolean, boolean, jsonb)
  from public, anon;
revoke all on function public.pause_campaign(uuid)
  from public, anon;
revoke all on function public.resume_campaign(uuid)
  from public, anon;
revoke all on function public.delete_campaign(uuid)
  from public, anon;
revoke all on function public.get_campaign_statistics(uuid)
  from public, anon;
revoke all on function public.dispatch_claim_and_reserve_next(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.dispatch_final_validate_and_begin_attempt(
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.dispatch_mark_accepted(
  uuid,
  uuid,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.dispatch_mark_known_failure_and_release(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.dispatch_mark_unknown_and_stop(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.reconciliation_claim_next(text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.reconciliation_complete(
  uuid,
  uuid,
  integer,
  bigint,
  boolean,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.reconciliation_defer(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.save_campaign_draft(
  uuid,
  uuid,
  text,
  jsonb,
  uuid,
  uuid[]
) to authenticated;
grant execute on function public.assess_campaign_launch(uuid)
  to authenticated;
grant execute on function public.launch_campaign(uuid, integer, boolean, boolean, jsonb)
  to authenticated;
grant execute on function public.pause_campaign(uuid)
  to authenticated;
grant execute on function public.resume_campaign(uuid)
  to authenticated;
grant execute on function public.delete_campaign(uuid)
  to authenticated;
grant execute on function public.get_campaign_statistics(uuid)
  to authenticated;
grant execute on function public.soft_delete_contact(uuid)
  to authenticated;

grant execute on function public.dispatch_claim_and_reserve_next(
  text,
  timestamptz
) to service_role;
grant execute on function public.dispatch_final_validate_and_begin_attempt(
  uuid,
  uuid,
  timestamptz
) to service_role;
grant execute on function public.dispatch_mark_accepted(
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.dispatch_mark_known_failure_and_release(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function public.dispatch_mark_unknown_and_stop(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text
) to service_role;
grant execute on function public.reconciliation_claim_next(text, timestamptz)
  to service_role;
grant execute on function public.reconciliation_complete(
  uuid,
  uuid,
  integer,
  bigint,
  boolean,
  timestamptz
) to service_role;
grant execute on function public.reconciliation_defer(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz
) to service_role;

grant usage on schema private to service_role;
grant execute on function private.reserve_due_campaign_messages(
  uuid,
  integer,
  timestamptz
) to service_role;
grant execute on function private.begin_message_dispatch(
  uuid,
  uuid,
  timestamptz
) to service_role;
grant execute on function private.mark_message_accepted(
  uuid,
  uuid,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function private.mark_message_failed(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;
grant execute on function private.record_dispatch_unknown_details(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to service_role;
grant execute on function private.record_message_actual_segments(uuid, integer)
  to service_role;
grant execute on function private.record_message_delivery_state(
  uuid,
  text,
  timestamptz
) to service_role;
grant execute on function private.claim_message_reconciliation(
  integer,
  timestamptz
) to service_role;
grant execute on function private.complete_message_reconciliation(
  uuid,
  uuid,
  integer,
  bigint,
  boolean,
  timestamptz
) to service_role;
grant execute on function private.defer_message_reconciliation(
  uuid,
  uuid,
  text,
  timestamptz,
  timestamptz
) to service_role;

revoke all on all functions in schema private
  from public, anon, authenticated;

comment on table public.phone_numbers is
  'Product-safe workspace phone numbers. Technical provider identifiers live only in private tables.';
comment on table private.phone_number_provider_details is
  'Provider identifiers for internal operations only. Provider credentials are never stored here.';
comment on table private.message_provider_details is
  'Raw provider identifiers, statuses, errors, and costs; inaccessible to workspace roles.';
comment on table public.messages is
  'Product-safe message state. failure_code contains only stable Riink product codes.';
comment on function private.reserve_due_campaign_messages(uuid, integer, timestamptz) is
  'Claims due recipients with FOR UPDATE SKIP LOCKED and reserves estimated outbound usage transactionally.';
comment on function private.begin_message_dispatch(uuid, uuid, timestamptz) is
  'Performs the final fail-closed validation and persists dispatch_unknown before authorizing one provider call.';
comment on function public.get_campaign_statistics(uuid) is
  'Computes Reply Rate dynamically; accepted outbound messages with NULL delivery state count unless explicitly failed.';

commit;
