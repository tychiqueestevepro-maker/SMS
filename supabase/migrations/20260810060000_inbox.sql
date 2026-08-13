begin;

alter table public.messages
  drop constraint messages_body_not_blank,
  add column received_at timestamptz,
  add column in_reply_to_message_id uuid,
  add constraint messages_workspace_id_id_key unique (workspace_id, id),
  add constraint messages_in_reply_to_fkey
    foreign key (workspace_id, in_reply_to_message_id)
    references public.messages (workspace_id, id)
    on delete restrict,
  add constraint messages_direction_timestamps_valid check (
    (direction = 'inbound' and received_at is not null)
    or (direction = 'outbound' and received_at is null)
  ),
  add constraint messages_reply_direction_valid check (
    in_reply_to_message_id is null or direction = 'inbound'
  ),
  add constraint messages_body_valid check (
    direction = 'inbound' or char_length(body) > 0
  );

create unique index phone_numbers_active_phone_e164_key
  on public.phone_numbers (phone_e164)
  where deleted_at is null;

create unique index message_provider_details_message_id_global_key
  on private.message_provider_details (provider_message_id)
  where provider_message_id is not null;

create unique index messages_period_usage_position_key
  on public.messages (billing_period_id, usage_position)
  where billing_period_id is not null and usage_position is not null;

create index messages_inbox_conversation_idx
  on public.messages (
    workspace_id,
    contact_id,
    phone_number_id,
    coalesce(received_at, sent_at, created_at)
  );

create index messages_reply_to_idx
  on public.messages (in_reply_to_message_id)
  where in_reply_to_message_id is not null;

create table private.webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  event_kind text not null,
  event_id text not null,
  provider_message_id text not null,
  occurred_at timestamptz not null,
  contact_id uuid references public.contacts (id) on delete restrict,
  inbound_message_id uuid references public.messages (id) on delete restrict,
  associated_campaign_recipient_id uuid
    references public.campaign_recipients (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint webhook_events_workspace_kind_event_key
    unique (workspace_id, event_kind, event_id),
  constraint webhook_events_kind_valid check (
    event_kind in ('inbound', 'status')
  ),
  constraint webhook_events_values_not_blank check (
    char_length(btrim(event_id)) > 0
    and char_length(btrim(provider_message_id)) > 0
  )
);

create index webhook_events_provider_message_idx
  on private.webhook_events (provider_message_id, occurred_at desc);

create table private.billing_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  billing_period_id uuid references public.billing_periods (id) on delete restrict,
  message_id uuid not null unique references public.messages (id) on delete restrict,
  direction text not null,
  num_segments integer,
  provider_cost_micro_usd bigint,
  included_segments integer not null default 0,
  overage_segments integer not null default 0,
  customer_billable_amount_micro_usd bigint not null default 0,
  usage_position bigint,
  included_segments_snapshot integer,
  overage_price_micro_usd_snapshot bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_usage_ledger_direction_valid check (
    direction in ('inbound', 'outbound')
  ),
  constraint billing_usage_ledger_values_valid check (
    (num_segments is null or num_segments > 0)
    and (provider_cost_micro_usd is null or provider_cost_micro_usd >= 0)
    and included_segments >= 0
    and overage_segments >= 0
    and customer_billable_amount_micro_usd >= 0
  ),
  constraint billing_usage_ledger_inbound_zero_customer_usage check (
    direction <> 'inbound'
    or (
      included_segments = 0
      and overage_segments = 0
      and customer_billable_amount_micro_usd = 0
      and usage_position is null
    )
  ),
  constraint billing_usage_ledger_outbound_allocation_valid check (
    direction <> 'outbound'
    or num_segments is null
    or included_segments + overage_segments = num_segments
  )
);

create index billing_usage_ledger_period_position_idx
  on private.billing_usage_ledger (billing_period_id, usage_position)
  where direction = 'outbound';

create trigger billing_usage_ledger_touch_updated_at
before update on private.billing_usage_ledger
for each row execute function private.touch_updated_at();

