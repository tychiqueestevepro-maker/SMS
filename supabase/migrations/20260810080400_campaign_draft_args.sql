CREATE OR REPLACE FUNCTION public.create_campaign_draft(p_workspace_id uuid, p_name text, p_steps jsonb, p_phone_number_id uuid DEFAULT NULL::uuid,
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2)
 RETURNS campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.campaigns;
  v_name text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if p_phone_number_id is not null and not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = p_phone_number_id
      and phone_number.workspace_id = p_workspace_id
      and phone_number.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Phone number not found.';
  end if;

  insert into public.campaigns (
    workspace_id,
    phone_number_id,
    name,
    timezone,
    send_window_start,
    send_window_end,
    drip_interval_minutes
  )
  values (
    p_workspace_id,
    p_phone_number_id,
    v_name,
    p_timezone,
    p_send_window_start,
    p_send_window_end,
    p_drip_interval_minutes
  )
  returning * into v_campaign;

  perform private.replace_campaign_steps(v_campaign.id, p_steps);
  return v_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_campaign_draft(p_campaign_id uuid, p_name text, p_steps jsonb, p_phone_number_id uuid DEFAULT NULL::uuid,
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2)
 RETURNS campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.campaigns;
  v_name text;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
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
    raise exception using
      errcode = '55000',
      message = 'Only draft campaigns can change messages or recipients.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if p_phone_number_id is not null and not exists (
    select 1
    from public.phone_numbers as phone_number
    where phone_number.id = p_phone_number_id
      and phone_number.workspace_id = v_workspace_id
      and phone_number.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Phone number not found.';
  end if;

  update public.campaigns
  set
    name = v_name,
    phone_number_id = p_phone_number_id,
    timezone = p_timezone,
    send_window_start = p_send_window_start,
    send_window_end = p_send_window_end,
    drip_interval_minutes = p_drip_interval_minutes
  where id = p_campaign_id
  returning * into v_campaign;

  perform private.replace_campaign_steps(p_campaign_id, p_steps);
  return v_campaign;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_campaign_draft(p_workspace_id uuid, p_campaign_id uuid, p_name text, p_steps jsonb, p_phone_number_id uuid, p_contact_ids uuid[],
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2)
 RETURNS campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_campaign public.campaigns;
  v_contact_id uuid;
  v_distinct_contact_count integer;
  v_found_contact_count integer;
begin
  if p_contact_ids is not null
    and pg_catalog.array_position(p_contact_ids, null::uuid) is not null
  then
    raise exception using
      errcode = '22023',
      message = 'Campaign contact selection is invalid.';
  end if;

  select count(distinct selected.contact_id)::integer
  into v_distinct_contact_count
  from pg_catalog.unnest(coalesce(p_contact_ids, '{}'::uuid[]))
    as selected(contact_id);

  select count(*)::integer
  into v_found_contact_count
  from public.contacts as contact
  where contact.workspace_id = p_workspace_id
    and contact.id = any(coalesce(p_contact_ids, '{}'::uuid[]));

  if v_found_contact_count <> v_distinct_contact_count then
    raise exception using
      errcode = '22023',
      message = 'One or more selected contacts are unavailable.';
  end if;

  perform 1
  from public.contacts as contact
  where contact.workspace_id = p_workspace_id
    and contact.id = any(coalesce(p_contact_ids, '{}'::uuid[]))
  order by contact.id
  for update;

  if p_campaign_id is null then
    v_campaign := public.create_campaign_draft(
      p_workspace_id,
      p_name,
      p_steps,
      p_phone_number_id,
      p_timezone,
      p_send_window_start,
      p_send_window_end,
      p_drip_interval_minutes
    );
  else
    v_campaign := public.update_campaign_draft(
      p_campaign_id,
      p_name,
      p_steps,
      p_phone_number_id,
      p_timezone,
      p_send_window_start,
      p_send_window_end,
      p_drip_interval_minutes
    );

    if v_campaign.workspace_id <> p_workspace_id then
      raise exception using
        errcode = 'P0002',
        message = 'Campaign not found.';
    end if;
  end if;

  delete from public.campaign_draft_contacts
  where campaign_id = v_campaign.id;

  foreach v_contact_id in array coalesce(p_contact_ids, '{}'::uuid[])
  loop
    insert into public.campaign_draft_contacts (campaign_id, contact_id)
    values (v_campaign.id, v_contact_id)
    on conflict (campaign_id, contact_id) do nothing;
  end loop;

  return v_campaign;
end;
$function$
;

