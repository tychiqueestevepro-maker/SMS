-- Polling may run more frequently than a campaign's drip cadence. Enforce the
-- configured cadence transactionally so an overdue backlog cannot be sent as
-- a burst after a worker outage.
CREATE INDEX IF NOT EXISTS messages_campaign_recent_reservation_idx
  ON public.messages (campaign_id, reserved_at DESC)
  WHERE direction = 'outbound' AND dispatch_state = 'reserved';

CREATE INDEX IF NOT EXISTS messages_campaign_recent_attempt_idx
  ON public.messages (campaign_id, dispatch_started_at DESC)
  WHERE direction = 'outbound' AND dispatch_started_at IS NOT NULL;

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
        from public.messages as recent_message
        where recent_message.campaign_id = campaign.id
          and recent_message.direction = 'outbound'
          and (
            (
              recent_message.dispatch_state = 'reserved'
              and recent_message.reserved_at
                > p_now - (campaign.drip_interval_minutes * interval '1 minute')
            )
            or recent_message.dispatch_started_at
              > p_now - (campaign.drip_interval_minutes * interval '1 minute')
          )
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
$function$
;

COMMENT ON FUNCTION private.reserve_due_campaign_messages(uuid, integer, timestamptz) IS
  'Claims due recipients while enforcing each campaign drip interval between dispatch attempts.';
