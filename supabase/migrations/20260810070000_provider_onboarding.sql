begin;

-- Product rows remain provider-neutral. Released numbers are masked in the
-- product schema while their original value remains available to Riink admins
-- through the private operation ledger.
alter table public.phone_numbers
  drop constraint phone_numbers_phone_e164_us_format,
  alter column phone_e164 drop not null,
  add constraint phone_numbers_phone_e164_us_format check (
    phone_e164 is null
    or phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  ),
  add constraint phone_numbers_active_phone_required check (
    deleted_at is not null or phone_e164 is not null
  );

alter table private.phone_number_provider_details
  add column setup_state text not null default 'purchased',
  add column a2p_state text,
  add column provider_error_code text,
  add column provider_error_message text,
  add constraint phone_number_provider_details_setup_state_valid check (
    setup_state in (
      'purchased',
      'verification_submitted',
      'under_review',
      'approved',
      'ready',
      'rejected',
      'release_pending',
      'released',
      'failed'
    )
  );

alter table private.message_provider_details
  add column accepted_persisted_at timestamptz,
  add column delivery_status_pending boolean not null default true,
  add column delivery_observed_at timestamptz,
  add column provider_cost_observed_at timestamptz;

update private.message_provider_details as detail
set delivery_status_pending = case
  when message.direction = 'inbound' then false
  when message.delivery_state in ('delivered', 'failed') then false
  else true
end
from public.messages as message
where message.id = detail.message_id;

create table private.workspace_provider_accounts (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  encrypted_auth_token text not null,
  messaging_service_id text,
  setup_state text not null default 'account_recorded',
  advanced_opt_out_enabled boolean not null default false,
  advanced_opt_out_confirmed_at timestamptz,
  advanced_opt_out_confirmed_by uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_provider_accounts_provider_account_key
    unique (provider, provider_account_id),
  constraint workspace_provider_accounts_provider_service_key
    unique (provider, messaging_service_id),
  constraint workspace_provider_accounts_values_not_blank check (
    provider = btrim(provider)
    and char_length(provider) > 0
    and provider_account_id = btrim(provider_account_id)
    and char_length(provider_account_id) > 0
    and encrypted_auth_token = btrim(encrypted_auth_token)
    and char_length(encrypted_auth_token) > 0
    and (
      messaging_service_id is null
      or (
        messaging_service_id = btrim(messaging_service_id)
        and char_length(messaging_service_id) > 0
      )
    )
  ),
  constraint workspace_provider_accounts_setup_state_valid check (
    setup_state in ('account_recorded', 'ready', 'reconciliation_required')
  ),
  constraint workspace_provider_accounts_ready_shape check (
    setup_state <> 'ready' or messaging_service_id is not null
  ),
  constraint workspace_provider_accounts_advanced_opt_out_shape check (
    (
      advanced_opt_out_enabled
      and advanced_opt_out_confirmed_at is not null
      and advanced_opt_out_confirmed_by is not null
    )
    or (
      not advanced_opt_out_enabled
      and advanced_opt_out_confirmed_at is null
      and advanced_opt_out_confirmed_by is null
    )
  )
);

create table private.workspace_provider_setup_operations (
  operation_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  state text not null default 'claimed',
  unknown_step text,
  provider_error_code text,
  provider_error_message text,
  provider_resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint workspace_provider_setup_operations_state_valid check (
    state in ('claimed', 'account_recorded', 'completed', 'reconciliation_required')
  ),
  constraint workspace_provider_setup_operations_unknown_step_valid check (
    unknown_step is null or unknown_step in ('account', 'service')
  ),
  constraint workspace_provider_setup_operations_terminal_shape check (
    (state = 'completed' and completed_at is not null and unknown_step is null)
    or (state <> 'completed' and completed_at is null)
  ),
  constraint workspace_provider_setup_operations_reconciliation_shape check (
    (state = 'reconciliation_required' and unknown_step is not null)
    or (state <> 'reconciliation_required' and unknown_step is null)
  )
);

create unique index workspace_provider_setup_one_open_idx
  on private.workspace_provider_setup_operations (workspace_id)
  where state <> 'completed';

create index workspace_provider_setup_workspace_created_idx
  on private.workspace_provider_setup_operations (workspace_id, created_at desc);

create table private.phone_number_operations (
  operation_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_number_id uuid not null,
  operation_type text not null,
  state text not null default 'claimed',
  requested_phone_e164 text,
  original_phone_e164 text,
  selection_nonce text,
  business_verification jsonb,
  provider text,
  provider_number_id text,
  provider_error_code text,
  provider_error_message text,
  provider_resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint phone_number_operations_workspace_type_number_key
    unique (workspace_id, operation_type, phone_number_id),
  constraint phone_number_operations_workspace_type_nonce_key
    unique (workspace_id, operation_type, selection_nonce),
  constraint phone_number_operations_type_valid check (
    operation_type in ('purchase', 'release')
  ),
  constraint phone_number_operations_state_valid check (
    state in ('claimed', 'completed', 'reconciliation_required')
  ),
  constraint phone_number_operations_terminal_shape check (
    (state = 'completed' and completed_at is not null)
    or (state <> 'completed' and completed_at is null)
  ),
  constraint phone_number_operations_purchase_shape check (
    operation_type <> 'purchase'
    or (
      requested_phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
      and selection_nonce is not null
      and selection_nonce = btrim(selection_nonce)
      and char_length(selection_nonce) between 1 and 2000
      and jsonb_typeof(business_verification) = 'object'
      and original_phone_e164 is null
    )
  ),
  constraint phone_number_operations_release_shape check (
    operation_type <> 'release'
    or (
      requested_phone_e164 is null
      and selection_nonce is null
      and business_verification is null
      and original_phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
      and provider_number_id is not null
    )
  )
);

create unique index phone_number_operations_open_purchase_phone_idx
  on private.phone_number_operations (requested_phone_e164)
  where operation_type = 'purchase' and state <> 'completed';

create index phone_number_operations_workspace_created_idx
  on private.phone_number_operations (workspace_id, created_at desc);

create table private.phone_number_setup_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers (id) on delete cascade,
  previous_state text,
  next_state text not null,
  provider_status text,
  a2p_state text,
  provider_error_code text,
  provider_error_message text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index phone_number_setup_history_number_changed_idx
  on private.phone_number_setup_history (phone_number_id, changed_at desc);

create table private.manual_message_dispatches (
  message_id uuid primary key references public.messages (id) on delete restrict,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  request_id uuid not null,
  claim_token uuid not null,
  created_at timestamptz not null default now(),
  constraint manual_message_dispatches_workspace_request_key
    unique (workspace_id, request_id),
  constraint manual_message_dispatches_workspace_claim_key
    unique (workspace_id, claim_token)
);

create trigger workspace_provider_accounts_touch_updated_at
before update on private.workspace_provider_accounts
for each row execute function private.touch_updated_at();

create trigger workspace_provider_setup_operations_touch_updated_at
before update on private.workspace_provider_setup_operations
for each row execute function private.touch_updated_at();

create trigger phone_number_operations_touch_updated_at
before update on private.phone_number_operations
for each row execute function private.touch_updated_at();

