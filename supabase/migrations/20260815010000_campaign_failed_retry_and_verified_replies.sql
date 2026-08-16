-- Safely requeue campaign sends that failed before provider acceptance, and
-- accept verified French inbound replies through the existing webhook path.

create table private.campaign_message_retry_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  campaign_recipient_id uuid not null references public.campaign_recipients (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete restrict,
  retry_number integer not null,
  previous_failed_at timestamptz not null,
  previous_failure_code text not null,
  previous_provider text,
  previous_provider_message_id text,
  previous_provider_status text,
  previous_provider_error_code text,
  previous_provider_error_message text,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  constraint campaign_message_retry_history_number_positive
    check (retry_number > 0),
  constraint campaign_message_retry_history_message_number_key
    unique (message_id, retry_number)
);

create index campaign_message_retry_history_campaign_requested_idx
  on private.campaign_message_retry_history (campaign_id, requested_at desc);

revoke all on table private.campaign_message_retry_history from public;
revoke all on table private.campaign_message_retry_history from anon;
revoke all on table private.campaign_message_retry_history from authenticated;

create or replace function public.campaign_failed_message_retry_summary(
  p_campaign_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_protected integer;
  v_retryable integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  if not exists (
    select 1
    from public.campaigns as campaign
    join public.workspaces as workspace on workspace.id = campaign.workspace_id
    where campaign.id = p_campaign_id
      and campaign.deleted_at is null
      and workspace.owner_id = (select auth.uid())
  ) then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  select
    count(*) filter (
      where message.dispatch_state = 'failed'
        and message.accepted_at is null
        and message.failed_at is not null
        and message.billing_period_id is null
        and message.usage_position is null
        and message.failure_code = 'message_send_failed'
        and nullif(pg_catalog.btrim(detail.provider_message_id), '') is null
        and recipient.state = 'stopped'
        and recipient.stop_reason = 'failed'
        and recipient.replied_at is null
        and contact.deleted_at is null
        and suppression.phone_e164 is null
    )::integer,
    count(*) filter (
      where (
        message.failure_code = 'message_send_failed'
        or message.failure_code = 'message_delivery_failed'
        or message.dispatch_state = 'dispatch_unknown'
      )
      and not (
        message.dispatch_state = 'failed'
        and message.accepted_at is null
        and message.failed_at is not null
        and message.billing_period_id is null
        and message.usage_position is null
        and message.failure_code = 'message_send_failed'
        and nullif(pg_catalog.btrim(detail.provider_message_id), '') is null
        and recipient.state = 'stopped'
        and recipient.stop_reason = 'failed'
        and recipient.replied_at is null
        and contact.deleted_at is null
        and suppression.phone_e164 is null
      )
    )::integer
  into v_retryable, v_protected
  from public.messages as message
  join public.campaign_recipients as recipient
    on recipient.id = message.campaign_recipient_id
  join public.contacts as contact on contact.id = message.contact_id
  left join private.message_provider_details as detail
    on detail.message_id = message.id
  left join public.suppressions as suppression
    on suppression.workspace_id = message.workspace_id
    and suppression.phone_e164 = contact.phone_e164
  where message.campaign_id = p_campaign_id
    and message.direction = 'outbound';

  return pg_catalog.jsonb_build_object(
    'retryableCount', coalesce(v_retryable, 0),
    'protectedCount', coalesce(v_protected, 0)
  );
end;
$$;

create or replace function public.retry_failed_campaign_messages(
  p_campaign_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.campaigns;
  v_detail private.message_provider_details;
  v_message public.messages;
  v_queued integer := 0;
  v_retry_number integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if p_now is null then
    raise exception using errcode = '22023', message = 'Retry time is required.';
  end if;

  select campaign.*
  into v_campaign
  from public.campaigns as campaign
  join public.workspaces as workspace on workspace.id = campaign.workspace_id
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null
    and campaign.status in ('active', 'paused', 'finished')
    and workspace.owner_id = (select auth.uid())
  for update of campaign;

  if not found then
    raise exception using errcode = 'P0002', message = 'Campaign not found.';
  end if;

  if not exists (
    select 1
    from private.workspace_messaging_controls as control
    where control.workspace_id = v_campaign.workspace_id
      and control.messaging_enabled
  ) then
    raise exception using errcode = '55000', message = 'Messaging is not available for this workspace.';
  end if;

  for v_message in
    select message.*
    from public.messages as message
    join public.campaign_recipients as recipient
      on recipient.id = message.campaign_recipient_id
    join public.contacts as contact on contact.id = message.contact_id
    left join private.message_provider_details as detail
      on detail.message_id = message.id
    where message.campaign_id = p_campaign_id
      and message.direction = 'outbound'
      and message.dispatch_state = 'failed'
      and message.accepted_at is null
      and message.failed_at is not null
      and message.billing_period_id is null
      and message.usage_position is null
      and message.failure_code = 'message_send_failed'
      and nullif(pg_catalog.btrim(detail.provider_message_id), '') is null
      and recipient.state = 'stopped'
      and recipient.stop_reason = 'failed'
      and recipient.replied_at is null
      and contact.deleted_at is null
      and not exists (
        select 1
        from public.suppressions as suppression
        where suppression.workspace_id = message.workspace_id
          and suppression.phone_e164 = contact.phone_e164
      )
    order by message.failed_at, message.id
    for update of message
  loop
    perform 1
    from public.campaign_recipients as recipient
    where recipient.id = v_message.campaign_recipient_id
      and recipient.state = 'stopped'
      and recipient.stop_reason = 'failed'
      and recipient.replied_at is null
    for update;
    if not found then
      continue;
    end if;

    select detail.*
    into v_detail
    from private.message_provider_details as detail
    where detail.message_id = v_message.id;

    select coalesce(max(history.retry_number), 0) + 1
    into v_retry_number
    from private.campaign_message_retry_history as history
    where history.message_id = v_message.id;

    insert into private.campaign_message_retry_history (
      workspace_id,
      campaign_id,
      campaign_recipient_id,
      message_id,
      retry_number,
      previous_failed_at,
      previous_failure_code,
      previous_provider,
      previous_provider_message_id,
      previous_provider_status,
      previous_provider_error_code,
      previous_provider_error_message,
      requested_by,
      requested_at
    )
    values (
      v_message.workspace_id,
      v_message.campaign_id,
      v_message.campaign_recipient_id,
      v_message.id,
      v_retry_number,
      v_message.failed_at,
      v_message.failure_code,
      v_detail.provider,
      v_detail.provider_message_id,
      v_detail.provider_status,
      v_detail.provider_error_code,
      v_detail.provider_error_message,
      (select auth.uid()),
      p_now
    );

    update public.messages
    set
      dispatch_state = 'pending',
      delivery_state = null,
      reserved_segments = 0,
      reserved_billing_period_id = null,
      reservation_token = null,
      scheduled_for = p_now,
      reserved_at = null,
      dispatch_started_at = null,
      accepted_at = null,
      sent_at = null,
      failed_at = null,
      reservation_released_at = null,
      failure_code = null
    where id = v_message.id;

    update public.campaign_recipients
    set
      state = 'active',
      next_send_at = p_now,
      stopped_at = null,
      stop_reason = null,
      finished_at = null
    where id = v_message.campaign_recipient_id;

    v_queued := v_queued + 1;
  end loop;

  if v_queued > 0 and v_campaign.status = 'finished' then
    update public.campaigns
    set
      status = 'active',
      finished_at = null,
      paused_at = null
    where id = p_campaign_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'queuedCount', v_queued,
    'protectedCount', (
      public.campaign_failed_message_retry_summary(p_campaign_id)
        ->> 'protectedCount'
    )::integer
  );
end;
$$;

revoke all on function public.campaign_failed_message_retry_summary(uuid) from public;
revoke all on function public.retry_failed_campaign_messages(uuid, timestamptz) from public;
grant execute on function public.campaign_failed_message_retry_summary(uuid) to authenticated;
grant execute on function public.retry_failed_campaign_messages(uuid, timestamptz) to authenticated;

comment on function public.retry_failed_campaign_messages(uuid, timestamptz) is
  'Requeues only definite pre-accept campaign failures. Delivery failures and dispatch_unknown remain fenced.';

-- Contacts created by a verified inbound webhook must satisfy the country
-- routing column added after the original inbox function was authored.
create or replace function private.fill_contact_country_code_from_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(pg_catalog.btrim(new.country_code), '') is null then
    new.country_code := case
      when new.phone_e164 ~ '^[+]33[1-79][0-9]{8}$' then 'FR'
      when new.phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$' then 'US'
      else null
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_fill_country_code_from_phone on public.contacts;
create trigger contacts_fill_country_code_from_phone
before insert on public.contacts
for each row execute function private.fill_contact_country_code_from_phone();

revoke all on function private.fill_contact_country_code_from_phone() from public;
revoke all on function private.fill_contact_country_code_from_phone() from anon;
revoke all on function private.fill_contact_country_code_from_phone() from authenticated;

do $$
declare
  v_definition text;
  v_old_check constant text :=
    'v_from_phone !~ ''^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$''';
  v_new_check constant text :=
    'v_from_phone !~ ''^([+]1[2-9][0-9]{2}[2-9][0-9]{6}|[+]33[1-79][0-9]{8})$''';
begin
  select pg_catalog.pg_get_functiondef(
    'private.apply_verified_inbound_sms_webhook(jsonb,jsonb)'::regprocedure
  ) into v_definition;

  if pg_catalog.position(v_old_check in v_definition) = 0 then
    raise exception 'Verified inbound SMS validation definition changed.';
  end if;

  execute pg_catalog.replace(v_definition, v_old_check, v_new_check);
end;
$$;
