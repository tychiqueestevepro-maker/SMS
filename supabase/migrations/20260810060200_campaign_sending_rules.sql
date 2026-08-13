ALTER TABLE public.campaigns 
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC', 
  ADD COLUMN send_window_start time NOT NULL DEFAULT time '09:00:00', 
  ADD COLUMN send_window_end time NOT NULL DEFAULT time '18:00:00', 
  ADD COLUMN drip_interval_minutes integer NOT NULL DEFAULT 0, 
  ADD CONSTRAINT campaigns_send_window_valid CHECK (send_window_start < send_window_end), 
  ADD CONSTRAINT campaigns_drip_valid CHECK (drip_interval_minutes >= 0);

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_phone_e164_valid;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_phone_e164_valid CHECK (phone_e164 ~ '^\\+[1-9]\\d{9,14}$');

ALTER TABLE public.phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_phone_e164_valid;
ALTER TABLE public.phone_numbers ADD CONSTRAINT phone_numbers_phone_e164_valid CHECK (phone_e164 ~ '^\\+[1-9]\\d{9,14}$');

ALTER TABLE public.suppressions DROP CONSTRAINT IF EXISTS suppressions_phone_e164_valid;
ALTER TABLE public.suppressions ADD CONSTRAINT suppressions_phone_e164_valid CHECK (phone_e164 ~ '^\\+[1-9]\\d{9,14}$');

DROP FUNCTION IF EXISTS private.is_within_workspace_send_window(uuid, timestamp with time zone);

CREATE OR REPLACE FUNCTION private.is_within_campaign_send_window(p_campaign_id uuid, p_at timestamp with time zone) 
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' 
AS $$ 
  select (p_at at time zone campaign.timezone)::time >= campaign.send_window_start and (p_at at time zone campaign.timezone)::time < campaign.send_window_end 
  from public.campaigns as campaign where campaign.id = p_campaign_id; 
$$;

CREATE OR REPLACE FUNCTION public.launch_campaign(p_campaign_id uuid, p_confirmed_contact_count integer DEFAULT NULL::integer, p_confirmed_large_launch boolean DEFAULT false, p_consent_confirmed boolean DEFAULT false, p_confirmed_assessment jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_now + ((row_number() over() - 1) * v_campaign.drip_interval_minutes * interval '1 minute'),
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
$function$
;

CREATE OR REPLACE FUNCTION private.reserve_due_campaign_messages(p_workspace_id uuid, p_limit integer DEFAULT 100, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(message_id uuid, workspace_id uuid, campaign_id uuid, campaign_recipient_id uuid, contact_id uuid, phone_number_id uuid, step_order smallint, body text, reservation_token uuid, estimated_segments integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      and private.is_within_campaign_send_window(recipient.campaign_id, p_now)
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
$function$
;

CREATE OR REPLACE FUNCTION private.begin_message_dispatch(p_message_id uuid, p_reservation_token uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
