begin;

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
  on conflict on constraint phone_number_provider_details_pkey do update set
    provider = excluded.provider,
    provider_number_id = excluded.provider_number_id,
    provider_status = excluded.provider_status,
    setup_state = 'ready',
    a2p_state = 'approved',
    provider_error_code = null,
    provider_error_message = null;

  update public.phone_numbers as phone_number
  set status = 'ready', activated_at = p_completed_at
  where phone_number.id = v_connection.phone_number_id
    and phone_number.workspace_id = p_workspace_id;

  update private.configured_number_connections as connection
  set
    state = 'completed',
    completed_at = p_completed_at,
    provider_error_code = null,
    provider_error_message = null
  where connection.workspace_id = p_workspace_id;

  return query select true, v_connection.phone_number_id;
end;
$$;

create or replace function public.reconcile_configured_number_connection(
  p_workspace_id uuid,
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
  v_operation_id uuid;
begin
  select connection.operation_id
  into v_operation_id
  from private.configured_number_connections as connection
  where connection.workspace_id = p_workspace_id
    and connection.provider_number_id = pg_catalog.btrim(p_provider_number_id)
    and connection.state = 'reconciliation_required'
  for update;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  return query
  select result.completed, result.phone_number_id
  from public.complete_configured_number_connection(
    p_workspace_id,
    v_operation_id,
    p_provider,
    p_provider_number_id,
    p_provider_status,
    p_completed_at
  ) as result;
end;
$$;

revoke all on function public.complete_configured_number_connection(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.reconcile_configured_number_connection(
  uuid, text, text, text, timestamptz
) from public, anon, authenticated;

grant execute on function public.complete_configured_number_connection(
  uuid, uuid, text, text, text, timestamptz
) to service_role;
grant execute on function public.reconcile_configured_number_connection(
  uuid, text, text, text, timestamptz
) to service_role;

commit;
