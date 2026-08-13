begin;

alter table private.phone_number_operations
  drop constraint phone_number_operations_purchase_shape,
  drop constraint phone_number_operations_release_shape,
  add constraint phone_number_operations_purchase_shape check (
    operation_type <> 'purchase'
    or (
      (
        requested_phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
        or requested_phone_e164 ~ '^[+]33[1-79][0-9]{8}$'
      )
      and selection_nonce is not null
      and selection_nonce = btrim(selection_nonce)
      and char_length(selection_nonce) between 1 and 2000
      and jsonb_typeof(business_verification) = 'object'
      and original_phone_e164 is null
    )
  ),
  add constraint phone_number_operations_release_shape check (
    operation_type <> 'release'
    or (
      requested_phone_e164 is null
      and selection_nonce is null
      and business_verification is null
      and (
        original_phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
        or original_phone_e164 ~ '^[+]33[1-79][0-9]{8}$'
      )
      and provider_number_id is not null
    )
  );

-- Number search and selection now support US NANP and French +33 numbers.
-- Keep the durable purchase claim as the final server-side format boundary.
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
  if not (
      v_phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
      or v_phone_e164 ~ '^[+]33[1-79][0-9]{8}$'
    )
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

create table private.configured_number_connections (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  operation_id uuid not null unique,
  phone_number_id uuid not null unique references public.phone_numbers (id) on delete cascade,
  provider_number_id text not null unique,
  state text not null default 'claimed',
  provider_error_code text,
  provider_error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint configured_number_connections_state_valid check (
    state in ('claimed', 'completed', 'reconciliation_required')
  ),
  constraint configured_number_connections_terminal_shape check (
    (state = 'completed' and completed_at is not null)
    or (state <> 'completed' and completed_at is null)
  )
);

create or replace function public.claim_configured_number_connection(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_phone_e164 text,
  p_provider_number_id text
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
  v_connection private.configured_number_connections;
  v_phone_number_id uuid;
  v_phone text := pg_catalog.btrim(coalesce(p_phone_e164, ''));
  v_provider_number text := pg_catalog.btrim(coalesce(p_provider_number_id, ''));
begin
  if p_workspace_id is null
    or p_operation_id is null
    or v_phone !~ '^[+]33[1-79][0-9]{8}$'
    or v_provider_number !~ '^PN[0-9a-fA-F]{32}$'
  then
    raise exception using errcode = '22023', message = 'Invalid configured number connection.';
  end if;

  perform 1 from public.workspaces where id = p_workspace_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select connection.* into v_connection
  from private.configured_number_connections as connection
  where connection.workspace_id = p_workspace_id
     or connection.provider_number_id = v_provider_number
  order by (connection.workspace_id = p_workspace_id) desc
  limit 1
  for update;

  if found then
    return query select
      case v_connection.state
        when 'completed' then 'completed'
        when 'reconciliation_required' then 'reconciliation_required'
        else 'in_progress'
      end,
      v_connection.operation_id,
      v_connection.phone_number_id;
    return;
  end if;

  if exists (
    select 1 from public.phone_numbers
    where phone_e164 = v_phone and deleted_at is null
  ) then
    raise exception using errcode = '23514', message = 'Phone number is already connected.';
  end if;

  insert into public.phone_numbers (
    workspace_id,
    phone_e164,
    status,
    country_code,
    number_source
  ) values (
    p_workspace_id,
    v_phone,
    'pending',
    'FR',
    'included'
  ) returning id into v_phone_number_id;

  insert into private.configured_number_connections (
    workspace_id,
    operation_id,
    phone_number_id,
    provider_number_id
  ) values (
    p_workspace_id,
    p_operation_id,
    v_phone_number_id,
    v_provider_number
  );

  return query select 'claimed'::text, p_operation_id, v_phone_number_id;
end;
$$;

create or replace function public.complete_configured_number_connection(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider text,
  p_provider_number_id text,
  p_provider_status text,
  p_completed_at timestamptz
)
returns table (completed boolean, phone_number_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection private.configured_number_connections;
begin
  select connection.* into v_connection
  from private.configured_number_connections as connection
  where connection.workspace_id = p_workspace_id
    and connection.operation_id = p_operation_id
  for update;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  if v_connection.provider_number_id <> pg_catalog.btrim(p_provider_number_id) then
    return query select false, v_connection.phone_number_id;
    return;
  end if;

  insert into private.phone_number_provider_details (
    phone_number_id,
    provider,
    provider_number_id,
    provider_status,
    setup_state,
    a2p_state
  ) values (
    v_connection.phone_number_id,
    pg_catalog.btrim(p_provider),
    v_connection.provider_number_id,
    pg_catalog.btrim(p_provider_status),
    'ready',
    'approved'
  )
  on conflict (phone_number_id) do update set
    provider = excluded.provider,
    provider_number_id = excluded.provider_number_id,
    provider_status = excluded.provider_status,
    setup_state = 'ready',
    a2p_state = 'approved',
    provider_error_code = null,
    provider_error_message = null;

  update public.phone_numbers
  set status = 'ready', activated_at = p_completed_at
  where id = v_connection.phone_number_id
    and workspace_id = p_workspace_id;

  update private.configured_number_connections
  set
    state = 'completed',
    completed_at = p_completed_at,
    provider_error_code = null,
    provider_error_message = null
  where workspace_id = p_workspace_id;

  return query select true, v_connection.phone_number_id;
end;
$$;

create or replace function public.mark_configured_number_connection_unknown(
  p_workspace_id uuid,
  p_operation_id uuid,
  p_provider_code text,
  p_provider_message text
)
returns table (recorded boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.configured_number_connections
  set
    state = 'reconciliation_required',
    provider_error_code = nullif(pg_catalog.btrim(coalesce(p_provider_code, '')), ''),
    provider_error_message = left(pg_catalog.btrim(coalesce(p_provider_message, '')), 1000)
  where workspace_id = p_workspace_id
    and operation_id = p_operation_id
    and state = 'claimed';

  return query select found;
end;
$$;

revoke all on table private.configured_number_connections from public, anon, authenticated;
revoke all on function public.claim_configured_number_connection(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_configured_number_connection(uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.mark_configured_number_connection_unknown(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_configured_number_connection(uuid, uuid, text, text)
  to service_role;
grant execute on function public.complete_configured_number_connection(uuid, uuid, text, text, text, timestamptz)
  to service_role;
grant execute on function public.mark_configured_number_connection_unknown(uuid, uuid, text, text)
  to service_role;

commit;