create or replace function private.validate_inbound_reply_association()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.in_reply_to_message_id is null then
    return new;
  end if;

  if new.direction <> 'inbound' or not exists (
    select 1
    from public.messages as outbound
    where outbound.id = new.in_reply_to_message_id
      and outbound.workspace_id = new.workspace_id
      and outbound.contact_id = new.contact_id
      and outbound.phone_number_id = new.phone_number_id
      and outbound.direction = 'outbound'
      and outbound.campaign_id is not null
      and outbound.campaign_recipient_id is not null
      and outbound.dispatch_state = 'accepted'
      and outbound.delivery_state is distinct from 'failed'
      and outbound.accepted_at is not null
      and outbound.accepted_at <= new.received_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'Inbound reply association is invalid.';
  end if;

  return new;
end;
$$;

create trigger messages_validate_inbound_reply_association
before insert or update of in_reply_to_message_id on public.messages
for each row execute function private.validate_inbound_reply_association();

create or replace function private.recalculate_billing_period_allocations(
  p_billing_period_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.billing_periods as period
  where period.id = p_billing_period_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Billing period not found.';
  end if;

  with ordered as (
    select
      message.id as message_id,
      message.workspace_id,
      message.billing_period_id,
      message.num_segments,
      message.usage_position,
      message.included_segments_snapshot,
      message.overage_price_micro_usd_snapshot,
      coalesce(
        sum(message.num_segments) over (
          partition by message.billing_period_id
          order by message.usage_position, message.id
          rows between unbounded preceding and 1 preceding
        ),
        0
      )::integer as prior_segments,
      detail.provider_cost_micro_usd
    from public.messages as message
    left join private.message_provider_details as detail
      on detail.message_id = message.id
    where message.billing_period_id = p_billing_period_id
      and message.direction = 'outbound'
      and message.dispatch_state = 'accepted'
      and message.num_segments is not null
      and message.usage_position is not null
  ),
  allocated as (
    select
      ordered.*,
      least(
        ordered.num_segments,
        greatest(
          0,
          ordered.included_segments_snapshot - ordered.prior_segments
        )
      )::integer as allocated_included
    from ordered
  )
  insert into private.billing_usage_ledger (
    workspace_id,
    billing_period_id,
    message_id,
    direction,
    num_segments,
    provider_cost_micro_usd,
    included_segments,
    overage_segments,
    customer_billable_amount_micro_usd,
    usage_position,
    included_segments_snapshot,
    overage_price_micro_usd_snapshot
  )
  select
    allocated.workspace_id,
    allocated.billing_period_id,
    allocated.message_id,
    'outbound',
    allocated.num_segments,
    allocated.provider_cost_micro_usd,
    allocated.allocated_included,
    allocated.num_segments - allocated.allocated_included,
    (
      allocated.num_segments - allocated.allocated_included
    )::bigint * allocated.overage_price_micro_usd_snapshot,
    allocated.usage_position,
    allocated.included_segments_snapshot,
    allocated.overage_price_micro_usd_snapshot
  from allocated
  on conflict (message_id) do update
  set
    workspace_id = excluded.workspace_id,
    billing_period_id = excluded.billing_period_id,
    direction = excluded.direction,
    num_segments = excluded.num_segments,
    provider_cost_micro_usd = excluded.provider_cost_micro_usd,
    included_segments = excluded.included_segments,
    overage_segments = excluded.overage_segments,
    customer_billable_amount_micro_usd =
      excluded.customer_billable_amount_micro_usd,
    usage_position = excluded.usage_position,
    included_segments_snapshot = excluded.included_segments_snapshot,
    overage_price_micro_usd_snapshot =
      excluded.overage_price_micro_usd_snapshot;
end;
$$;

create or replace function private.trace_accepted_outbound_in_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.direction <> 'outbound'
    or new.dispatch_state <> 'accepted'
    or new.billing_period_id is null
    or new.usage_position is null
  then
    return new;
  end if;

  if new.num_segments is null then
    insert into private.billing_usage_ledger (
      workspace_id,
      billing_period_id,
      message_id,
      direction,
      num_segments,
      provider_cost_micro_usd,
      included_segments,
      overage_segments,
      customer_billable_amount_micro_usd,
      usage_position,
      included_segments_snapshot,
      overage_price_micro_usd_snapshot
    )
    values (
      new.workspace_id,
      new.billing_period_id,
      new.id,
      'outbound',
      null,
      null,
      0,
      0,
      0,
      new.usage_position,
      new.included_segments_snapshot,
      new.overage_price_micro_usd_snapshot
    )
    on conflict (message_id) do update
    set
      billing_period_id = excluded.billing_period_id,
      usage_position = excluded.usage_position,
      included_segments_snapshot = excluded.included_segments_snapshot,
      overage_price_micro_usd_snapshot =
        excluded.overage_price_micro_usd_snapshot;
  else
    perform private.recalculate_billing_period_allocations(
      new.billing_period_id
    );
  end if;

  return new;
end;
$$;

create trigger messages_trace_accepted_outbound_in_ledger
after insert or update of
  dispatch_state,
  billing_period_id,
  usage_position,
  num_segments
on public.messages
for each row execute function private.trace_accepted_outbound_in_ledger();

create or replace function private.prevent_message_billing_attribution_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.billing_period_id is not null and (
    new.billing_period_id is distinct from old.billing_period_id
    or new.usage_position is distinct from old.usage_position
    or new.included_segments_snapshot is distinct from
      old.included_segments_snapshot
    or new.overage_price_micro_usd_snapshot is distinct from
      old.overage_price_micro_usd_snapshot
  ) then
    raise exception using
      errcode = '23514',
      message = 'Message billing attribution is immutable after acceptance.';
  end if;

  return new;
end;
$$;

create trigger messages_prevent_billing_attribution_change
before update of
  billing_period_id,
  usage_position,
  included_segments_snapshot,
  overage_price_micro_usd_snapshot
on public.messages
for each row execute function private.prevent_message_billing_attribution_change();

create or replace function private.resolve_sms_webhook_context(
  p_kind text,
  p_value text
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_context jsonb;
  v_value text := pg_catalog.btrim(coalesce(p_value, ''));
begin
  if p_kind not in ('inbound_number', 'outbound_message') or v_value = '' then
    raise exception using
      errcode = '22023',
      message = 'Invalid SMS webhook routing key.';
  end if;

  if p_kind = 'inbound_number' then
    select jsonb_build_object(
      'workspaceId', phone_number.workspace_id,
      'phoneNumberId', phone_number.id,
      'messageId', null,
      'campaignId', null,
      'campaignRecipientId', null,
      'contactId', null
    )
    into v_context
    from public.phone_numbers as phone_number
    where phone_number.phone_e164 = v_value
      and phone_number.deleted_at is null;
  else
    select jsonb_build_object(
      'workspaceId', message.workspace_id,
      'phoneNumberId', message.phone_number_id,
      'messageId', message.id,
      'campaignId', message.campaign_id,
      'campaignRecipientId', message.campaign_recipient_id,
      'contactId', message.contact_id
    )
    into v_context
    from private.message_provider_details as detail
    join public.messages as message on message.id = detail.message_id
    where detail.provider_message_id = v_value
      and message.direction = 'outbound';
  end if;

  return v_context;
end;
$$;

create or replace function public.resolve_sms_webhook_context(
  p_kind text,
  p_value text
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select private.resolve_sms_webhook_context(p_kind, p_value);
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
    and campaign.status in ('active', 'paused')
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

create or replace function private.stop_campaign_recipient_for_inbound(
  p_campaign_recipient_id uuid,
  p_stop_reason text,
  p_stopped_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign_id uuid;
  v_message_id uuid;
  v_recipient public.campaign_recipients;
begin
  if p_stop_reason not in ('reply', 'opt_out') then
    raise exception using
      errcode = '22023',
      message = 'Invalid inbound recipient stop reason.';
  end if;

  select recipient.campaign_id
  into v_campaign_id
  from public.campaign_recipients as recipient
  where recipient.id = p_campaign_recipient_id;

  if v_campaign_id is null then
    return false;
  end if;

  perform 1
  from public.campaigns as campaign
  where campaign.id = v_campaign_id
  for update;

  select recipient.*
  into v_recipient
  from public.campaign_recipients as recipient
  where recipient.id = p_campaign_recipient_id
  for update;

  if v_recipient.state <> 'active' then
    return false;
  end if;

  for v_message_id in
    select message.id
    from public.messages as message
    where message.campaign_recipient_id = p_campaign_recipient_id
      and message.dispatch_state = 'reserved'
      and message.dispatch_started_at is null
    order by message.id
    for update
  loop
    perform private.release_reserved_message(
      v_message_id,
      'failed',
      case
        when p_stop_reason = 'opt_out' then 'contact_opted_out'
        else 'recipient_replied'
      end
    );
  end loop;

  update public.messages
  set
    dispatch_state = 'failed',
    delivery_state = 'failed',
    failed_at = p_stopped_at,
    failure_code = case
      when p_stop_reason = 'opt_out' then 'contact_opted_out'
      else 'recipient_replied'
    end
  where campaign_recipient_id = p_campaign_recipient_id
    and dispatch_state = 'pending';

  update public.campaign_recipients
  set
    state = 'stopped',
    next_send_at = null,
    stopped_at = p_stopped_at,
    stop_reason = p_stop_reason,
    finished_at = null
  where id = p_campaign_recipient_id;

  perform private.complete_campaigns_without_active_recipients(v_campaign_id);
  return true;
end;
$$;

create or replace function private.apply_verified_inbound_sms_webhook(
  p_mutation jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
  v_associated_campaign_recipient_id uuid;
  v_body text;
  v_campaign_recipient_id uuid;
  v_command text;
  v_confirmed_consent text;
  v_contact public.contacts;
  v_contact_id uuid;
  v_deleted_contact boolean;
  v_expected_action text;
  v_expected_command text;
  v_expected_keyword text;
  v_expected_stop_for_reply boolean;
  v_from_phone text;
  v_inbound_message_id uuid;
  v_keyword text;
  v_num_segments integer;
  v_occurred_at timestamptz;
  v_outbound_message_id uuid;
  v_period_id uuid;
  v_phone_number_id uuid := (p_context ->> 'phoneNumberId')::uuid;
  v_provider text;
  v_provider_cost_micro_usd bigint;
  v_provider_message_id text;
  v_received_key text;
  v_stop_for_reply boolean;
  v_workspace_id uuid := (p_context ->> 'workspaceId')::uuid;
begin
  if pg_catalog.jsonb_typeof(p_mutation -> 'event') <> 'object'
    or pg_catalog.jsonb_typeof(p_mutation -> 'consent') <> 'object'
    or pg_catalog.jsonb_typeof(p_mutation -> 'usage') <> 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid inbound SMS event.';
  end if;

  v_from_phone := pg_catalog.btrim(
    coalesce(p_mutation #>> '{event,fromPhoneNumber}', '')
  );
  v_body := coalesce(p_mutation #>> '{event,body}', '');
  v_provider_message_id := pg_catalog.btrim(
    coalesce(p_mutation #>> '{event,providerMessageId}', '')
  );
  v_confirmed_consent := p_mutation #>> '{event,confirmedConsent}';

  begin
    v_occurred_at := (p_mutation #>> '{event,occurredAt}')::timestamptz;
    v_num_segments := (p_mutation #>> '{usage,numSegments}')::integer;
    v_provider_cost_micro_usd :=
      (p_mutation #>> '{usage,providerCostMicroUsd}')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Invalid inbound SMS event.';
  end;

  if v_from_phone !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
    or v_provider_message_id = ''
    or p_mutation #>> '{event,toPhoneNumber}' is distinct from (
      select phone_number.phone_e164
      from public.phone_numbers as phone_number
      where phone_number.id = v_phone_number_id
    )
    or not (p_mutation -> 'event' ? 'confirmedConsent')
    or (
      v_confirmed_consent is not null
      and v_confirmed_consent not in ('opt_out', 'opt_in', 'help')
    )
    or (v_num_segments is not null and v_num_segments < 1)
    or (
      v_provider_cost_micro_usd is not null
      and v_provider_cost_micro_usd < 0
    )
    or p_mutation #>> '{usage,direction}' is distinct from 'inbound'
    or coalesce((p_mutation #>> '{usage,includedSegments}')::integer, -1) <> 0
    or coalesce((p_mutation #>> '{usage,overageSegments}')::integer, -1) <> 0
    or coalesce(
      (p_mutation #>> '{usage,customerBillableAmountMicroUsd}')::bigint,
      -1
    ) <> 0
  then
    raise exception using errcode = '22023', message = 'Invalid inbound SMS event.';
  end if;

  v_received_key := pg_catalog.upper(pg_catalog.btrim(v_body));
  if v_received_key in ('STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT')
    or v_confirmed_consent = 'opt_out'
  then
    v_expected_command := 'opt_out';
    v_expected_keyword := case
      when v_received_key in ('STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT')
        then v_received_key
      else null
    end;
    v_expected_action := 'upsert_and_stop';
    v_expected_stop_for_reply := false;
  elsif v_received_key in ('START', 'UNSTOP') then
    v_expected_command := 'opt_in';
    v_expected_keyword := v_received_key;
    v_expected_action := case
      when v_confirmed_consent = 'opt_in' then 'remove_without_resume'
      else 'none'
    end;
    v_expected_stop_for_reply := true;
  else
    v_expected_command := null;
    v_expected_keyword := null;
    v_expected_action := 'none';
    v_expected_stop_for_reply := true;
  end if;

  v_command := p_mutation #>> '{consent,command}';
  v_keyword := p_mutation #>> '{consent,keyword}';
  v_action := p_mutation #>> '{consent,suppressionAction}';
  v_stop_for_reply :=
    (p_mutation #>> '{consent,stopForReplyWhenAssociated}')::boolean;

  if v_command is distinct from v_expected_command
    or v_keyword is distinct from v_expected_keyword
    or v_action is distinct from v_expected_action
    or v_stop_for_reply is distinct from v_expected_stop_for_reply
    or coalesce((p_mutation #>> '{consent,resumeCampaigns}')::boolean, true)
  then
    raise exception using
      errcode = '22023',
      message = 'Inbound consent normalization does not match the signed event.';
  end if;

  select coalesce(detail.provider, 'sms_provider')
  into v_provider
  from public.phone_numbers as phone_number
  left join private.phone_number_provider_details as detail
    on detail.phone_number_id = phone_number.id
  where phone_number.id = v_phone_number_id
    and phone_number.workspace_id = v_workspace_id;

  select message.id, message.contact_id
  into v_inbound_message_id, v_contact_id
  from private.message_provider_details as detail
  join public.messages as message on message.id = detail.message_id
  where detail.provider_message_id = v_provider_message_id
    and message.workspace_id = v_workspace_id
    and message.direction = 'inbound';

  if v_inbound_message_id is not null then
    return jsonb_build_object(
      'duplicate', true,
      'contactId', v_contact_id,
      'inboundMessageId', v_inbound_message_id,
      'deletedContact', (
        select contact.deleted_at is not null
        from public.contacts as contact
        where contact.id = v_contact_id
      ),
      'associatedCampaignRecipientId', (
        select outbound.campaign_recipient_id
        from public.messages as inbound
        join public.messages as outbound
          on outbound.id = inbound.in_reply_to_message_id
        where inbound.id = v_inbound_message_id
      )
    );
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.workspace_id = v_workspace_id
    and contact.phone_e164 = v_from_phone
  for update;

  if not found then
    insert into public.contacts (
      workspace_id,
      pipeline_stage_id,
      first_name,
      last_name,
      company,
      phone_e164
    )
    values (
      v_workspace_id,
      private.default_pipeline_stage_id(v_workspace_id),
      '',
      '',
      '',
      v_from_phone
    )
    returning * into v_contact;
  end if;

  v_contact_id := v_contact.id;
  v_deleted_contact := v_contact.deleted_at is not null;

  select
    outbound.id,
    outbound.campaign_recipient_id
  into
    v_outbound_message_id,
    v_associated_campaign_recipient_id
  from public.messages as outbound
  where outbound.workspace_id = v_workspace_id
    and outbound.contact_id = v_contact_id
    and outbound.phone_number_id = v_phone_number_id
    and outbound.direction = 'outbound'
    and outbound.campaign_id is not null
    and outbound.campaign_recipient_id is not null
    and outbound.dispatch_state = 'accepted'
    and outbound.delivery_state is distinct from 'failed'
    and outbound.accepted_at is not null
    and outbound.accepted_at <= v_occurred_at
  order by outbound.accepted_at desc, outbound.id desc
  limit 1;

  insert into public.messages (
    workspace_id,
    contact_id,
    phone_number_id,
    direction,
    body,
    dispatch_state,
    delivery_state,
    num_segments,
    received_at,
    in_reply_to_message_id,
    created_at
  )
  values (
    v_workspace_id,
    v_contact_id,
    v_phone_number_id,
    'inbound',
    v_body,
    'accepted',
    'delivered',
    v_num_segments,
    v_occurred_at,
    v_outbound_message_id,
    v_occurred_at
  )
  returning id into v_inbound_message_id;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status,
    provider_cost_micro_usd,
    provider_currency,
    provider_cost_pending,
    reconciliation_state,
    reconciliation_reason,
    reconciled_at
  )
  values (
    v_inbound_message_id,
    v_provider,
    v_provider_message_id,
    'received',
    v_provider_cost_micro_usd,
    'USD',
    v_provider_cost_micro_usd is null,
    case
      when v_num_segments is not null
        and v_provider_cost_micro_usd is not null then 'complete'
      else 'deferred'
    end,
    case
      when v_num_segments is null or v_provider_cost_micro_usd is null
        then 'inbound_usage_pending'
      else null
    end,
    v_occurred_at
  );

  v_period_id := private.billing_period_for_occurrence(
    v_workspace_id,
    v_occurred_at
  );

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
  values (
    v_workspace_id,
    v_period_id,
    v_inbound_message_id,
    'inbound',
    v_num_segments,
    v_provider_cost_micro_usd,
    0,
    0,
    0
  );

  update public.contacts
  set last_replied_at = case
    when last_replied_at is null then v_occurred_at
    else greatest(last_replied_at, v_occurred_at)
  end
  where id = v_contact_id;

  if v_associated_campaign_recipient_id is not null then
    update public.campaign_recipients
    set replied_at = case
      when replied_at is null then v_occurred_at
      else least(replied_at, v_occurred_at)
    end
    where id = v_associated_campaign_recipient_id;
  end if;

  if v_expected_action = 'upsert_and_stop' then
    insert into public.suppressions (
      workspace_id,
      phone_e164,
      source
    )
    values (
      v_workspace_id,
      v_from_phone,
      'opt_out'
    )
    on conflict (workspace_id, phone_e164) do update
    set
      source = 'opt_out',
      updated_at = v_occurred_at;

    for v_campaign_recipient_id in
      select recipient.id
      from public.campaign_recipients as recipient
      where recipient.workspace_id = v_workspace_id
        and recipient.contact_id = v_contact_id
        and recipient.state = 'active'
      order by recipient.campaign_id, recipient.id
    loop
      perform private.stop_campaign_recipient_for_inbound(
        v_campaign_recipient_id,
        'opt_out',
        v_occurred_at
      );
    end loop;
  else
    if v_expected_action = 'remove_without_resume' then
      delete from public.suppressions
      where workspace_id = v_workspace_id
        and phone_e164 = v_from_phone;
    end if;

    if v_associated_campaign_recipient_id is not null
      and v_expected_stop_for_reply
    then
      perform private.stop_campaign_recipient_for_inbound(
        v_associated_campaign_recipient_id,
        'reply',
        v_occurred_at
      );
    end if;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'contactId', v_contact_id,
    'inboundMessageId', v_inbound_message_id,
    'deletedContact', v_deleted_contact,
    'associatedCampaignRecipientId', v_associated_campaign_recipient_id
  );
end;
$$;

create or replace function private.apply_verified_status_sms_webhook(
  p_mutation jsonb,
  p_context jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_segments integer;
  v_campaign_recipient_id uuid :=
    nullif(p_context ->> 'campaignRecipientId', '')::uuid;
  v_contact_id uuid := nullif(p_context ->> 'contactId', '')::uuid;
  v_current_cost bigint;
  v_deleted_contact boolean := false;
  v_delivery_state text;
  v_expected_delivery_state text;
  v_message public.messages;
  v_message_id uuid := nullif(p_context ->> 'messageId', '')::uuid;
  v_occurred_at timestamptz;
  v_provider text;
  v_provider_cost_micro_usd bigint;
  v_provider_error_code text;
  v_provider_message_id text;
  v_provider_status text;
  v_workspace_id uuid := (p_context ->> 'workspaceId')::uuid;
begin
  if pg_catalog.jsonb_typeof(p_mutation -> 'event') <> 'object'
    or pg_catalog.jsonb_typeof(p_mutation -> 'usage') <> 'object'
    or v_message_id is null
  then
    raise exception using errcode = '22023', message = 'Invalid SMS status event.';
  end if;

  v_provider_message_id := pg_catalog.btrim(
    coalesce(p_mutation #>> '{event,providerMessageId}', '')
  );
  v_provider_status := p_mutation #>> '{event,status}';
  v_provider_error_code := p_mutation #>> '{event,providerErrorCode}';
  v_delivery_state := p_mutation ->> 'deliveryState';

  begin
    v_occurred_at := (p_mutation #>> '{event,occurredAt}')::timestamptz;
    v_actual_segments := (p_mutation #>> '{usage,actualSegments}')::integer;
    v_provider_cost_micro_usd :=
      (p_mutation #>> '{usage,providerCostMicroUsd}')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Invalid SMS status event.';
  end;

  v_expected_delivery_state := case v_provider_status
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'failed' then 'failed'
    else null
  end;

  if v_provider_message_id = ''
    or v_provider_status not in (
      'queued',
      'accepted',
      'sent',
      'delivered',
      'failed',
      'unknown'
    )
    or not (p_mutation -> 'event' ? 'providerErrorCode')
    or v_delivery_state is distinct from v_expected_delivery_state
    or (v_actual_segments is not null and v_actual_segments < 1)
    or (
      v_provider_cost_micro_usd is not null
      and v_provider_cost_micro_usd < 0
    )
  then
    raise exception using errcode = '22023', message = 'Invalid SMS status event.';
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = v_message_id
    and message.workspace_id = v_workspace_id
    and message.direction = 'outbound'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Outbound message not found.';
  end if;

  select detail.provider, detail.provider_cost_micro_usd
  into v_provider, v_current_cost
  from private.message_provider_details as detail
  where detail.message_id = v_message_id
    and detail.provider_message_id = v_provider_message_id
  for update;

  if v_provider is null then
    raise exception using
      errcode = '55000',
      message = 'SMS status routing context changed.';
  end if;

  if v_message.dispatch_state = 'dispatch_unknown' then
    if v_provider_status = 'failed' and v_actual_segments is null then
      v_message := private.mark_message_failed(
        v_message.id,
        v_message.reservation_token,
        v_provider,
        v_provider_message_id,
        v_provider_error_code,
        null,
        v_occurred_at
      );
    else
      v_message := private.mark_message_accepted(
        v_message.id,
        v_message.reservation_token,
        v_provider,
        v_provider_message_id,
        coalesce(v_message.dispatch_started_at, v_occurred_at)
      );
    end if;
  end if;

  if v_message.dispatch_state = 'accepted' and v_actual_segments is not null then
    v_message := private.record_message_actual_segments(
      v_message.id,
      v_actual_segments
    );
  end if;

  update private.message_provider_details as detail
  set
    provider_status = v_provider_status,
    provider_error_code = coalesce(
      v_provider_error_code,
      detail.provider_error_code
    ),
    provider_cost_micro_usd = coalesce(
      v_provider_cost_micro_usd,
      detail.provider_cost_micro_usd
    ),
    provider_currency = case
      when coalesce(v_provider_cost_micro_usd, detail.provider_cost_micro_usd)
        is not null then 'USD'
      else detail.provider_currency
    end,
    provider_cost_pending =
      coalesce(v_provider_cost_micro_usd, detail.provider_cost_micro_usd) is null
  where detail.message_id = v_message_id
  returning provider_cost_micro_usd into v_current_cost;

  if v_message.dispatch_state = 'accepted' and v_delivery_state is not null then
    v_message := private.record_message_delivery_state(
      v_message.id,
      v_delivery_state,
      v_occurred_at
    );
  end if;

  select message.*
  into v_message
  from public.messages as message
  where message.id = v_message_id;

  update private.message_provider_details
  set
    reconciliation_state = case
      when v_message.num_segments is not null and v_current_cost is not null
        then 'complete'
      else 'deferred'
    end,
    reconciliation_next_attempt_at = case
      when v_message.dispatch_state = 'accepted'
        and (v_message.num_segments is null or v_current_cost is null)
        then v_occurred_at + interval '5 minutes'
      else null
    end,
    reconciliation_reason = case
      when v_message.dispatch_state = 'accepted'
        and v_message.num_segments is null then 'segments_pending'
      when v_message.dispatch_state = 'accepted'
        and v_current_cost is null then 'provider_cost_pending'
      else null
    end,
    reconciled_at = case
      when v_message.num_segments is not null or v_current_cost is not null
        then v_occurred_at
      else reconciled_at
    end
  where message_id = v_message_id;

  if v_message.dispatch_state = 'accepted' then
    if v_message.num_segments is null then
      insert into private.billing_usage_ledger (
        workspace_id,
        billing_period_id,
        message_id,
        direction,
        num_segments,
        provider_cost_micro_usd,
        included_segments,
        overage_segments,
        customer_billable_amount_micro_usd,
        usage_position,
        included_segments_snapshot,
        overage_price_micro_usd_snapshot
      )
      values (
        v_message.workspace_id,
        v_message.billing_period_id,
        v_message.id,
        'outbound',
        null,
        v_current_cost,
        0,
        0,
        0,
        v_message.usage_position,
        v_message.included_segments_snapshot,
        v_message.overage_price_micro_usd_snapshot
      )
      on conflict (message_id) do update
      set provider_cost_micro_usd = excluded.provider_cost_micro_usd;
    else
      perform private.recalculate_billing_period_allocations(
        v_message.billing_period_id
      );
    end if;
  end if;

  if v_contact_id is not null then
    select contact.deleted_at is not null
    into v_deleted_contact
    from public.contacts as contact
    where contact.id = v_contact_id;
  end if;

  return jsonb_build_object(
    'duplicate', false,
    'contactId', v_contact_id,
    'inboundMessageId', null,
    'deletedContact', coalesce(v_deleted_contact, false),
    'associatedCampaignRecipientId', v_campaign_recipient_id
  );
end;
$$;

create or replace function public.apply_verified_sms_webhook_event(
  p_mutation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_event_id text;
  v_event_kind text;
  v_event_row_id uuid;
  v_expected_context jsonb;
  v_occurred_at timestamptz;
  v_provider_message_id text;
  v_result jsonb;
  v_routing_kind text;
  v_routing_value text;
  v_workspace_id uuid;
begin
  if p_mutation is null
    or pg_catalog.jsonb_typeof(p_mutation) <> 'object'
    or pg_catalog.jsonb_typeof(p_mutation -> 'expectedContext') <> 'object'
    or pg_catalog.jsonb_typeof(p_mutation -> 'event') <> 'object'
  then
    raise exception using errcode = '22023', message = 'Invalid SMS webhook mutation.';
  end if;

  v_event_kind := p_mutation ->> 'kind';
  v_expected_context := p_mutation -> 'expectedContext';
  v_event_id := pg_catalog.btrim(
    coalesce(p_mutation #>> '{event,eventId}', '')
  );
  v_provider_message_id := pg_catalog.btrim(
    coalesce(p_mutation #>> '{event,providerMessageId}', '')
  );

  begin
    v_occurred_at := (p_mutation #>> '{event,occurredAt}')::timestamptz;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'Invalid SMS webhook mutation.';
  end;

  if v_event_kind not in ('inbound', 'status')
    or p_mutation #>> '{event,kind}' is distinct from v_event_kind
    or v_event_id = ''
    or v_provider_message_id = ''
  then
    raise exception using errcode = '22023', message = 'Invalid SMS webhook mutation.';
  end if;

  if v_event_kind = 'inbound' then
    v_routing_kind := 'inbound_number';
    v_routing_value := p_mutation #>> '{event,toPhoneNumber}';
  else
    v_routing_kind := 'outbound_message';
    v_routing_value := v_provider_message_id;
  end if;

  v_context := private.resolve_sms_webhook_context(
    v_routing_kind,
    v_routing_value
  );

  if v_context is null then
    raise exception using
      errcode = '55000',
      message = 'SMS webhook routing context is unavailable.';
  end if;

  begin
    v_workspace_id := (v_context ->> 'workspaceId')::uuid;
  exception
    when invalid_text_representation then
      raise exception using
        errcode = '55000',
        message = 'SMS webhook routing context is invalid.';
  end;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  v_context := private.resolve_sms_webhook_context(
    v_routing_kind,
    v_routing_value
  );

  if v_context is null or v_context is distinct from v_expected_context then
    raise exception using
      errcode = '55000',
      message = 'SMS webhook routing context changed.';
  end if;

  insert into private.webhook_events (
    workspace_id,
    event_kind,
    event_id,
    provider_message_id,
    occurred_at
  )
  values (
    v_workspace_id,
    v_event_kind,
    v_event_id,
    v_provider_message_id,
    v_occurred_at
  )
  on conflict (workspace_id, event_kind, event_id) do nothing
  returning id into v_event_row_id;

  if v_event_row_id is null then
    return jsonb_build_object(
      'duplicate', true,
      'contactId', null,
      'inboundMessageId', null,
      'deletedContact', false,
      'associatedCampaignRecipientId', null
    );
  end if;

  if v_event_kind = 'inbound' then
    v_result := private.apply_verified_inbound_sms_webhook(
      p_mutation,
      v_context
    );
  else
    v_result := private.apply_verified_status_sms_webhook(
      p_mutation,
      v_context
    );
  end if;

  update private.webhook_events
  set
    contact_id = nullif(v_result ->> 'contactId', '')::uuid,
    inbound_message_id = nullif(v_result ->> 'inboundMessageId', '')::uuid,
    associated_campaign_recipient_id =
      nullif(v_result ->> 'associatedCampaignRecipientId', '')::uuid
  where id = v_event_row_id;

  return v_result;
end;
$$;

create or replace function public.send_manual_message_simulated(
  p_contact_id uuid,
  p_phone_number_id uuid,
  p_body text
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual_usage integer;
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_contact public.contacts;
  v_estimated_segments integer;
  v_included_snapshot integer;
  v_message public.messages;
  v_now timestamptz := pg_catalog.now();
  v_overage_snapshot bigint;
  v_period_id uuid;
  v_reserved_usage integer;
  v_safety_cap integer;
  v_usage_position bigint;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;
  if v_body = '' or pg_catalog.char_length(v_body) > 1600 then
    raise exception using errcode = '22023', message = 'Message content is invalid.';
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
    and workspace.owner_id = (select auth.uid())
  for update;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
    and contact.workspace_id = v_workspace_id
  for update;

  if v_contact.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'This contact cannot receive messages.';
  end if;

  if exists (
    select 1
    from public.suppressions as suppression
    where suppression.workspace_id = v_workspace_id
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

  v_estimated_segments := private.estimate_sms_segments(v_body);
  v_period_id := private.ensure_current_billing_period(v_workspace_id, v_now);

  select
    usage.actual_outbound_segments,
    usage.reserved_outbound_segments,
    period.included_segments_snapshot,
    period.overage_price_micro_usd_snapshot,
    coalesce(
      control.safety_cap_segments_override,
      period.safety_cap_segments_snapshot
    )
  into
    v_actual_usage,
    v_reserved_usage,
    v_included_snapshot,
    v_overage_snapshot,
    v_safety_cap
  from public.billing_period_usage as usage
  join public.billing_periods as period
    on period.id = usage.billing_period_id
  join private.workspace_messaging_controls as control
    on control.workspace_id = usage.workspace_id
  where usage.billing_period_id = v_period_id
  for update of usage;

  if v_actual_usage + v_reserved_usage + v_estimated_segments > v_safety_cap then
    raise exception using
      errcode = '55000',
      message = 'SMS usage safety cap reached.';
  end if;

  update public.billing_period_usage
  set
    actual_outbound_segments =
      actual_outbound_segments + v_estimated_segments,
    next_usage_position = next_usage_position + 1
  where billing_period_id = v_period_id
  returning next_usage_position into v_usage_position;

  insert into public.messages (
    workspace_id,
    contact_id,
    phone_number_id,
    direction,
    body,
    dispatch_state,
    delivery_state,
    estimated_segments,
    num_segments,
    billing_period_id,
    usage_position,
    included_segments_snapshot,
    overage_price_micro_usd_snapshot,
    accepted_at,
    sent_at,
    created_at
  )
  values (
    v_workspace_id,
    p_contact_id,
    p_phone_number_id,
    'outbound',
    v_body,
    'accepted',
    'sent',
    v_estimated_segments,
    v_estimated_segments,
    v_period_id,
    v_usage_position,
    v_included_snapshot,
    v_overage_snapshot,
    v_now,
    v_now,
    v_now
  )
  returning * into v_message;

  insert into private.message_provider_details (
    message_id,
    provider,
    provider_message_id,
    provider_status,
    provider_cost_micro_usd,
    provider_currency,
    provider_cost_pending,
    reconciliation_state,
    reconciled_at
  )
  values (
    v_message.id,
    'simulated',
    'simulated-' || v_message.id::text,
    'sent',
    0,
    'USD',
    false,
    'complete',
    v_now
  );

  perform private.recalculate_billing_period_allocations(v_period_id);
  return v_message;
end;
$$;

create or replace function private.claim_inbound_reconciliation(
  p_limit integer default 100,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  provider text,
  provider_message_id text,
  reconciliation_token uuid,
  billing_period_id uuid,
  attempt_count integer
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
    where message.direction = 'inbound'
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
      coalesce(detail.reconciliation_next_attempt_at, message.received_at),
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
      detail.reconciliation_token,
      detail.reconciliation_attempt_count
  )
  select
    message.id,
    message.workspace_id,
    claimed.provider,
    claimed.provider_message_id,
    claimed.reconciliation_token,
    ledger.billing_period_id,
    claimed.reconciliation_attempt_count
  from claimed
  join public.messages as message on message.id = claimed.message_id
  join private.billing_usage_ledger as ledger
    on ledger.message_id = message.id;
end;
$$;

create or replace function public.inbound_reconciliation_claim_next(
  p_worker_id text,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  message_id uuid,
  workspace_id uuid,
  provider text,
  provider_message_id text,
  reconciliation_token uuid,
  billing_period_id uuid,
  attempt_count integer
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
  from private.claim_inbound_reconciliation(1, p_now);
end;
$$;

create or replace function public.inbound_reconciliation_complete(
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
  if (p_actual_segments is not null and p_actual_segments < 1)
    or (
      p_provider_cost_micro_usd is not null
      and p_provider_cost_micro_usd < 0
    )
    or (p_provider_cost_micro_usd is not null and p_provider_cost_pending)
  then
    raise exception using
      errcode = '22023',
      message = 'Inbound reconciliation values are invalid.';
  end if;

  select message.workspace_id
  into v_workspace_id
  from public.messages as message
  where message.id = p_message_id
    and message.direction = 'inbound';

  if v_workspace_id is null then
    raise exception using errcode = 'P0002', message = 'Inbound message not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
  for update;

  select message.*
  into v_message
  from public.messages as message
  where message.id = p_message_id
    and message.direction = 'inbound'
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
      message = 'Inbound reconciliation claim is no longer valid.';
  end if;

  if p_actual_segments is not null
    and v_message.num_segments is not null
    and v_message.num_segments <> p_actual_segments
  then
    raise exception using
      errcode = '23514',
      message = 'Actual inbound SMS segments cannot change after reconciliation.';
  end if;

  if v_detail.reconciliation_state = 'complete' then
    return v_message;
  end if;

  if p_actual_segments is not null then
    update public.messages
    set num_segments = p_actual_segments
    where id = p_message_id
    returning * into v_message;
  end if;

  update private.message_provider_details
  set
    provider_cost_micro_usd = coalesce(
      p_provider_cost_micro_usd,
      provider_cost_micro_usd
    ),
    provider_currency = case
      when coalesce(p_provider_cost_micro_usd, provider_cost_micro_usd)
        is not null then 'USD'
      else provider_currency
    end,
    provider_cost_pending = p_provider_cost_pending,
    reconciliation_state = case
      when v_message.num_segments is null or p_provider_cost_pending
        then 'deferred'
      else 'complete'
    end,
    reconciliation_next_attempt_at = case
      when v_message.num_segments is null
        then p_reconciled_at + interval '5 minutes'
      when p_provider_cost_pending
        then p_reconciled_at + interval '1 day'
      else null
    end,
    reconciliation_reason = case
      when v_message.num_segments is null then 'segments_pending'
      when p_provider_cost_pending then 'provider_cost_pending'
      else null
    end,
    reconciled_at = p_reconciled_at
  where message_id = p_message_id
  returning * into v_detail;

  update private.billing_usage_ledger
  set
    num_segments = v_message.num_segments,
    provider_cost_micro_usd = v_detail.provider_cost_micro_usd,
    included_segments = 0,
    overage_segments = 0,
    customer_billable_amount_micro_usd = 0
  where message_id = p_message_id;

  return v_message;
end;
$$;

create or replace function public.inbound_reconciliation_defer(
  p_message_id uuid,
  p_reconciliation_token uuid,
  p_next_attempt_at timestamptz,
  p_error_code text,
  p_deferred_at timestamptz default pg_catalog.now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_next_attempt_at <= p_deferred_at
    or pg_catalog.btrim(coalesce(p_error_code, '')) = ''
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid reconciliation deferral.';
  end if;

  update private.message_provider_details as detail
  set
    reconciliation_state = 'deferred',
    reconciliation_next_attempt_at = p_next_attempt_at,
    reconciliation_reason = pg_catalog.btrim(p_error_code)
  from public.messages as message
  where detail.message_id = p_message_id
    and detail.reconciliation_token = p_reconciliation_token
    and detail.reconciliation_state in ('claimed', 'deferred')
    and message.id = detail.message_id
    and message.direction = 'inbound';

  if not found then
    raise exception using
      errcode = '55000',
      message = 'Inbound reconciliation claim is no longer valid.';
  end if;
end;
$$;

revoke all on table private.webhook_events
  from public, anon, authenticated;
revoke all on table private.billing_usage_ledger
  from public, anon, authenticated;

revoke all on function public.resolve_sms_webhook_context(text, text)
  from public, anon, authenticated;
revoke all on function public.apply_verified_sms_webhook_event(jsonb)
  from public, anon, authenticated;
revoke all on function public.send_manual_message_simulated(uuid, uuid, text)
  from public, anon;
revoke all on function public.inbound_reconciliation_claim_next(
  text,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.inbound_reconciliation_complete(
  uuid,
  uuid,
  integer,
  bigint,
  boolean,
  timestamptz
) from public, anon, authenticated;
revoke all on function public.inbound_reconciliation_defer(
  uuid,
  uuid,
  timestamptz,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.resolve_sms_webhook_context(text, text)
  to service_role;
grant execute on function public.apply_verified_sms_webhook_event(jsonb)
  to service_role;
grant execute on function public.send_manual_message_simulated(uuid, uuid, text)
  to authenticated;
grant execute on function public.inbound_reconciliation_claim_next(
  text,
  timestamptz
) to service_role;
grant execute on function public.inbound_reconciliation_complete(
  uuid,
  uuid,
  integer,
  bigint,
  boolean,
  timestamptz
) to service_role;
grant execute on function public.inbound_reconciliation_defer(
  uuid,
  uuid,
  timestamptz,
  text,
  timestamptz
) to service_role;

revoke all on all functions in schema private
  from public, anon, authenticated;

alter table public.messages replica identity full;
alter table public.contacts replica identity full;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_publication as publication
    where publication.pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables as published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_publication_tables as published
      where published.pubname = 'supabase_realtime'
        and published.schemaname = 'public'
        and published.tablename = 'contacts'
    ) then
      alter publication supabase_realtime add table public.contacts;
    end if;
  end if;
end;
$$;

comment on column public.messages.received_at is
  'Actual occurrence time for an inbound SMS, used by Inbox ordering.';
comment on column public.messages.in_reply_to_message_id is
  'Product-safe association to the accepted campaign outbound answered by this inbound.';
comment on table private.webhook_events is
  'Workspace-scoped webhook idempotency keys and safe mutation correlations; internal only.';
comment on table private.billing_usage_ledger is
  'Internal immutable message trace for provider cost and customer allocation. Inbound customer amounts are always zero.';
comment on function public.apply_verified_sms_webhook_event(jsonb) is
  'Atomically re-resolves routing, deduplicates, and applies one verified SMS webhook mutation.';
comment on function public.send_manual_message_simulated(uuid, uuid, text) is
  'Slice 4 simulated manual send with opt-out, Ready-number, and transactional safety-cap enforcement.';

commit;