create or replace function public.messaging_claim_workspace_setup(
  p_workspace_id uuid,
  p_operation_id uuid
)
returns table (
  disposition text,
  operation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_provider_accounts;
  v_operation private.workspace_provider_setup_operations;
begin
  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select setup.*
  into v_operation
  from private.workspace_provider_setup_operations as setup
  where setup.operation_id = p_operation_id
  for update;

  if found then
    if v_operation.workspace_id <> p_workspace_id then
      raise exception using
        errcode = '23514',
        message = 'Setup operation does not belong to this workspace.';
    end if;

    return query select
      case v_operation.state
        when 'completed' then 'ready'
        when 'reconciliation_required' then 'reconciliation_required'
        else 'in_progress'
      end,
      v_operation.operation_id;
    return;
  end if;

  select account.*
  into v_account
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if found and v_account.setup_state = 'ready' then
    select setup.*
    into v_operation
    from private.workspace_provider_setup_operations as setup
    where setup.workspace_id = p_workspace_id
      and setup.state = 'completed'
    order by setup.completed_at desc, setup.operation_id
    limit 1;

    return query select 'ready'::text, coalesce(v_operation.operation_id, p_operation_id);
    return;
  end if;

  select setup.*
  into v_operation
  from private.workspace_provider_setup_operations as setup
  where setup.workspace_id = p_workspace_id
    and setup.state <> 'completed'
  for update;

  if found then
    return query select
      case
        when v_operation.state = 'reconciliation_required'
          then 'reconciliation_required'
        else 'in_progress'
      end,
      v_operation.operation_id;
    return;
  end if;

  insert into private.workspace_provider_setup_operations (
    operation_id,
    workspace_id,
    state
  )
  values (p_operation_id, p_workspace_id, 'claimed')
  returning * into v_operation;

  return query select 'claimed'::text, v_operation.operation_id;
end;
$$;

create or replace function public.messaging_record_workspace_account(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider text,
  p_provider_account_id text,
  p_encrypted_auth_token text
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_provider_accounts;
  v_operation private.workspace_provider_setup_operations;
  v_provider text := pg_catalog.btrim(coalesce(p_provider, ''));
  v_provider_account_id text := pg_catalog.btrim(
    coalesce(p_provider_account_id, '')
  );
  v_encrypted_auth_token text := pg_catalog.btrim(
    coalesce(p_encrypted_auth_token, '')
  );
begin
  if v_provider = ''
    or v_provider_account_id = ''
    or v_encrypted_auth_token = ''
    or pg_catalog.char_length(v_encrypted_auth_token) > 10000
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid workspace messaging account details.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select setup.*
  into v_operation
  from private.workspace_provider_setup_operations as setup
  where setup.operation_id = p_operation_id
    and setup.workspace_id = p_workspace_id
  for update;

  if not found then
    return query select false;
    return;
  end if;

  select account.*
  into v_account
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if v_operation.state in ('account_recorded', 'completed') then
    return query select
      v_account.provider = v_provider
      and v_account.provider_account_id = v_provider_account_id
      and v_account.encrypted_auth_token = v_encrypted_auth_token;
    return;
  end if;

  if v_operation.state = 'reconciliation_required'
    and (
      v_operation.unknown_step <> 'account'
      or (
        v_operation.provider_resource_id is not null
        and v_operation.provider_resource_id <> v_provider_account_id
      )
    )
  then
    return query select false;
    return;
  end if;

  insert into private.workspace_provider_accounts (
    workspace_id,
    provider,
    provider_account_id,
    encrypted_auth_token,
    setup_state
  )
  values (
    p_workspace_id,
    v_provider,
    v_provider_account_id,
    v_encrypted_auth_token,
    'account_recorded'
  )
  on conflict (workspace_id) do update
  set
    provider = excluded.provider,
    provider_account_id = excluded.provider_account_id,
    encrypted_auth_token = excluded.encrypted_auth_token,
    setup_state = 'account_recorded';

  update private.workspace_provider_setup_operations as setup
  set
    state = 'account_recorded',
    unknown_step = null,
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null
  where setup.operation_id = p_operation_id;

  return query select true;
end;
$$;

create or replace function public.messaging_complete_workspace_setup(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_messaging_service_id text
)
returns table (completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_provider_accounts;
  v_messaging_service_id text := pg_catalog.btrim(
    coalesce(p_messaging_service_id, '')
  );
  v_operation private.workspace_provider_setup_operations;
begin
  if v_messaging_service_id = '' then
    raise exception using
      errcode = '22023',
      message = 'Messaging service identifier is required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select setup.*
  into v_operation
  from private.workspace_provider_setup_operations as setup
  where setup.operation_id = p_operation_id
    and setup.workspace_id = p_workspace_id
  for update;

  select account.*
  into v_account
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if v_operation.operation_id is null or v_account.workspace_id is null then
    return query select false;
    return;
  end if;

  if v_operation.state = 'completed' then
    return query select
      v_account.setup_state = 'ready'
      and v_account.messaging_service_id = v_messaging_service_id;
    return;
  end if;

  if v_operation.state not in ('account_recorded', 'reconciliation_required')
    or (
      v_operation.state = 'reconciliation_required'
      and (
        v_operation.unknown_step <> 'service'
        or (
          v_operation.provider_resource_id is not null
          and v_operation.provider_resource_id <> v_messaging_service_id
        )
      )
    )
  then
    return query select false;
    return;
  end if;

  update private.workspace_provider_accounts as account
  set
    messaging_service_id = v_messaging_service_id,
    setup_state = 'ready'
  where account.workspace_id = p_workspace_id;

  update private.workspace_provider_setup_operations as setup
  set
    state = 'completed',
    unknown_step = null,
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null,
    completed_at = pg_catalog.now()
  where setup.operation_id = p_operation_id;

  return query select true;
end;
$$;

create or replace function public.messaging_mark_workspace_setup_unknown(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_step text,
  p_provider_code text,
  p_provider_message text,
  p_provider_resource_id text
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation private.workspace_provider_setup_operations;
begin
  if p_step not in ('account', 'service')
    or pg_catalog.btrim(coalesce(p_provider_message, '')) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid workspace setup reconciliation details.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select setup.*
  into v_operation
  from private.workspace_provider_setup_operations as setup
  where setup.operation_id = p_operation_id
    and setup.workspace_id = p_workspace_id
  for update;

  if not found or v_operation.state = 'completed' then
    return query select false;
    return;
  end if;

  if v_operation.state = 'reconciliation_required' then
    return query select true;
    return;
  end if;

  if (p_step = 'account' and v_operation.state <> 'claimed')
    or (p_step = 'service' and v_operation.state <> 'account_recorded')
  then
    return query select false;
    return;
  end if;

  update private.workspace_provider_setup_operations as setup
  set
    state = 'reconciliation_required',
    unknown_step = p_step,
    provider_error_code = nullif(pg_catalog.btrim(p_provider_code), ''),
    provider_error_message = pg_catalog.left(
      pg_catalog.btrim(p_provider_message),
      1000
    ),
    provider_resource_id = nullif(
      pg_catalog.btrim(p_provider_resource_id),
      ''
    )
  where setup.operation_id = p_operation_id;

  update private.workspace_provider_accounts as account
  set setup_state = 'reconciliation_required'
  where account.workspace_id = p_workspace_id;

  return query select true;
end;
$$;

create or replace function public.messaging_get_workspace_credentials(
  p_workspace_id uuid
)
returns table (
  account_id text,
  encrypted_auth_token text,
  messaging_service_id text
)
language sql
security definer
set search_path = ''
as $$
  select
    account.provider_account_id,
    account.encrypted_auth_token,
    account.messaging_service_id
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id
    and account.setup_state = 'ready'
    and account.messaging_service_id is not null;
$$;

create or replace function public.claim_phone_number_purchase(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_phone_e164 text,
  p_selection_nonce text,
  p_business_verification jsonb
)
returns table (
  disposition text,
  operation_id uuid,
  phone_number_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_limit integer;
  v_operation private.phone_number_operations;
  v_pending_count integer;
  v_phone_e164 text := pg_catalog.btrim(coalesce(p_phone_e164, ''));
  v_selection_nonce text := pg_catalog.btrim(coalesce(p_selection_nonce, ''));
begin
  if v_phone_e164 !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
    or v_selection_nonce = ''
    or pg_catalog.char_length(v_selection_nonce) > 2000
    or p_business_verification is null
    or pg_catalog.jsonb_typeof(p_business_verification) <> 'object'
    or p_business_verification = '{}'::jsonb
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid phone number purchase request.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
  for update;

  if found then
    if v_operation.workspace_id <> p_workspace_id
      or v_operation.operation_type <> 'purchase'
      or v_operation.requested_phone_e164 <> v_phone_e164
      or v_operation.selection_nonce <> v_selection_nonce
    then
      raise exception using
        errcode = '23514',
        message = 'Phone number operation correlation failed.';
    end if;

    return query select
      case
        when v_operation.state = 'reconciliation_required'
          then 'reconciliation_required'
        else 'already_started'
      end,
      v_operation.operation_id,
      v_operation.phone_number_id;
    return;
  end if;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.workspace_id = p_workspace_id
    and operation.operation_type = 'purchase'
    and operation.selection_nonce = v_selection_nonce
  for update;

  if found then
    return query select
      case
        when v_operation.state = 'reconciliation_required'
          then 'reconciliation_required'
        else 'already_started'
      end,
      v_operation.operation_id,
      v_operation.phone_number_id;
    return;
  end if;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_type = 'purchase'
    and operation.requested_phone_e164 = v_phone_e164
    and operation.state <> 'completed'
  for update;

  if found then
    return query select
      case
        when v_operation.state = 'reconciliation_required'
          then 'reconciliation_required'
        else 'in_progress'
      end,
      v_operation.operation_id,
      v_operation.phone_number_id;
    return;
  end if;

  if exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.phone_e164 = v_phone_e164
      and phone_number.deleted_at is null
  ) then
    select
      phone_number.id,
      operation.operation_id
    into v_operation.phone_number_id, v_operation.operation_id
    from public.phone_numbers as phone_number
    left join private.phone_number_operations as operation
      on operation.phone_number_id = phone_number.id
      and operation.operation_type = 'purchase'
    where phone_number.phone_e164 = v_phone_e164
      and phone_number.deleted_at is null
    order by operation.created_at desc nulls last
    limit 1;

    return query select
      'in_progress'::text,
      coalesce(v_operation.operation_id, p_operation_id),
      v_operation.phone_number_id;
    return;
  end if;

  if not exists (
    select 1
    from private.workspace_provider_accounts as account
    where account.workspace_id = p_workspace_id
      and account.setup_state = 'ready'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Workspace messaging setup is not ready.';
  end if;

  select coalesce(period.max_phone_numbers_snapshot, plan.max_phone_numbers)
  into v_limit
  from public.workspaces as workspace
  join public.billing_plans as plan on plan.id = workspace.billing_plan_id
  left join public.billing_periods as period
    on period.workspace_id = workspace.id
    and period.status = 'open'
  where workspace.id = p_workspace_id;

  select count(*)::integer
  into v_active_count
  from public.phone_numbers as phone_number
  where phone_number.workspace_id = p_workspace_id
    and phone_number.deleted_at is null;

  select count(*)::integer
  into v_pending_count
  from private.phone_number_operations as operation
  where operation.workspace_id = p_workspace_id
    and operation.operation_type = 'purchase'
    and operation.state in ('claimed', 'reconciliation_required');

  if v_active_count + v_pending_count >= v_limit then
    raise exception using
      errcode = '23514',
      message = 'This workspace already has the maximum number of phone numbers.';
  end if;

  insert into private.phone_number_operations (
    operation_id,
    workspace_id,
    phone_number_id,
    operation_type,
    state,
    requested_phone_e164,
    selection_nonce,
    business_verification
  )
  values (
    p_operation_id,
    p_workspace_id,
    gen_random_uuid(),
    'purchase',
    'claimed',
    v_phone_e164,
    v_selection_nonce,
    p_business_verification
  )
  returning * into v_operation;

  return query select
    'claimed'::text,
    v_operation.operation_id,
    v_operation.phone_number_id;
end;
$$;

create or replace function public.complete_phone_number_purchase(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider text,
  p_provider_number_id text,
  p_provider_status text
)
returns table (
  completed boolean,
  phone_number_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation private.phone_number_operations;
  v_provider text := pg_catalog.btrim(coalesce(p_provider, ''));
  v_provider_number_id text := pg_catalog.btrim(
    coalesce(p_provider_number_id, '')
  );
  v_provider_status text := pg_catalog.btrim(coalesce(p_provider_status, ''));
begin
  if v_provider = '' or v_provider_number_id = '' or v_provider_status = '' then
    raise exception using
      errcode = '22023',
      message = 'Invalid phone number completion details.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
    and operation.workspace_id = p_workspace_id
    and operation.operation_type = 'purchase'
  for update;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if v_operation.state = 'completed' then
    return query select
      coalesce(v_operation.provider = v_provider, false)
      and coalesce(v_operation.provider_number_id = v_provider_number_id, false),
      v_operation.phone_number_id;
    return;
  end if;

  if v_operation.state = 'reconciliation_required'
    and v_operation.provider_resource_id is not null
    and v_operation.provider_resource_id <> v_provider_number_id
  then
    return query select false, v_operation.phone_number_id;
    return;
  end if;

  if not exists (
    select 1
    from private.workspace_provider_accounts as account
    where account.workspace_id = p_workspace_id
      and account.provider = v_provider
      and account.setup_state = 'ready'
  ) then
    return query select false, v_operation.phone_number_id;
    return;
  end if;

  insert into public.phone_numbers (
    id,
    workspace_id,
    phone_e164,
    status
  )
  values (
    v_operation.phone_number_id,
    p_workspace_id,
    v_operation.requested_phone_e164,
    'pending'
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = v_operation.phone_number_id
      and phone_number.workspace_id = p_workspace_id
      and phone_number.phone_e164 = v_operation.requested_phone_e164
      and phone_number.deleted_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Phone number completion correlation failed.';
  end if;

  insert into private.phone_number_provider_details (
    phone_number_id,
    provider,
    provider_number_id,
    provider_status,
    setup_state
  )
  values (
    v_operation.phone_number_id,
    v_provider,
    v_provider_number_id,
    v_provider_status,
    'purchased'
  )
  on conflict on constraint phone_number_provider_details_pkey do update
  set
    provider = excluded.provider,
    provider_number_id = excluded.provider_number_id,
    provider_status = excluded.provider_status,
    setup_state = 'purchased',
    provider_error_code = null,
    provider_error_message = null;

  update private.phone_number_operations as operation
  set
    state = 'completed',
    provider = v_provider,
    provider_number_id = v_provider_number_id,
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null,
    completed_at = pg_catalog.now()
  where operation.operation_id = p_operation_id;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status
  )
  values (
    p_workspace_id,
    v_operation.phone_number_id,
    null,
    'purchased',
    v_provider_status
  );

  return query select true, v_operation.phone_number_id;
end;
$$;

create or replace function public.mark_phone_number_purchase_unknown(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider_code text,
  p_provider_message text,
  p_provider_resource_id text
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation private.phone_number_operations;
begin
  if pg_catalog.btrim(coalesce(p_provider_message, '')) = '' then
    raise exception using
      errcode = '22023',
      message = 'Phone number reconciliation details are required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
    and operation.workspace_id = p_workspace_id
    and operation.operation_type = 'purchase'
  for update;

  if not found or v_operation.state = 'completed' then
    return query select false;
    return;
  end if;

  if v_operation.state = 'reconciliation_required' then
    return query select true;
    return;
  end if;

  update private.phone_number_operations as operation
  set
    state = 'reconciliation_required',
    provider_error_code = nullif(pg_catalog.btrim(p_provider_code), ''),
    provider_error_message = pg_catalog.left(
      pg_catalog.btrim(p_provider_message),
      1000
    ),
    provider_resource_id = nullif(
      pg_catalog.btrim(p_provider_resource_id),
      ''
    )
  where operation.operation_id = p_operation_id;

  return query select true;
end;
$$;

create or replace function public.claim_phone_number_release(
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_operation_id uuid
)
returns table (
  disposition text,
  operation_id uuid,
  provider_number_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail private.phone_number_provider_details;
  v_operation private.phone_number_operations;
  v_phone public.phone_numbers;
begin
  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
  for update;

  if found then
    if v_operation.workspace_id <> p_workspace_id
      or v_operation.operation_type <> 'release'
      or v_operation.phone_number_id <> p_phone_number_id
    then
      raise exception using
        errcode = '23514',
        message = 'Phone number operation correlation failed.';
    end if;

    return query select
      case v_operation.state
        when 'completed' then 'already_released'
        when 'reconciliation_required' then 'reconciliation_required'
        else 'in_progress'
      end,
      v_operation.operation_id,
      case
        when v_operation.state = 'completed' then null::text
        else v_operation.provider_number_id
      end;
    return;
  end if;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.workspace_id = p_workspace_id
    and operation.operation_type = 'release'
    and operation.phone_number_id = p_phone_number_id
  for update;

  if found then
    return query select
      case v_operation.state
        when 'completed' then 'already_released'
        when 'reconciliation_required' then 'reconciliation_required'
        else 'in_progress'
      end,
      v_operation.operation_id,
      case
        when v_operation.state = 'completed' then null::text
        else v_operation.provider_number_id
      end;
    return;
  end if;

  select phone_number.*
  into v_phone
  from public.phone_numbers as phone_number
  where phone_number.id = p_phone_number_id
    and phone_number.workspace_id = p_workspace_id
  for update;

  if not found or v_phone.deleted_at is not null then
    return query select
      'already_released'::text,
      p_operation_id,
      null::text;
    return;
  end if;

  if exists (
    select 1
    from public.campaigns as campaign
    where campaign.workspace_id = p_workspace_id
      and campaign.phone_number_id = p_phone_number_id
      and campaign.deleted_at is null
      and campaign.status in ('active', 'paused')
  ) then
    return query select
      'blocked_active_campaign'::text,
      p_operation_id,
      null::text;
    return;
  end if;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = p_phone_number_id
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Phone number provider details are unavailable.';
  end if;

  insert into private.phone_number_operations (
    operation_id,
    workspace_id,
    phone_number_id,
    operation_type,
    state,
    original_phone_e164,
    provider,
    provider_number_id
  )
  values (
    p_operation_id,
    p_workspace_id,
    p_phone_number_id,
    'release',
    'claimed',
    v_phone.phone_e164,
    v_detail.provider,
    v_detail.provider_number_id
  )
  returning * into v_operation;

  update public.phone_numbers
  set
    phone_e164 = null,
    status = 'pending',
    deleted_at = pg_catalog.now()
  where id = p_phone_number_id;

  update private.phone_number_provider_details as detail
  set setup_state = 'release_pending'
  where detail.phone_number_id = p_phone_number_id;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status
  )
  values (
    p_workspace_id,
    p_phone_number_id,
    v_detail.setup_state,
    'release_pending',
    v_detail.provider_status
  );

  return query select
    'claimed'::text,
    v_operation.operation_id,
    v_operation.provider_number_id;
end;
$$;

create or replace function public.complete_phone_number_release(
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_operation_id uuid
)
returns table (completed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation private.phone_number_operations;
begin
  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
    and operation.workspace_id = p_workspace_id
    and operation.operation_type = 'release'
    and operation.phone_number_id = p_phone_number_id
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_operation.state = 'completed' then
    return query select true;
    return;
  end if;

  update private.phone_number_operations as operation
  set
    state = 'completed',
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null,
    completed_at = pg_catalog.now()
  where operation.operation_id = p_operation_id;

  update private.phone_number_provider_details as detail
  set
    setup_state = 'released',
    provider_status = 'released',
    provider_error_code = null,
    provider_error_message = null
  where detail.phone_number_id = p_phone_number_id;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status
  )
  values (
    p_workspace_id,
    p_phone_number_id,
    'release_pending',
    'released',
    'released'
  );

  return query select true;
end;
$$;

create or replace function public.mark_phone_number_release_unknown(
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_operation_id uuid,
  p_provider_code text,
  p_provider_message text,
  p_provider_resource_id text
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation private.phone_number_operations;
begin
  if pg_catalog.btrim(coalesce(p_provider_message, '')) = '' then
    raise exception using
      errcode = '22023',
      message = 'Phone number reconciliation details are required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.operation_id = p_operation_id
    and operation.workspace_id = p_workspace_id
    and operation.operation_type = 'release'
    and operation.phone_number_id = p_phone_number_id
  for update;

  if not found or v_operation.state = 'completed' then
    return query select false;
    return;
  end if;

  if v_operation.state = 'reconciliation_required' then
    return query select true;
    return;
  end if;

  update private.phone_number_operations as operation
  set
    state = 'reconciliation_required',
    provider_error_code = nullif(pg_catalog.btrim(p_provider_code), ''),
    provider_error_message = pg_catalog.left(
      pg_catalog.btrim(p_provider_message),
      1000
    ),
    provider_resource_id = nullif(
      pg_catalog.btrim(p_provider_resource_id),
      ''
    )
  where operation.operation_id = p_operation_id;

  update private.phone_number_provider_details as detail
  set
    provider_error_code = nullif(pg_catalog.btrim(p_provider_code), ''),
    provider_error_message = pg_catalog.left(
      pg_catalog.btrim(p_provider_message),
      1000
    )
  where detail.phone_number_id = p_phone_number_id;

  return query select true;
end;
$$;

create table private.phone_number_activation_attempts (
  activation_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete restrict,
  state text not null default 'claimed',
  failure_code text,
  requested_at timestamptz not null,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_number_activation_attempts_state_valid check (
    state in ('claimed', 'completed', 'failed')
  ),
  constraint phone_number_activation_attempts_terminal_shape check (
    (
      state = 'claimed'
      and completed_at is null
      and failed_at is null
      and failure_code is null
    )
    or (
      state = 'completed'
      and completed_at is not null
      and failed_at is null
      and failure_code is null
    )
    or (
      state = 'failed'
      and completed_at is null
      and failed_at is not null
      and failure_code is not null
    )
  )
);

create unique index phone_number_activation_one_open_idx
  on private.phone_number_activation_attempts (phone_number_id)
  where state = 'claimed';

create index phone_number_activation_workspace_requested_idx
  on private.phone_number_activation_attempts (workspace_id, requested_at desc);

create trigger phone_number_activation_attempts_touch_updated_at
before update on private.phone_number_activation_attempts
for each row execute function private.touch_updated_at();

create or replace function public.admin_confirm_workspace_advanced_opt_out(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_confirmed_at timestamptz
)
returns table (
  confirmed boolean,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_provider_accounts;
begin
  if p_admin_user_id is null or p_confirmed_at is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid opt-out protection confirmation.';
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

  select account.*
  into v_account
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id
    and account.setup_state = 'ready'
    and account.messaging_service_id is not null
  for update;

  if not found then
    return query select false, p_workspace_id;
    return;
  end if;

  if not v_account.advanced_opt_out_enabled then
    update private.workspace_provider_accounts as account
    set
      advanced_opt_out_enabled = true,
      advanced_opt_out_confirmed_at = p_confirmed_at,
      advanced_opt_out_confirmed_by = p_admin_user_id
    where account.workspace_id = p_workspace_id;
  end if;

  return query select true, p_workspace_id;
end;
$$;

create or replace function public.admin_record_phone_number_setup_state(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_next_state text,
  p_provider_status text,
  p_a2p_state text,
  p_provider_error_code text,
  p_provider_error_message text,
  p_changed_at timestamptz
)
returns table (
  activation_eligible boolean,
  number_id uuid,
  recorded boolean,
  setup_state text,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_advanced_opt_out_enabled boolean := false;
  v_detail private.phone_number_provider_details;
  v_phone public.phone_numbers;
  v_previous_state text;
begin
  if p_admin_user_id is null
    or p_changed_at is null
    or p_next_state not in (
      'verification_submitted',
      'under_review',
      'approved',
      'rejected',
      'failed'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid phone number setup transition.';
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

  select phone_number.*
  into v_phone
  from public.phone_numbers as phone_number
  where phone_number.id = p_phone_number_id
    and phone_number.workspace_id = p_workspace_id
  for update;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = p_phone_number_id
  for update;

  select account.advanced_opt_out_enabled
  into v_advanced_opt_out_enabled
  from private.workspace_provider_accounts as account
  where account.workspace_id = p_workspace_id;

  if v_phone.id is null
    or v_phone.deleted_at is not null
    or v_phone.status <> 'pending'
    or v_detail.phone_number_id is null
    or v_detail.setup_state in ('release_pending', 'released', 'ready')
  then
    return query select
      false,
      p_phone_number_id,
      false,
      coalesce(v_detail.setup_state, 'unavailable'),
      p_workspace_id;
    return;
  end if;

  if v_detail.setup_state = p_next_state then
    return query select
      v_detail.setup_state = 'approved'
        and coalesce(v_detail.a2p_state, '') = 'approved'
        and coalesce(v_advanced_opt_out_enabled, false),
      p_phone_number_id,
      true,
      v_detail.setup_state,
      p_workspace_id;
    return;
  end if;

  if not (
    (v_detail.setup_state = 'purchased'
      and p_next_state in ('verification_submitted', 'approved', 'failed'))
    or (v_detail.setup_state = 'verification_submitted'
      and p_next_state in ('under_review', 'approved', 'rejected', 'failed'))
    or (v_detail.setup_state = 'under_review'
      and p_next_state in ('approved', 'rejected', 'failed'))
    or (v_detail.setup_state in ('rejected', 'failed')
      and p_next_state in ('verification_submitted', 'approved'))
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid phone number setup transition.';
  end if;

  if p_next_state = 'approved'
    and pg_catalog.btrim(coalesce(p_a2p_state, '')) <> 'approved'
  then
    raise exception using
      errcode = '22023',
      message = 'Approved setup requires confirmed messaging approval.';
  end if;

  v_previous_state := v_detail.setup_state;

  update private.phone_number_provider_details as detail
  set
    setup_state = p_next_state,
    provider_status = coalesce(
      nullif(pg_catalog.btrim(p_provider_status), ''),
      provider_status
    ),
    a2p_state = coalesce(
      nullif(pg_catalog.btrim(p_a2p_state), ''),
      a2p_state
    ),
    provider_error_code = coalesce(
      nullif(pg_catalog.btrim(p_provider_error_code), ''),
      provider_error_code
    ),
    provider_error_message = case
      when pg_catalog.btrim(coalesce(p_provider_error_message, '')) = ''
        then provider_error_message
      else pg_catalog.left(pg_catalog.btrim(p_provider_error_message), 1000)
    end
  where detail.phone_number_id = p_phone_number_id
  returning * into v_detail;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status,
    a2p_state,
    provider_error_code,
    provider_error_message,
    changed_by,
    changed_at
  )
  values (
    p_workspace_id,
    p_phone_number_id,
    v_previous_state,
    p_next_state,
    v_detail.provider_status,
    v_detail.a2p_state,
    v_detail.provider_error_code,
    v_detail.provider_error_message,
    p_admin_user_id,
    p_changed_at
  );

  return query select
    v_detail.setup_state = 'approved'
      and v_detail.a2p_state = 'approved'
      and coalesce(v_advanced_opt_out_enabled, false),
    p_phone_number_id,
    true,
    v_detail.setup_state,
    p_workspace_id;
end;
$$;

create or replace function public.admin_claim_approved_number_activation(
  p_admin_user_id uuid,
  p_number_id uuid,
  p_requested_at timestamptz
)
returns table (
  activation_id uuid,
  disposition text,
  number_id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation private.phone_number_activation_attempts;
  v_detail private.phone_number_provider_details;
  v_phone public.phone_numbers;
begin
  if p_admin_user_id is null or p_requested_at is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid number activation request.';
  end if;

  if not exists (
    select 1 from auth.users as app_user where app_user.id = p_admin_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Admin user not found.';
  end if;

  select phone_number.*
  into v_phone
  from public.phone_numbers as phone_number
  where phone_number.id = p_number_id
  for update;

  if not found or v_phone.deleted_at is not null then
    raise exception using errcode = 'P0002', message = 'Phone number not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_phone.workspace_id
  for update;

  if v_phone.status = 'ready' then
    return query select
      null::uuid,
      'already_ready'::text,
      v_phone.id,
      v_phone.workspace_id;
    return;
  end if;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = v_phone.id
  for update;

  if not found
    or v_detail.setup_state <> 'approved'
    or coalesce(v_detail.a2p_state, '') <> 'approved'
    or not exists (
      select 1
      from private.workspace_provider_accounts as account
      where account.workspace_id = v_phone.workspace_id
        and account.setup_state = 'ready'
        and account.advanced_opt_out_enabled
        and account.advanced_opt_out_confirmed_at is not null
    )
  then
    return query select
      null::uuid,
      'not_approved'::text,
      v_phone.id,
      v_phone.workspace_id;
    return;
  end if;

  select activation.*
  into v_activation
  from private.phone_number_activation_attempts as activation
  where activation.phone_number_id = v_phone.id
    and activation.state = 'claimed'
  for update;

  if found and v_activation.requested_at > p_requested_at - interval '15 minutes' then
    return query select
      v_activation.activation_id,
      'in_progress'::text,
      v_phone.id,
      v_phone.workspace_id;
    return;
  end if;

  if found then
    update private.phone_number_activation_attempts as activation
    set
      state = 'failed',
      failure_code = 'stale_reclaimed',
      failed_at = p_requested_at
    where activation.activation_id = v_activation.activation_id;
  end if;

  insert into private.phone_number_activation_attempts (
    workspace_id,
    phone_number_id,
    requested_by,
    requested_at
  )
  values (
    v_phone.workspace_id,
    v_phone.id,
    p_admin_user_id,
    p_requested_at
  )
  returning * into v_activation;

  return query select
    v_activation.activation_id,
    'claimed'::text,
    v_phone.id,
    v_phone.workspace_id;
end;
$$;

create or replace function public.admin_fail_approved_number_activation(
  p_activation_id uuid,
  p_admin_user_id uuid,
  p_failed_at timestamptz,
  p_failure_code text,
  p_number_id uuid,
  p_workspace_id uuid
)
returns table (
  activation_id uuid,
  number_id uuid,
  recorded boolean,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation private.phone_number_activation_attempts;
begin
  if p_admin_user_id is null
    or p_failed_at is null
    or pg_catalog.btrim(coalesce(p_failure_code, '')) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid number activation failure.';
  end if;

  select activation.*
  into v_activation
  from private.phone_number_activation_attempts as activation
  where activation.activation_id = p_activation_id
    and activation.workspace_id = p_workspace_id
    and activation.phone_number_id = p_number_id
  for update;

  if not found then
    return query select
      p_activation_id,
      p_number_id,
      false,
      p_workspace_id;
    return;
  end if;

  if v_activation.state = 'failed' then
    return query select
      v_activation.activation_id,
      v_activation.phone_number_id,
      true,
      v_activation.workspace_id;
    return;
  end if;

  if v_activation.state <> 'claimed' then
    return query select
      v_activation.activation_id,
      v_activation.phone_number_id,
      false,
      v_activation.workspace_id;
    return;
  end if;

  update private.phone_number_activation_attempts as activation
  set
    state = 'failed',
    failure_code = pg_catalog.left(pg_catalog.btrim(p_failure_code), 200),
    failed_at = p_failed_at
  where activation.activation_id = p_activation_id;

  return query select
    p_activation_id,
    p_number_id,
    true,
    p_workspace_id;
end;
$$;

create or replace function public.admin_get_number_operations(
  p_limit integer default 100
)
returns table (
  number_id uuid,
  phone_number text,
  workspace_id uuid,
  workspace_name text,
  product_status text,
  provider text,
  provider_number_id text,
  provider_status text,
  setup_state text,
  a2p_state text,
  provider_error_code text,
  provider_error_message text,
  account_sid text,
  messaging_service_sid text,
  activation_eligible boolean,
  advanced_opt_out_confirmed boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Admin result limit must be between 1 and 1,000.';
  end if;

  return query
  select
    phone_number.id,
    coalesce(
      phone_number.phone_e164,
      release_operation.original_phone_e164
    ),
    phone_number.workspace_id,
    workspace.name,
    case
      when phone_number.deleted_at is not null then 'released'
      else phone_number.status
    end,
    detail.provider,
    detail.provider_number_id,
    detail.provider_status,
    detail.setup_state,
    detail.a2p_state,
    detail.provider_error_code,
    detail.provider_error_message,
    account.provider_account_id,
    account.messaging_service_id,
    phone_number.deleted_at is null
      and phone_number.status = 'pending'
      and detail.setup_state = 'approved'
      and detail.a2p_state = 'approved'
      and coalesce(account.advanced_opt_out_enabled, false),
    coalesce(account.advanced_opt_out_enabled, false),
    greatest(phone_number.updated_at, detail.updated_at)
  from public.phone_numbers as phone_number
  join public.workspaces as workspace on workspace.id = phone_number.workspace_id
  left join private.phone_number_provider_details as detail
    on detail.phone_number_id = phone_number.id
  left join private.workspace_provider_accounts as account
    on account.workspace_id = phone_number.workspace_id
  left join lateral (
    select operation.original_phone_e164
    from private.phone_number_operations as operation
    where operation.phone_number_id = phone_number.id
      and operation.operation_type = 'release'
    order by operation.created_at desc
    limit 1
  ) as release_operation on true
  order by greatest(phone_number.updated_at, detail.updated_at) desc
  limit p_limit;
end;
$$;

create or replace function private.normalize_message_provider_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction text;
  v_num_segments integer;
begin
  select message.direction, message.num_segments
  into v_direction, v_num_segments
  from public.messages as message
  where message.id = new.message_id;

  if v_direction = 'inbound' then
    new.delivery_status_pending := false;
    return new;
  end if;

  if new.provider_cost_micro_usd is not null then
    new.provider_cost_pending := false;
  end if;

  if new.reconciliation_state = 'complete'
    and (
      v_num_segments is null
      or new.provider_cost_pending
      or new.delivery_status_pending
    )
  then
    new.reconciliation_state := 'deferred';
    new.reconciliation_next_attempt_at := coalesce(
      new.reconciliation_next_attempt_at,
      pg_catalog.now() + interval '1 day'
    );
    new.reconciliation_reason := case
      when v_num_segments is null then 'segments_pending'
      when new.provider_cost_pending then 'provider_cost_pending'
      else 'delivery_status_pending'
    end;
  elsif new.reconciliation_state in ('pending', 'deferred')
    and v_num_segments is not null
    and not new.provider_cost_pending
    and not new.delivery_status_pending
  then
    new.reconciliation_state := 'complete';
    new.reconciliation_next_attempt_at := null;
    new.reconciliation_reason := null;
    new.reconciled_at := coalesce(new.reconciled_at, pg_catalog.now());
  end if;

  return new;
end;
$$;

create trigger message_provider_details_normalize_reconciliation
before insert or update on private.message_provider_details
for each row execute function private.normalize_message_provider_reconciliation();

update private.message_provider_details as detail
set
  reconciliation_state = 'deferred',
  reconciliation_next_attempt_at = coalesce(
    detail.reconciliation_next_attempt_at,
    pg_catalog.now()
  ),
  reconciliation_reason = case
    when message.num_segments is null then 'segments_pending'
    when detail.provider_cost_pending then 'provider_cost_pending'
    else 'delivery_status_pending'
  end
from public.messages as message
where message.id = detail.message_id
  and message.direction = 'outbound'
  and message.dispatch_state = 'accepted'
  and detail.reconciliation_state = 'complete'
  and (
    message.num_segments is null
    or detail.provider_cost_pending
    or detail.delivery_status_pending
  );

create or replace function private.sync_message_delivery_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction = 'outbound'
    and new.dispatch_state = 'accepted'
    and new.delivery_state is distinct from old.delivery_state
  then
    update private.message_provider_details as detail
    set
      delivery_status_pending = new.delivery_state not in ('delivered', 'failed'),
      delivery_observed_at = pg_catalog.now()
    where detail.message_id = new.id;
  end if;

  return new;
end;
$$;

create trigger messages_sync_delivery_reconciliation
after update of delivery_state on public.messages
for each row execute function private.sync_message_delivery_reconciliation();

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
  v_recipient_id uuid;
  v_workspace_id uuid;
begin
  if p_delivery_state not in ('sent', 'delivered', 'failed') then
    raise exception using
      errcode = '22023',
      message = 'Invalid SMS delivery state.';
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

  if v_message.dispatch_state <> 'accepted' then
    raise exception using
      errcode = '55000',
      message = 'Only an accepted message has an SMS delivery state.';
  end if;

  if v_message.delivery_state = 'failed'
    or (v_message.delivery_state = 'delivered' and p_delivery_state = 'sent')
    or v_message.delivery_state = p_delivery_state
  then
    update private.message_provider_details as detail
    set
      delivery_status_pending = v_message.delivery_state
        not in ('delivered', 'failed'),
      delivery_observed_at = coalesce(delivery_observed_at, p_at)
    where detail.message_id = p_message_id;
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

  update private.message_provider_details as detail
  set
    delivery_status_pending = p_delivery_state = 'sent',
    delivery_observed_at = p_at
  where detail.message_id = p_message_id;

  if p_delivery_state = 'failed'
    and v_message.campaign_id is not null
    and v_message.campaign_recipient_id is not null
  then
    v_campaign_id := v_message.campaign_id;
    v_recipient_id := v_message.campaign_recipient_id;

    perform 1
    from public.campaigns as campaign
    where campaign.id = v_campaign_id
    for update;

    perform 1
    from public.campaign_recipients as recipient
    where recipient.id = v_recipient_id
    for update;

    for v_future_message_id in
      select future_message.id
      from public.messages as future_message
      where future_message.campaign_recipient_id = v_recipient_id
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
    where campaign_recipient_id = v_recipient_id
      and step_order > v_message.step_order
      and dispatch_state = 'pending';

    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_at,
      stop_reason = 'failed',
      finished_at = null
    where id = v_recipient_id
      and state in ('active', 'finished');

    perform private.complete_campaigns_without_active_recipients(v_campaign_id);
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
        or detail.delivery_status_pending
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
    and (p_provider_cost_micro_usd < 0 or p_provider_cost_pending)
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid provider cost observation.';
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

  if v_detail.provider_cost_micro_usd is not null
    and p_provider_cost_micro_usd is not null
    and v_detail.provider_cost_micro_usd <> p_provider_cost_micro_usd
  then
    raise exception using
      errcode = '23514',
      message = 'Provider cost cannot be changed after reconciliation.';
  end if;

  v_message := private.record_message_actual_segments(
    p_message_id,
    p_actual_segments
  );

  update private.message_provider_details as detail
  set
    provider_cost_micro_usd = coalesce(
      provider_cost_micro_usd,
      p_provider_cost_micro_usd
    ),
    provider_currency = case
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
        is not null then 'USD'
      else provider_currency
    end,
    provider_cost_pending = case
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
        is not null then false
      else p_provider_cost_pending
    end,
    provider_cost_observed_at = case
      when p_provider_cost_micro_usd is not null then p_reconciled_at
      else provider_cost_observed_at
    end,
    reconciliation_state = case
      when delivery_status_pending
        or (
          coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd) is null
          and p_provider_cost_pending
        ) then 'deferred'
      else 'complete'
    end,
    reconciliation_next_attempt_at = case
      when delivery_status_pending
        or (
          coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd) is null
          and p_provider_cost_pending
        ) then p_reconciled_at + interval '1 day'
      else null
    end,
    reconciliation_reason = case
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd) is null
        and p_provider_cost_pending then 'provider_cost_pending'
      when delivery_status_pending then 'delivery_status_pending'
      else null
    end,
    reconciled_at = p_reconciled_at
  where detail.message_id = p_message_id;

  update private.billing_usage_ledger as ledger
  set provider_cost_micro_usd = coalesce(
    provider_cost_micro_usd,
    p_provider_cost_micro_usd
  )
  where ledger.message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function public.reconciliation_record_delivery_state(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_delivery_state text,
  p_observed_at timestamptz
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail private.message_provider_details;
  v_message public.messages;
begin
  if p_delivery_state not in ('sent', 'delivered', 'failed')
    or p_observed_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid delivery observation.';
  end if;

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

  if v_message.id is null
    or v_detail.message_id is null
    or v_detail.reconciliation_token is distinct from p_reconciliation_token
    or v_detail.reconciliation_state not in ('claimed', 'deferred', 'complete')
  then
    raise exception using
      errcode = '55000',
      message = 'Reconciliation claim is no longer valid.';
  end if;

  v_message := private.record_message_delivery_state(
    p_message_id,
    p_delivery_state,
    p_observed_at
  );

  update private.message_provider_details as detail
  set
    delivery_status_pending = v_message.delivery_state
      not in ('delivered', 'failed'),
    delivery_observed_at = p_observed_at
  where detail.message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function public.reconciliation_record_provider_cost(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_provider_cost_micro_usd bigint,
  p_provider_cost_pending boolean,
  p_observed_at timestamptz
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_detail private.message_provider_details;
  v_message public.messages;
begin
  if p_observed_at is null
    or (p_provider_cost_micro_usd is null and not p_provider_cost_pending)
    or (
      p_provider_cost_micro_usd is not null
      and (p_provider_cost_micro_usd < 0 or p_provider_cost_pending)
    )
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid provider cost observation.';
  end if;

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

  if v_message.id is null
    or v_detail.message_id is null
    or v_detail.reconciliation_token is distinct from p_reconciliation_token
    or v_detail.reconciliation_state not in ('claimed', 'deferred', 'complete')
  then
    raise exception using
      errcode = '55000',
      message = 'Reconciliation claim is no longer valid.';
  end if;

  if v_detail.provider_cost_micro_usd is not null
    and p_provider_cost_micro_usd is not null
    and v_detail.provider_cost_micro_usd <> p_provider_cost_micro_usd
  then
    raise exception using
      errcode = '23514',
      message = 'Provider cost cannot be changed after reconciliation.';
  end if;

  update private.message_provider_details as detail
  set
    provider_cost_micro_usd = coalesce(
      provider_cost_micro_usd,
      p_provider_cost_micro_usd
    ),
    provider_currency = case
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
        is not null then 'USD'
      else provider_currency
    end,
    provider_cost_pending = case
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
        is not null then false
      else true
    end,
    provider_cost_observed_at = p_observed_at,
    reconciliation_state = case
      when reconciliation_state = 'claimed' then 'claimed'
      when v_message.num_segments is not null
        and not delivery_status_pending
        and coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
          is not null then 'complete'
      else 'deferred'
    end,
    reconciliation_next_attempt_at = case
      when reconciliation_state = 'claimed' then reconciliation_next_attempt_at
      when v_message.num_segments is not null
        and not delivery_status_pending
        and coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd)
          is not null then null
      else p_observed_at + interval '1 day'
    end,
    reconciliation_reason = case
      when reconciliation_state = 'claimed' then reconciliation_reason
      when coalesce(provider_cost_micro_usd, p_provider_cost_micro_usd) is null
        then 'provider_cost_pending'
      when v_message.num_segments is null then 'segments_pending'
      when delivery_status_pending then 'delivery_status_pending'
      else null
    end,
    reconciled_at = case
      when p_provider_cost_micro_usd is not null then p_observed_at
      else reconciled_at
    end
  where detail.message_id = p_message_id;

  update private.billing_usage_ledger as ledger
  set provider_cost_micro_usd = coalesce(
    provider_cost_micro_usd,
    p_provider_cost_micro_usd
  )
  where ledger.message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function private.reject_manual_message_reservation(
  p_message_id uuid,
  p_failure_code text,
  p_failed_at timestamptz
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  select message.*
  into v_message
  from public.messages as message
  join private.manual_message_dispatches as manual
    on manual.message_id = message.id
  where message.id = p_message_id
  for update of message;

  if not found then
    raise exception using errcode = 'P0002', message = 'Manual message not found.';
  end if;

  if v_message.dispatch_state = 'failed' then
    return v_message;
  end if;

  if v_message.dispatch_state <> 'reserved'
    or v_message.dispatch_started_at is not null
  then
    raise exception using
      errcode = '55000',
      message = 'Manual message reservation cannot be released.';
  end if;

  perform private.release_unresolved_message_reservation(p_message_id);

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = p_failed_at,
    failure_code = p_failure_code
  where id = p_message_id
  returning * into v_message;

  return v_message;
end;
$$;

create or replace function public.manual_message_claim_and_reserve(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_phone_number_id uuid,
  p_body text,
  p_estimated_segments integer,
  p_request_id uuid,
  p_now timestamptz
)
returns table (
  disposition text,
  message_id uuid,
  workspace_id uuid,
  contact_id uuid,
  claim_token uuid,
  reservation_id uuid,
  estimated_segments integer,
  dispatch_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_claim_token uuid;
  v_contact public.contacts;
  v_effective_usage integer;
  v_existing_message_id uuid;
  v_message public.messages;
  v_period_id uuid;
  v_safety_cap integer;
  v_server_estimate integer;
begin
  if p_request_id is null
    or p_now is null
    or v_body = ''
    or pg_catalog.char_length(v_body) > 1600
    or p_body is distinct from v_body
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid manual message request.';
  end if;

  v_server_estimate := private.estimate_sms_segments(v_body);
  if p_estimated_segments is distinct from v_server_estimate
    or v_server_estimate < 1
  then
    raise exception using
      errcode = '22023',
      message = 'Manual message SMS credit estimate is invalid.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select manual.message_id, manual.claim_token
  into v_existing_message_id, v_claim_token
  from private.manual_message_dispatches as manual
  join public.messages as message on message.id = manual.message_id
  where manual.workspace_id = p_workspace_id
    and manual.request_id = p_request_id
  for update of message, manual;

  if found then
    select message.*
    into v_message
    from public.messages as message
    where message.id = v_existing_message_id;

    if v_message.contact_id <> p_contact_id
      or v_message.phone_number_id <> p_phone_number_id
      or v_message.body <> v_body
      or v_message.estimated_segments <> v_server_estimate
    then
      raise exception using
        errcode = '23514',
        message = 'Manual message request correlation failed.';
    end if;

    return query select
      'already_claimed'::text,
      v_message.id,
      v_message.workspace_id,
      v_message.contact_id,
      v_claim_token,
      v_claim_token,
      v_message.estimated_segments,
      v_message.dispatch_state;
    return;
  end if;

  if exists (
    select 1
    from private.manual_message_dispatches as manual
    join public.messages as message on message.id = manual.message_id
    where message.workspace_id = p_workspace_id
      and message.contact_id = p_contact_id
      and message.phone_number_id = p_phone_number_id
      and message.dispatch_state = 'dispatch_unknown'
  ) then
    raise exception using
      errcode = '55000',
      message = 'An earlier manual message requires reconciliation.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
    and contact.workspace_id = p_workspace_id
  for update;

  if not found or v_contact.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'This contact is no longer available.';
  end if;

  if exists (
    select 1
    from public.suppressions as suppression
    where suppression.workspace_id = p_workspace_id
      and suppression.phone_e164 = v_contact.phone_e164
  ) then
    raise exception using
      errcode = '55000',
      message = 'This contact cannot receive messages.';
  end if;

  if not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = p_phone_number_id
      and phone_number.workspace_id = p_workspace_id
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
    where control.workspace_id = p_workspace_id
      and control.messaging_enabled
  ) then
    raise exception using
      errcode = '55000',
      message = 'Messaging is unavailable for this workspace.';
  end if;

  v_period_id := private.ensure_current_billing_period(p_workspace_id, p_now);

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
  where usage.billing_period_id = v_period_id
  for update of usage;

  if v_effective_usage + v_server_estimate > v_safety_cap then
    raise exception using
      errcode = '23514',
      message = 'The SMS usage safety cap has been reached.';
  end if;

  v_claim_token := gen_random_uuid();

  insert into public.messages (
    workspace_id,
    contact_id,
    phone_number_id,
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
    p_contact_id,
    p_phone_number_id,
    'outbound',
    v_body,
    'reserved',
    v_server_estimate,
    v_server_estimate,
    v_period_id,
    v_claim_token,
    p_now,
    p_now
  )
  returning * into v_message;

  insert into private.manual_message_dispatches (
    message_id,
    workspace_id,
    request_id,
    claim_token
  )
  values (
    v_message.id,
    p_workspace_id,
    p_request_id,
    v_claim_token
  );

  update public.billing_period_usage
  set reserved_outbound_segments =
    reserved_outbound_segments + v_server_estimate
  where billing_period_id = v_period_id;

  return query select
    'claimed'::text,
    v_message.id,
    v_message.workspace_id,
    v_message.contact_id,
    v_claim_token,
    v_claim_token,
    v_server_estimate,
    v_message.dispatch_state;
end;
$$;

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
  v_contact public.contacts;
  v_effective_usage integer;
  v_message public.messages;
  v_safety_cap integer;
begin
  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    return jsonb_build_object('authorized', false, 'code', 'reservation_invalid');
  end if;

  select message.*
  into v_message
  from public.messages as message
  join private.manual_message_dispatches as manual
    on manual.message_id = message.id
  where message.id = p_message_id
    and message.workspace_id = p_workspace_id
    and manual.claim_token = p_claim_token
  for update of message, manual;

  if not found
    or v_message.dispatch_state <> 'reserved'
    or v_message.reservation_token is distinct from p_claim_token
    or v_message.dispatch_started_at is not null
  then
    return jsonb_build_object('authorized', false, 'code', 'reservation_invalid');
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = v_message.contact_id
    and contact.workspace_id = p_workspace_id
  for update;

  if not found or v_contact.deleted_at is not null then
    perform private.reject_manual_message_reservation(
      p_message_id,
      'contact_deleted',
      p_now
    );
    return jsonb_build_object('authorized', false, 'code', 'contact_unavailable');
  end if;

  if exists (
    select 1
    from public.suppressions as suppression
    where suppression.workspace_id = p_workspace_id
      and suppression.phone_e164 = v_contact.phone_e164
  ) then
    perform private.reject_manual_message_reservation(
      p_message_id,
      'contact_opted_out',
      p_now
    );
    return jsonb_build_object('authorized', false, 'code', 'contact_opted_out');
  end if;

  if not exists (
    select 1
    from private.workspace_messaging_controls as control
    where control.workspace_id = p_workspace_id
      and control.messaging_enabled
  ) then
    perform private.reject_manual_message_reservation(
      p_message_id,
      'messaging_unavailable',
      p_now
    );
    return jsonb_build_object('authorized', false, 'code', 'messaging_unavailable');
  end if;

  if not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = v_message.phone_number_id
      and phone_number.workspace_id = p_workspace_id
      and phone_number.status = 'ready'
      and phone_number.deleted_at is null
  ) then
    perform private.reject_manual_message_reservation(
      p_message_id,
      'phone_number_not_ready',
      p_now
    );
    return jsonb_build_object('authorized', false, 'code', 'phone_number_not_ready');
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

  if v_effective_usage is null or v_effective_usage > v_safety_cap then
    perform private.reject_manual_message_reservation(
      p_message_id,
      'usage_safety_cap_reached',
      p_now
    );
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

  return jsonb_build_object(
    'authorized', true,
    'message_id', v_message.id,
    'workspace_id', v_message.workspace_id,
    'contact_id', v_message.contact_id,
    'from', (
      select phone_number.phone_e164
      from public.phone_numbers as phone_number
      where phone_number.id = v_message.phone_number_id
    ),
    'to', v_contact.phone_e164,
    'body', v_message.body
  );
end;
$$;

create or replace function private.accept_manual_message(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_accepted_at timestamptz,
  p_persisted_at timestamptz
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_included_snapshot integer;
  v_message public.messages;
  v_new_period_id uuid;
  v_next_usage_position bigint;
  v_old_reserved_usage integer;
  v_overage_snapshot bigint;
  v_workspace_id uuid;
begin
  if pg_catalog.btrim(coalesce(p_provider, '')) = ''
    or pg_catalog.btrim(coalesce(p_provider_message_id, '')) = ''
    or p_accepted_at is null
    or p_persisted_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid accepted manual message details.';
  end if;

  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  join private.manual_message_dispatches as manual
    on manual.message_id = message.id
  where message.id = p_message_id
    and manual.claim_token = p_claim_token;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Manual message not found.';
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

  if v_message.dispatch_state = 'accepted' then
    return v_message;
  end if;

  if v_message.reservation_token is distinct from p_claim_token
    or v_message.dispatch_state <> 'dispatch_unknown'
    or v_message.dispatch_started_at is null
  then
    raise exception using
      errcode = '55000',
      message = 'Manual message dispatch was not started.';
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
    provider_status,
    accepted_persisted_at,
    delivery_status_pending
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    pg_catalog.btrim(p_provider_message_id),
    'accepted',
    p_persisted_at,
    true
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = excluded.provider_message_id,
    provider_status = excluded.provider_status,
    provider_error_code = null,
    provider_error_message = null,
    accepted_persisted_at = excluded.accepted_persisted_at,
    delivery_status_pending = true;

  return v_message;
end;
$$;

create or replace function public.manual_message_mark_accepted(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_accepted_at timestamptz,
  p_persisted_at timestamptz
)
returns public.messages
language sql
security definer
set search_path = ''
as $$
  select private.accept_manual_message(
    p_message_id,
    p_claim_token,
    p_provider,
    p_provider_message_id,
    p_accepted_at,
    p_persisted_at
  );
$$;

create or replace function public.manual_message_mark_known_failure_and_release(
  p_message_id uuid,
  p_claim_token uuid,
  p_provider text,
  p_provider_message_id text,
  p_provider_error_code text,
  p_provider_error_message text,
  p_failed_at timestamptz
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages;
begin
  if pg_catalog.btrim(coalesce(p_provider, '')) = '' or p_failed_at is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid manual message failure details.';
  end if;

  select message.*
  into v_message
  from public.messages as message
  join private.manual_message_dispatches as manual
    on manual.message_id = message.id
  where message.id = p_message_id
    and manual.claim_token = p_claim_token
  for update of message, manual;

  if not found then
    raise exception using errcode = 'P0002', message = 'Manual message not found.';
  end if;

  if v_message.dispatch_state = 'failed' then
    return v_message;
  end if;

  if v_message.dispatch_state <> 'dispatch_unknown'
    or v_message.reservation_token is distinct from p_claim_token
  then
    raise exception using
      errcode = '55000',
      message = 'Manual message dispatch was not started.';
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
    provider_error_message,
    provider_cost_pending,
    reconciliation_state,
    delivery_status_pending,
    delivery_observed_at,
    reconciled_at
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    nullif(pg_catalog.btrim(p_provider_message_id), ''),
    'failed',
    nullif(pg_catalog.btrim(p_provider_error_code), ''),
    nullif(pg_catalog.btrim(p_provider_error_message), ''),
    true,
    'deferred',
    false,
    p_failed_at,
    p_failed_at
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = excluded.provider_message_id,
    provider_status = excluded.provider_status,
    provider_error_code = excluded.provider_error_code,
    provider_error_message = excluded.provider_error_message,
    delivery_status_pending = false,
    delivery_observed_at = excluded.delivery_observed_at;

  return v_message;
end;
$$;

create or replace function public.manual_message_mark_unknown(
  p_message_id uuid,
  p_claim_token uuid,
  p_unknown_reason text,
  p_provider text,
  p_provider_message_id text,
  p_provider_error_code text,
  p_provider_error_message text,
  p_marked_at timestamptz
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
  )
    or pg_catalog.btrim(coalesce(p_provider, '')) = ''
    or p_marked_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid manual dispatch reconciliation details.';
  end if;

  select message.*
  into v_message
  from public.messages as message
  join private.manual_message_dispatches as manual
    on manual.message_id = message.id
  where message.id = p_message_id
    and manual.claim_token = p_claim_token
  for update of message, manual;

  if not found then
    raise exception using errcode = 'P0002', message = 'Manual message not found.';
  end if;

  if v_message.dispatch_state in ('accepted', 'failed') then
    return v_message;
  end if;

  if v_message.dispatch_state <> 'dispatch_unknown'
    or v_message.reservation_token is distinct from p_claim_token
  then
    raise exception using
      errcode = '55000',
      message = 'Manual message is not awaiting dispatch reconciliation.';
  end if;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status,
    provider_error_code,
    provider_error_message,
    reconciliation_state,
    reconciliation_next_attempt_at,
    reconciliation_reason,
    delivery_status_pending
  )
  values (
    p_message_id,
    pg_catalog.btrim(p_provider),
    nullif(pg_catalog.btrim(p_provider_message_id), ''),
    'dispatch_unknown',
    nullif(pg_catalog.btrim(p_provider_error_code), ''),
    nullif(pg_catalog.btrim(p_provider_error_message), ''),
    'pending',
    p_marked_at,
    p_unknown_reason,
    true
  )
  on conflict (message_id) do update
  set
    provider = excluded.provider,
    provider_message_id = coalesce(
      excluded.provider_message_id,
      private.message_provider_details.provider_message_id
    ),
    provider_status = excluded.provider_status,
    provider_error_code = excluded.provider_error_code,
    provider_error_message = excluded.provider_error_message,
    reconciliation_state = 'pending',
    reconciliation_next_attempt_at = excluded.reconciliation_next_attempt_at,
    reconciliation_reason = excluded.reconciliation_reason;

  return v_message;
end;
$$;

create table private.dispatch_reconciliation_resolutions (
  message_id uuid primary key references public.messages (id) on delete restrict,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  resolved_by uuid not null references auth.users (id) on delete restrict,
  resolution text not null,
  resolution_note text,
  provider text,
  provider_message_id text,
  accepted_at timestamptz,
  resolved_at timestamptz not null,
  constraint dispatch_reconciliation_resolutions_resolution_valid check (
    resolution in ('confirmed_not_sent', 'confirmed_sent')
  ),
  constraint dispatch_reconciliation_resolutions_sent_shape check (
    (
      resolution = 'confirmed_sent'
      and provider is not null
      and provider_message_id is not null
      and accepted_at is not null
    )
    or (
      resolution = 'confirmed_not_sent'
      and provider is null
      and provider_message_id is null
      and accepted_at is null
    )
  )
);

create or replace function public.admin_resolve_dispatch_unknown_not_sent(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_message_id uuid,
  p_resolved_at timestamptz,
  p_resolution_note text
)
returns table (
  dispatch_state text,
  message_id uuid,
  resolved boolean,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.dispatch_reconciliation_resolutions;
  v_message public.messages;
begin
  if p_admin_user_id is null or p_resolved_at is null then
    raise exception using
      errcode = '22023',
      message = 'Invalid dispatch reconciliation resolution.';
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

  select resolution.*
  into v_existing
  from private.dispatch_reconciliation_resolutions as resolution
  where resolution.message_id = p_message_id
  for update;

  if found then
    if v_existing.workspace_id <> p_workspace_id
      or v_existing.resolution <> 'confirmed_not_sent'
    then
      raise exception using
        errcode = '23514',
        message = 'Dispatch reconciliation is already resolved differently.';
    end if;

    select message.* into v_message
    from public.messages as message
    where message.id = p_message_id;

    return query select
      v_message.dispatch_state,
      v_message.id,
      true,
      v_message.workspace_id;
    return;
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
    and message.workspace_id = p_workspace_id
  for update;

  if not found or v_message.dispatch_state <> 'dispatch_unknown' then
    return query select
      coalesce(v_message.dispatch_state, 'unavailable'),
      p_message_id,
      false,
      p_workspace_id;
    return;
  end if;

  perform private.release_unresolved_message_reservation(p_message_id);

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = p_resolved_at,
    failure_code = 'operator_confirmed_not_sent'
  where id = p_message_id
  returning * into v_message;

  if v_message.campaign_recipient_id is not null then
    update public.campaign_recipients
    set
      state = 'stopped',
      next_send_at = null,
      stopped_at = p_resolved_at,
      stop_reason = 'failed',
      finished_at = null
    where id = v_message.campaign_recipient_id;

    perform private.complete_campaigns_without_active_recipients(
      v_message.campaign_id
    );
  end if;

  update private.message_provider_details as detail
  set
    provider_status = 'operator_confirmed_not_sent',
    provider_cost_micro_usd = 0,
    provider_currency = 'USD',
    provider_cost_pending = false,
    delivery_status_pending = false,
    delivery_observed_at = p_resolved_at,
    provider_cost_observed_at = p_resolved_at,
    reconciliation_state = 'complete',
    reconciliation_next_attempt_at = null,
    reconciliation_reason = 'operator_confirmed_not_sent',
    reconciled_at = p_resolved_at
  where detail.message_id = p_message_id;

  insert into private.dispatch_reconciliation_resolutions (
    message_id,
    workspace_id,
    resolved_by,
    resolution,
    resolution_note,
    resolved_at
  )
  values (
    p_message_id,
    p_workspace_id,
    p_admin_user_id,
    'confirmed_not_sent',
    nullif(pg_catalog.btrim(p_resolution_note), ''),
    p_resolved_at
  );

  return query select
    v_message.dispatch_state,
    v_message.id,
    true,
    v_message.workspace_id;
end;
$$;

create or replace function public.admin_resolve_dispatch_unknown_sent(
  p_admin_user_id uuid,
  p_workspace_id uuid,
  p_message_id uuid,
  p_provider text,
  p_provider_message_id text,
  p_accepted_at timestamptz,
  p_resolved_at timestamptz,
  p_resolution_note text
)
returns table (
  dispatch_state text,
  message_id uuid,
  resolved boolean,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.dispatch_reconciliation_resolutions;
  v_is_manual boolean;
  v_message public.messages;
begin
  if p_admin_user_id is null
    or p_accepted_at is null
    or p_resolved_at is null
    or pg_catalog.btrim(coalesce(p_provider, '')) = ''
    or pg_catalog.btrim(coalesce(p_provider_message_id, '')) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid dispatch reconciliation resolution.';
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

  select resolution.*
  into v_existing
  from private.dispatch_reconciliation_resolutions as resolution
  where resolution.message_id = p_message_id
  for update;

  if found then
    if v_existing.workspace_id <> p_workspace_id
      or v_existing.resolution <> 'confirmed_sent'
      or v_existing.provider <> pg_catalog.btrim(p_provider)
      or v_existing.provider_message_id <> pg_catalog.btrim(p_provider_message_id)
    then
      raise exception using
        errcode = '23514',
        message = 'Dispatch reconciliation is already resolved differently.';
    end if;

    select message.* into v_message
    from public.messages as message
    where message.id = p_message_id;

    return query select
      v_message.dispatch_state,
      v_message.id,
      true,
      v_message.workspace_id;
    return;
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
    and message.workspace_id = p_workspace_id
  for update;

  if not found or v_message.dispatch_state <> 'dispatch_unknown' then
    return query select
      coalesce(v_message.dispatch_state, 'unavailable'),
      p_message_id,
      false,
      p_workspace_id;
    return;
  end if;

  select exists (
    select 1
    from private.manual_message_dispatches as manual
    where manual.message_id = p_message_id
  ) into v_is_manual;

  if v_is_manual then
    v_message := private.accept_manual_message(
      p_message_id,
      v_message.reservation_token,
      p_provider,
      p_provider_message_id,
      p_accepted_at,
      p_resolved_at
    );
  else
    v_message := private.mark_message_accepted(
      p_message_id,
      v_message.reservation_token,
      p_provider,
      p_provider_message_id,
      p_accepted_at
    );
  end if;

  insert into private.dispatch_reconciliation_resolutions (
    message_id,
    workspace_id,
    resolved_by,
    resolution,
    resolution_note,
    provider,
    provider_message_id,
    accepted_at,
    resolved_at
  )
  values (
    p_message_id,
    p_workspace_id,
    p_admin_user_id,
    'confirmed_sent',
    nullif(pg_catalog.btrim(p_resolution_note), ''),
    pg_catalog.btrim(p_provider),
    pg_catalog.btrim(p_provider_message_id),
    p_accepted_at,
    p_resolved_at
  );

  return query select
    v_message.dispatch_state,
    v_message.id,
    true,
    v_message.workspace_id;
end;
$$;

-- The simulated Slice 4 mutation is intentionally retired once a real
-- provider adapter is wired. Keeping it executable would bypass the dispatch
-- fence and provider reconciliation.
revoke all on function public.send_manual_message_simulated(uuid, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on table private.workspace_provider_accounts
  from public, anon, authenticated;
revoke all on table private.workspace_provider_setup_operations
  from public, anon, authenticated;
revoke all on table private.phone_number_operations
  from public, anon, authenticated;
revoke all on table private.phone_number_setup_history
  from public, anon, authenticated;
revoke all on table private.phone_number_activation_attempts
  from public, anon, authenticated;
revoke all on table private.manual_message_dispatches
  from public, anon, authenticated;
revoke all on table private.dispatch_reconciliation_resolutions
  from public, anon, authenticated;

revoke all on function public.messaging_claim_workspace_setup(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.messaging_record_workspace_account(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.messaging_complete_workspace_setup(
  uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.messaging_mark_workspace_setup_unknown(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.messaging_get_workspace_credentials(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_phone_number_purchase(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_phone_number_purchase(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.mark_phone_number_purchase_unknown(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.claim_phone_number_release(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_phone_number_release(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_phone_number_release_unknown(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_confirm_workspace_advanced_opt_out(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_record_phone_number_setup_state(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_claim_approved_number_activation(
  uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_fail_approved_number_activation(
  uuid, uuid, timestamptz, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.admin_get_number_operations(integer)
  from public, anon, authenticated;
revoke all on function public.reconciliation_record_delivery_state(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.reconciliation_record_provider_cost(
  uuid, uuid, bigint, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.manual_message_claim_and_reserve(
  uuid, uuid, uuid, text, integer, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.manual_message_final_validate_and_begin_attempt(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.manual_message_mark_accepted(
  uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.manual_message_mark_known_failure_and_release(
  uuid, uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.manual_message_mark_unknown(
  uuid, uuid, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.admin_resolve_dispatch_unknown_not_sent(
  uuid, uuid, uuid, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.admin_resolve_dispatch_unknown_sent(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.messaging_claim_workspace_setup(uuid, uuid)
  to service_role;
grant execute on function public.messaging_record_workspace_account(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.messaging_complete_workspace_setup(
  uuid, uuid, text
) to service_role;
grant execute on function public.messaging_mark_workspace_setup_unknown(
  uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.messaging_get_workspace_credentials(uuid)
  to service_role;
grant execute on function public.claim_phone_number_purchase(
  uuid, uuid, text, text, jsonb
) to service_role;
grant execute on function public.complete_phone_number_purchase(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.mark_phone_number_purchase_unknown(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.claim_phone_number_release(uuid, uuid, uuid)
  to service_role;
grant execute on function public.complete_phone_number_release(uuid, uuid, uuid)
  to service_role;
grant execute on function public.mark_phone_number_release_unknown(
  uuid, uuid, uuid, text, text, text
) to service_role;
grant execute on function public.admin_confirm_workspace_advanced_opt_out(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.admin_record_phone_number_setup_state(
  uuid, uuid, uuid, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.admin_claim_approved_number_activation(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.admin_fail_approved_number_activation(
  uuid, uuid, timestamptz, text, uuid, uuid
) to service_role;
grant execute on function public.admin_get_number_operations(integer)
  to service_role;
grant execute on function public.reconciliation_record_delivery_state(
  uuid, uuid, text, timestamptz
) to service_role;
grant execute on function public.reconciliation_record_provider_cost(
  uuid, uuid, bigint, boolean, timestamptz
) to service_role;
grant execute on function public.manual_message_claim_and_reserve(
  uuid, uuid, uuid, text, integer, uuid, timestamptz
) to service_role;
grant execute on function public.manual_message_final_validate_and_begin_attempt(
  uuid, uuid, uuid, timestamptz
) to service_role;
grant execute on function public.manual_message_mark_accepted(
  uuid, uuid, text, text, timestamptz, timestamptz
) to service_role;
grant execute on function public.manual_message_mark_known_failure_and_release(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.manual_message_mark_unknown(
  uuid, uuid, text, text, text, text, text, timestamptz
) to service_role;
grant execute on function public.admin_resolve_dispatch_unknown_not_sent(
  uuid, uuid, uuid, timestamptz, text
) to service_role;
grant execute on function public.admin_resolve_dispatch_unknown_sent(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz, text
) to service_role;

revoke all on function private.normalize_message_provider_reconciliation()
  from public, anon, authenticated;
revoke all on function private.sync_message_delivery_reconciliation()
  from public, anon, authenticated;
revoke all on function private.reject_manual_message_reservation(
  uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function private.accept_manual_message(
  uuid, uuid, text, text, timestamptz, timestamptz
) from public, anon, authenticated;

comment on table private.workspace_provider_accounts is
  'Encrypted provider credentials and identifiers; never exposed to workspace clients.';
comment on table private.phone_number_operations is
  'Idempotent purchase/release fences and private onboarding evidence.';
comment on table private.manual_message_dispatches is
  'Private idempotency keys for real manual-message dispatch.';
comment on function public.manual_message_final_validate_and_begin_attempt(
  uuid, uuid, uuid, timestamptz
) is
  'Performs the final manual-send validation and durably fences one provider attempt.';

commit;
