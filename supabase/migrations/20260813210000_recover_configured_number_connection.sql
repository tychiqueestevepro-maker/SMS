begin;

-- A legacy configured number can already exist as Pending when the provider
-- connection was never completed. Adopt that exact workspace row instead of
-- creating a duplicate, and allow a stale attempt to be retried automatically.
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
  v_phone public.phone_numbers;
  v_phone_number_id uuid;
  v_phone_e164 text := pg_catalog.btrim(coalesce(p_phone_e164, ''));
  v_provider_number text := pg_catalog.btrim(coalesce(p_provider_number_id, ''));
begin
  if p_workspace_id is null
    or p_operation_id is null
    or v_phone_e164 !~ '^[+]33[1-79][0-9]{8}$'
    or v_provider_number !~ '^PN[0-9a-fA-F]{32}$'
  then
    raise exception using errcode = '22023', message = 'Invalid configured number connection.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select connection.*
  into v_connection
  from private.configured_number_connections as connection
  where connection.workspace_id = p_workspace_id
     or connection.provider_number_id = v_provider_number
  order by (connection.workspace_id = p_workspace_id) desc
  limit 1
  for update;

  if found then
    if v_connection.workspace_id <> p_workspace_id
      or v_connection.provider_number_id <> v_provider_number
    then
      raise exception using errcode = '23514', message = 'Configured number correlation failed.';
    end if;

    if v_connection.state = 'completed' then
      return query select
        'completed'::text,
        v_connection.operation_id,
        v_connection.phone_number_id;
      return;
    end if;

    if v_connection.state = 'reconciliation_required'
      or v_connection.created_at <= pg_catalog.now() - interval '15 minutes'
    then
      update private.configured_number_connections as connection
      set
        operation_id = p_operation_id,
        state = 'claimed',
        provider_error_code = null,
        provider_error_message = null,
        created_at = pg_catalog.now(),
        completed_at = null
      where connection.workspace_id = p_workspace_id
      returning * into v_connection;

      return query select
        'claimed'::text,
        v_connection.operation_id,
        v_connection.phone_number_id;
      return;
    end if;

    return query select
      'in_progress'::text,
      v_connection.operation_id,
      v_connection.phone_number_id;
    return;
  end if;

  select phone.*
  into v_phone
  from public.phone_numbers as phone
  where phone.phone_e164 = v_phone_e164
    and phone.deleted_at is null
  for update;

  if found then
    if v_phone.workspace_id <> p_workspace_id
      or v_phone.status <> 'pending'
      or v_phone.country_code is distinct from 'FR'
      or exists (
        select 1
        from private.phone_number_provider_details as detail
        where detail.phone_number_id = v_phone.id
      )
    then
      raise exception using errcode = '23514', message = 'Phone number is already connected.';
    end if;
    v_phone_number_id := v_phone.id;
  else
    insert into public.phone_numbers (
      workspace_id,
      phone_e164,
      status,
      country_code,
      number_source
    ) values (
      p_workspace_id,
      v_phone_e164,
      'pending',
      'FR',
      'included'
    ) returning id into v_phone_number_id;
  end if;

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

revoke all on function public.claim_configured_number_connection(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_configured_number_connection(uuid, uuid, text, text)
  to service_role;

commit;
