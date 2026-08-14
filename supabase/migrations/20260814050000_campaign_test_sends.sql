create table private.campaign_test_send_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  request_id uuid not null,
  phone_number_id uuid not null,
  recipient_phone_e164 text not null,
  body_hash text not null,
  claimed_by uuid not null references auth.users (id) on delete restrict,
  claimed_at timestamptz not null default now(),
  constraint campaign_test_send_requests_workspace_request_key
    unique (workspace_id, request_id),
  constraint campaign_test_send_requests_phone_valid
    check (recipient_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint campaign_test_send_requests_body_hash_valid
    check (body_hash ~ '^[0-9a-f]{64}$')
);

create index campaign_test_send_requests_rate_limit_idx
  on private.campaign_test_send_requests (workspace_id, claimed_at desc);

create or replace function public.claim_campaign_test_send(
  p_phone_number_id uuid,
  p_recipient_phone_e164 text,
  p_body text,
  p_request_id uuid,
  p_now timestamptz default now()
)
returns table (
  disposition text,
  source_phone_e164 text,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_body_hash text;
  v_existing private.campaign_test_send_requests;
  v_source_phone_e164 text;
  v_user_id uuid := (select auth.uid());
  v_workspace_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if p_request_id is null
    or p_phone_number_id is null
    or p_now is null
    or v_body = ''
    or pg_catalog.char_length(v_body) > 1600
    or p_body is distinct from v_body
    or p_recipient_phone_e164 !~ '^\+[1-9][0-9]{7,14}$'
  then
    raise exception using errcode = '22023', message = 'Invalid campaign test message request.';
  end if;

  select workspace.id
  into v_workspace_id
  from public.workspaces as workspace
  where workspace.owner_id = v_user_id
  for update;

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  v_body_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_body, 'UTF8'), 'sha256'),
    'hex'
  );

  select request.*
  into v_existing
  from private.campaign_test_send_requests as request
  where request.workspace_id = v_workspace_id
    and request.request_id = p_request_id;

  if found then
    if v_existing.phone_number_id is distinct from p_phone_number_id
      or v_existing.recipient_phone_e164 is distinct from p_recipient_phone_e164
      or v_existing.body_hash is distinct from v_body_hash
    then
      raise exception using errcode = '23514', message = 'Campaign test message correlation failed.';
    end if;

    select phone.phone_e164
    into v_source_phone_e164
    from public.phone_numbers as phone
    where phone.id = p_phone_number_id
      and phone.workspace_id = v_workspace_id;

    return query select 'already_claimed'::text, v_source_phone_e164, v_workspace_id;
    return;
  end if;

  if (
    select count(*)
    from private.campaign_test_send_requests as request
    where request.workspace_id = v_workspace_id
      and request.claimed_at >= p_now - interval '1 hour'
  ) >= 3 then
    raise exception using errcode = '54000', message = 'Campaign test message rate limit reached.';
  end if;

  if not exists (
    select 1
    from private.workspace_messaging_controls as control
    where control.workspace_id = v_workspace_id
      and control.messaging_enabled
  ) then
    raise exception using errcode = '55000', message = 'Messaging is unavailable for this workspace.';
  end if;

  select phone.phone_e164
  into v_source_phone_e164
  from public.phone_numbers as phone
  where phone.id = p_phone_number_id
    and phone.workspace_id = v_workspace_id
    and phone.status = 'ready'
    and phone.deleted_at is null;

  if v_source_phone_e164 is null then
    raise exception using errcode = '55000', message = 'This phone number is not ready for messaging yet.';
  end if;

  if exists (
    select 1
    from public.suppressions as suppression
    where suppression.workspace_id = v_workspace_id
      and suppression.phone_e164 = p_recipient_phone_e164
  ) then
    raise exception using errcode = '55000', message = 'This number cannot receive messages.';
  end if;

  insert into private.campaign_test_send_requests (
    workspace_id,
    request_id,
    phone_number_id,
    recipient_phone_e164,
    body_hash,
    claimed_by,
    claimed_at
  )
  values (
    v_workspace_id,
    p_request_id,
    p_phone_number_id,
    p_recipient_phone_e164,
    v_body_hash,
    v_user_id,
    p_now
  );

  return query select 'claimed'::text, v_source_phone_e164, v_workspace_id;
end;
$$;

revoke all on table private.campaign_test_send_requests from public, anon, authenticated;
revoke all on function public.claim_campaign_test_send(uuid, text, text, uuid, timestamptz)
  from public, anon;
grant execute on function public.claim_campaign_test_send(uuid, text, text, uuid, timestamptz)
  to authenticated;

comment on table private.campaign_test_send_requests is
  'Durable idempotency and hourly abuse protection for campaign test messages.';
comment on function public.claim_campaign_test_send(uuid, text, text, uuid, timestamptz) is
  'Claims one rate limited campaign test message after workspace, number, messaging, and suppression checks.';
