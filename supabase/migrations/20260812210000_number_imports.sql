begin;

-- Product-safe import state. Provider identifiers and verification material
-- remain in the private schema.
alter table public.phone_numbers
  add column number_source text not null default 'included',
  add column import_status text,
  add column activated_at timestamptz,
  add constraint phone_numbers_source_valid check (
    number_source in ('included', 'imported')
  ),
  add constraint phone_numbers_import_status_valid check (
    import_status is null
    or import_status in (
      'verification',
      'pending',
      'importing',
      'action_required',
      'active',
      'failed'
    )
  ),
  add constraint phone_numbers_import_shape check (
    (number_source = 'included' and import_status is null)
    or (number_source = 'imported' and import_status is not null)
  ),
  add constraint phone_numbers_import_activation_shape check (
    (import_status = 'active' and status = 'ready' and activated_at is not null)
    or (import_status is distinct from 'active')
  );

create table private.phone_number_imports (
  phone_number_id uuid primary key
    references public.phone_numbers (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  operation_id uuid not null unique,
  disconnect_operation_id uuid unique,
  state text not null default 'claimed',
  provider text,
  provider_import_id text unique,
  provider_number_id text,
  provider_status text,
  verification_code text,
  provider_error_code text,
  provider_error_message text,
  provider_resource_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  disconnected_at timestamptz,
  constraint phone_number_imports_workspace_number_key
    unique (workspace_id, phone_number_id),
  constraint phone_number_imports_state_valid check (
    state in (
      'claimed',
      'started',
      'active',
      'failed',
      'disconnecting',
      'disconnected',
      'reconciliation_required'
    )
  ),
  constraint phone_number_imports_provider_values_not_blank check (
    (provider is null or char_length(btrim(provider)) > 0)
    and (provider_import_id is null or char_length(btrim(provider_import_id)) > 0)
    and (provider_number_id is null or char_length(btrim(provider_number_id)) > 0)
    and (provider_status is null or char_length(btrim(provider_status)) > 0)
  ),
  constraint phone_number_imports_started_shape check (
    state in ('claimed', 'reconciliation_required')
    or (provider is not null and provider_import_id is not null)
  ),
  constraint phone_number_imports_disconnect_shape check (
    state not in ('disconnecting', 'disconnected')
    or disconnect_operation_id is not null
  )
);

create index phone_number_imports_workspace_created_idx
  on private.phone_number_imports (workspace_id, created_at desc);

create trigger phone_number_imports_touch_updated_at
before update on private.phone_number_imports
for each row execute function private.touch_updated_at();

-- The commercial allowance is three Riink numbers plus three imported numbers,
-- while the billing snapshot remains the six-number absolute ceiling.
create or replace function private.enforce_phone_number_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_number_count integer;
  v_source_count integer;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = new.workspace_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Workspace not found.';
  end if;

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

  select count(*)::integer
  into v_source_count
  from public.phone_numbers as phone_number
  where phone_number.workspace_id = new.workspace_id
    and phone_number.deleted_at is null
    and phone_number.number_source = new.number_source
    and phone_number.id <> new.id;

  if v_source_count >= 3 then
    raise exception using
      errcode = '23514',
      message = case new.number_source
        when 'imported' then 'This workspace already has three imported phone numbers.'
        else 'This workspace already has three Riink phone numbers.'
      end;
  end if;

  return new;
end;
$$;

drop trigger if exists phone_numbers_enforce_limit on public.phone_numbers;
create trigger phone_numbers_enforce_limit
before insert or update of deleted_at, number_source, workspace_id
on public.phone_numbers
for each row execute function private.enforce_phone_number_limit();

create or replace function public.claim_phone_number_import(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_phone_e164 text,
  p_country_code text
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
  v_existing record;
  v_number_id uuid;
  v_phone text := pg_catalog.btrim(coalesce(p_phone_e164, ''));
  v_country text := upper(pg_catalog.btrim(coalesce(p_country_code, '')));
begin
  if p_workspace_id is null or p_operation_id is null
    or v_country not in ('US', 'CA')
    or v_phone !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  then
    raise exception using errcode = '22023', message = 'Invalid phone number import request.';
  end if;

  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select import.phone_number_id, import.operation_id, import.state
  into v_existing
  from private.phone_number_imports as import
  join public.phone_numbers as phone_number on phone_number.id = import.phone_number_id
  where import.workspace_id = p_workspace_id
    and phone_number.phone_e164 = v_phone
    and phone_number.deleted_at is null
  for update of import, phone_number;

  if found then
    if v_existing.operation_id = p_operation_id and v_existing.state = 'claimed' then
      return query select 'claimed'::text, v_existing.operation_id, v_existing.phone_number_id;
    elsif v_existing.state = 'reconciliation_required' then
      return query select 'reconciliation_required'::text, v_existing.operation_id, v_existing.phone_number_id;
    elsif v_existing.state in ('started', 'active', 'failed') then
      return query select 'already_started'::text, v_existing.operation_id, v_existing.phone_number_id;
    else
      return query select 'in_progress'::text, v_existing.operation_id, v_existing.phone_number_id;
    end if;
    return;
  end if;

  insert into public.phone_numbers (
    workspace_id,
    phone_e164,
    status,
    country_code,
    number_source,
    import_status
  ) values (
    p_workspace_id,
    v_phone,
    'pending',
    v_country,
    'imported',
    'pending'
  )
  returning id into v_number_id;

  insert into private.phone_number_imports (
    phone_number_id,
    workspace_id,
    operation_id
  ) values (
    v_number_id,
    p_workspace_id,
    p_operation_id
  );

  return query select 'claimed'::text, p_operation_id, v_number_id;
end;
$$;

create or replace function public.record_phone_number_import_started(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider text,
  p_provider_import_id text,
  p_provider_status text,
  p_import_status text,
  p_verification_code text
)
returns table (recorded boolean, phone_number_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import private.phone_number_imports;
begin
  if p_import_status not in ('verification', 'pending', 'importing', 'action_required', 'failed')
    or pg_catalog.btrim(coalesce(p_provider, '')) = ''
    or pg_catalog.btrim(coalesce(p_provider_import_id, '')) = ''
    or pg_catalog.btrim(coalesce(p_provider_status, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Invalid phone number import state.';
  end if;

  select import.* into v_import
  from private.phone_number_imports as import
  where import.workspace_id = p_workspace_id
    and import.operation_id = p_operation_id
  for update;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if v_import.provider_import_id is not null
    and v_import.provider_import_id <> pg_catalog.btrim(p_provider_import_id)
  then
    return query select false, v_import.phone_number_id;
    return;
  end if;

  update private.phone_number_imports as import
  set
    state = case when p_import_status = 'failed' then 'failed' else 'started' end,
    provider = pg_catalog.btrim(p_provider),
    provider_import_id = pg_catalog.btrim(p_provider_import_id),
    provider_status = pg_catalog.btrim(p_provider_status),
    verification_code = nullif(pg_catalog.btrim(coalesce(p_verification_code, '')), ''),
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null
  where import.phone_number_id = v_import.phone_number_id;

  update public.phone_numbers
  set import_status = p_import_status
  where id = v_import.phone_number_id;

  return query select true, v_import.phone_number_id;
end;
$$;

create or replace function public.mark_phone_number_import_unknown(
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
begin
  if pg_catalog.btrim(coalesce(p_provider_message, '')) = '' then
    raise exception using errcode = '22023', message = 'Provider failure details are required.';
  end if;

  update private.phone_number_imports
  set
    state = 'reconciliation_required',
    provider_error_code = nullif(pg_catalog.btrim(coalesce(p_provider_code, '')), ''),
    provider_error_message = left(pg_catalog.btrim(p_provider_message), 1000),
    provider_resource_id = nullif(pg_catalog.btrim(coalesce(p_provider_resource_id, '')), '')
  where workspace_id = p_workspace_id
    and operation_id = p_operation_id;

  return query select found;
end;
$$;

create or replace function public.get_phone_number_import_context(
  p_workspace_id uuid,
  p_phone_number_id uuid
)
returns table (
  workspace_id uuid,
  phone_number_id uuid,
  operation_id uuid,
  provider_import_id text,
  provider_number_id text,
  import_status text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    import.workspace_id,
    import.phone_number_id,
    import.operation_id,
    import.provider_import_id,
    import.provider_number_id,
    phone_number.import_status
  from private.phone_number_imports as import
  join public.phone_numbers as phone_number on phone_number.id = import.phone_number_id
  where import.workspace_id = p_workspace_id
    and import.phone_number_id = p_phone_number_id
    and phone_number.deleted_at is null
    and import.provider_import_id is not null;
$$;

create or replace function public.get_phone_number_import_callback_context(
  p_provider_import_id text
)
returns table (workspace_id uuid, phone_number_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select import.workspace_id, import.phone_number_id
  from private.phone_number_imports as import
  where import.provider_import_id = pg_catalog.btrim(p_provider_import_id)
    and import.state <> 'disconnected';
$$;

create or replace function public.update_phone_number_import_status(
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_import_status text,
  p_provider_status text,
  p_provider_number_id text,
  p_verification_code text,
  p_usable boolean,
  p_observed_at timestamptz
)
returns table (updated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import private.phone_number_imports;
begin
  if p_observed_at is null
    or p_import_status not in ('verification', 'pending', 'importing', 'action_required', 'active', 'failed')
    or pg_catalog.btrim(coalesce(p_provider_status, '')) = ''
    or (p_usable and (p_import_status <> 'active' or pg_catalog.btrim(coalesce(p_provider_number_id, '')) = ''))
  then
    raise exception using errcode = '22023', message = 'Invalid phone number import status update.';
  end if;

  select import.* into v_import
  from private.phone_number_imports as import
  where import.workspace_id = p_workspace_id
    and import.phone_number_id = p_phone_number_id
  for update;

  if not found or v_import.provider_import_id is null then
    return query select false;
    return;
  end if;

  update private.phone_number_imports
  set
    state = case
      when p_import_status = 'active' and p_usable then 'active'
      when p_import_status = 'failed' then 'failed'
      else 'started'
    end,
    provider_number_id = coalesce(
      nullif(pg_catalog.btrim(coalesce(p_provider_number_id, '')), ''),
      provider_number_id
    ),
    provider_status = pg_catalog.btrim(p_provider_status),
    verification_code = nullif(pg_catalog.btrim(coalesce(p_verification_code, '')), ''),
    provider_error_code = null,
    provider_error_message = null,
    provider_resource_id = null,
    completed_at = case
      when p_import_status = 'active' and p_usable then p_observed_at
      else completed_at
    end
  where phone_number_id = p_phone_number_id;

  update public.phone_numbers
  set
    import_status = p_import_status,
    status = case when p_import_status = 'active' and p_usable then 'ready' else 'pending' end,
    activated_at = case when p_import_status = 'active' and p_usable then p_observed_at else null end
  where id = p_phone_number_id;

  if p_import_status = 'active' and p_usable then
    insert into private.phone_number_provider_details (
      phone_number_id,
      provider,
      provider_number_id,
      provider_status,
      setup_state,
      a2p_state
    ) values (
      p_phone_number_id,
      v_import.provider,
      pg_catalog.btrim(p_provider_number_id),
      pg_catalog.btrim(p_provider_status),
      'ready',
      'approved'
    )
    on conflict (phone_number_id) do update
    set
      provider = excluded.provider,
      provider_number_id = excluded.provider_number_id,
      provider_status = excluded.provider_status,
      setup_state = 'ready',
      a2p_state = 'approved',
      provider_error_code = null,
      provider_error_message = null;
  end if;

  return query select true;
end;
$$;

create or replace function public.claim_phone_number_import_disconnect(
  p_workspace_id uuid,
  p_phone_number_id uuid,
  p_operation_id uuid
)
returns table (
  disposition text,
  operation_id uuid,
  provider_import_id text,
  provider_number_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_import private.phone_number_imports;
  v_number public.phone_numbers;
begin
  if p_workspace_id is null or p_phone_number_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'Invalid imported number disconnect request.';
  end if;

  select phone_number.* into v_number
  from public.phone_numbers as phone_number
  where phone_number.id = p_phone_number_id
    and phone_number.workspace_id = p_workspace_id
    and phone_number.number_source = 'imported'
  for update;

  if not found or v_number.deleted_at is not null then
    return query select 'already_disconnected'::text, p_operation_id, null::text, null::text;
    return;
  end if;

  if exists (
    select 1 from public.campaigns as campaign
    where campaign.phone_number_id = p_phone_number_id
      and campaign.workspace_id = p_workspace_id
      and campaign.status in ('active', 'paused')
      and campaign.deleted_at is null
  ) then
    raise exception using errcode = '55000', message = 'This phone number is used by an active campaign.';
  end if;

  select import.* into v_import
  from private.phone_number_imports as import
  where import.phone_number_id = p_phone_number_id
    and import.workspace_id = p_workspace_id
  for update;

  if not found or v_import.state = 'disconnected' then
    return query select 'already_disconnected'::text, p_operation_id, v_import.provider_import_id, v_import.provider_number_id;
    return;
  end if;

  if v_import.disconnect_operation_id is not null then
    if v_import.disconnect_operation_id = p_operation_id and v_import.state = 'disconnecting' then
      return query select 'claimed'::text, p_operation_id, v_import.provider_import_id, v_import.provider_number_id;
    elsif v_import.state = 'reconciliation_required' then
      return query select 'reconciliation_required'::text, v_import.disconnect_operation_id, v_import.provider_import_id, v_import.provider_number_id;
    else
      return query select 'in_progress'::text, v_import.disconnect_operation_id, v_import.provider_import_id, v_import.provider_number_id;
    end if;
    return;
  end if;

  update private.phone_number_imports
  set disconnect_operation_id = p_operation_id, state = 'disconnecting'
  where phone_number_id = p_phone_number_id;

  return query select 'claimed'::text, p_operation_id, v_import.provider_import_id, v_import.provider_number_id;
end;
$$;

create or replace function public.complete_phone_number_import_disconnect(
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
  v_import private.phone_number_imports;
begin
  select import.* into v_import
  from private.phone_number_imports as import
  where import.workspace_id = p_workspace_id
    and import.phone_number_id = p_phone_number_id
  for update;

  if not found then
    return query select false;
    return;
  end if;

  if v_import.state = 'disconnected' then
    return query select true;
    return;
  end if;

  if v_import.state <> 'disconnecting'
    or v_import.disconnect_operation_id <> p_operation_id
  then
    return query select false;
    return;
  end if;

  update private.phone_number_imports
  set state = 'disconnected', disconnected_at = now()
  where phone_number_id = p_phone_number_id;

  update public.phone_numbers
  set status = 'pending', import_status = 'failed', activated_at = null, deleted_at = now()
  where id = p_phone_number_id and workspace_id = p_workspace_id;

  update private.phone_number_provider_details
  set setup_state = 'released'
  where phone_number_id = p_phone_number_id;

  return query select true;
end;
$$;

create or replace function public.mark_phone_number_import_disconnect_unknown(
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
begin
  if pg_catalog.btrim(coalesce(p_provider_message, '')) = '' then
    raise exception using errcode = '22023', message = 'Provider failure details are required.';
  end if;

  update private.phone_number_imports
  set
    state = 'reconciliation_required',
    provider_error_code = nullif(pg_catalog.btrim(coalesce(p_provider_code, '')), ''),
    provider_error_message = left(pg_catalog.btrim(p_provider_message), 1000),
    provider_resource_id = nullif(pg_catalog.btrim(coalesce(p_provider_resource_id, '')), '')
  where workspace_id = p_workspace_id
    and phone_number_id = p_phone_number_id
    and disconnect_operation_id = p_operation_id;

  return query select found;
end;
$$;

create or replace function public.get_my_phone_number_import_details()
returns table (
  phone_number_id uuid,
  import_status text,
  verification_code text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    import.phone_number_id,
    phone_number.import_status,
    import.verification_code
  from private.phone_number_imports as import
  join public.phone_numbers as phone_number on phone_number.id = import.phone_number_id
  join public.workspaces as workspace on workspace.id = import.workspace_id
  where workspace.owner_id = (select auth.uid())
    and phone_number.deleted_at is null;
$$;

revoke all on table private.phone_number_imports from public, anon, authenticated;

revoke all on function public.claim_phone_number_import(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.record_phone_number_import_started(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_phone_number_import_unknown(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_phone_number_import_context(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_phone_number_import_callback_context(text)
  from public, anon, authenticated;
revoke all on function public.update_phone_number_import_status(uuid, uuid, text, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_phone_number_import_disconnect(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_phone_number_import_disconnect(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.mark_phone_number_import_disconnect_unknown(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_my_phone_number_import_details()
  from public, anon;

grant execute on function public.claim_phone_number_import(uuid, uuid, text, text)
  to service_role;
grant execute on function public.record_phone_number_import_started(uuid, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.mark_phone_number_import_unknown(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.get_phone_number_import_context(uuid, uuid)
  to service_role;
grant execute on function public.get_phone_number_import_callback_context(text)
  to service_role;
grant execute on function public.update_phone_number_import_status(uuid, uuid, text, text, text, text, boolean, timestamptz)
  to service_role;
grant execute on function public.claim_phone_number_import_disconnect(uuid, uuid, uuid)
  to service_role;
grant execute on function public.complete_phone_number_import_disconnect(uuid, uuid, uuid)
  to service_role;
grant execute on function public.mark_phone_number_import_disconnect_unknown(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.get_my_phone_number_import_details()
  to authenticated, service_role;

comment on table private.phone_number_imports is
  'Private Hosted Number order correlation, verification, and reconciliation state.';

commit;
