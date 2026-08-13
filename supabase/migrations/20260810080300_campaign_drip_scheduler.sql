ALTER TABLE public.campaigns ALTER COLUMN drip_interval_minutes SET DEFAULT 2;
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_drip_valid;
-- Update any existing campaigns that have drip 0
UPDATE public.campaigns SET drip_interval_minutes = 2 WHERE drip_interval_minutes < 1;

ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_drip_valid CHECK (drip_interval_minutes >= 1 AND drip_interval_minutes <= 1440);

CREATE OR REPLACE FUNCTION private.generate_campaign_drip_schedule(
  p_start_time timestamptz,
  p_count integer,
  p_timezone text,
  p_window_start time,
  p_window_end time,
  p_drip_interval_minutes integer
) RETURNS SETOF timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_current_time timestamptz := p_start_time;
  v_current_local_time time;
  v_count integer := 0;
BEGIN
  WHILE v_count < p_count LOOP
    v_current_local_time := (v_current_time AT TIME ZONE p_timezone)::time;

    IF v_current_local_time >= p_window_end THEN
      -- Move to tomorrow window start
      v_current_time := (date_trunc('day', v_current_time AT TIME ZONE p_timezone + interval '1 day') + p_window_start) AT TIME ZONE p_timezone;
    ELSIF v_current_local_time < p_window_start THEN
      -- Move to today window start
      v_current_time := (date_trunc('day', v_current_time AT TIME ZONE p_timezone) + p_window_start) AT TIME ZONE p_timezone;
    END IF;

    -- Now v_current_time is inside the window
    RETURN NEXT v_current_time;
    v_count := v_count + 1;
    v_current_time := v_current_time + (p_drip_interval_minutes * interval '1 minute');
  END LOOP;
END;
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
    coalesce(
      scheduled.drip_time,
      v_now + ((eligible.idx - 1) * v_campaign.drip_interval_minutes * interval '1 minute')
    ),
    v_now
  from pg_catalog.jsonb_array_elements_text(
    coalesce(
      v_assessment -> 'eligible_recipient_ids',
      v_assessment -> 'eligible_contact_ids',
      '[]'::jsonb
    )
  ) with ordinality as eligible(value, idx)
  left join private.generate_campaign_drip_schedule(v_now, (v_assessment ->> 'eligible_recipient_count')::integer, v_campaign.timezone, v_campaign.send_window_start, v_campaign.send_window_end, v_campaign.drip_interval_minutes) with ordinality as scheduled(drip_time, idx) on eligible.idx = scheduled.idx;

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
