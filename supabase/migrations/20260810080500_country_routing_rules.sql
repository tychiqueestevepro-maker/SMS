begin;

-- 1. Add country_code to phone_numbers
alter table public.phone_numbers add column country_code text;

-- 2. Add country_code to contacts
alter table public.contacts add column country_code text;

-- 3. Backfill phone_numbers (Basic detection for existing rows)
update public.phone_numbers
set country_code = case
  when phone_e164 like '+33%' then 'FR'
  when phone_e164 ~ '^\+1(204|226|236|249|250|263|289|306|343|365|367|368|403|416|418|431|437|450|468|474|506|514|519|548|579|581|587|604|613|639|647|672|683|705|709|742|753|778|780|807|819|825|867|873|902|905|942)' then 'CA'
  when phone_e164 like '+1%' then 'US'
  else 'US' -- Fallback
end
where country_code is null;

-- 4. Backfill contacts
update public.contacts
set country_code = case
  when phone_e164 like '+33%' then 'FR'
  when phone_e164 ~ '^\+1(204|226|236|249|250|263|289|306|343|365|367|368|403|416|418|431|437|450|468|474|506|514|519|548|579|581|587|604|613|639|647|672|683|705|709|742|753|778|780|807|819|825|867|873|902|905|942)' then 'CA'
  when phone_e164 like '+1%' then 'US'
  else 'US'
end
where country_code is null;

-- 5. Make country_code required
alter table public.phone_numbers alter column country_code set not null;
alter table public.contacts alter column country_code set not null;

-- 6. Central Routing Logic
create or replace function public.is_destination_allowed(
  p_sender_country text,
  p_destination_country text
) returns boolean
language plpgsql immutable
as $$
begin
  if p_sender_country = 'US' then return p_destination_country in ('US', 'CA');
  elsif p_sender_country = 'CA' then return p_destination_country in ('CA', 'US');
  elsif p_sender_country = 'FR' then return p_destination_country in ('FR');
  else return false;
  end if;
end;
$$;

-- 7. Update assess_campaign_launch to flag 'unsupported_country'
create or replace function private.compute_campaign_launch_assessment(
  p_campaign_id uuid,
  p_contact_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_sequence_count integer;
  v_current_effective integer;
  v_current_overage integer;
  v_deleted_count integer;
  v_duplicate_count integer;
  v_eligible_count integer;
  v_eligible_ids uuid[];
  v_estimated_first_step integer;
  v_found_count integer;
  v_included_segments integer;
  v_large_threshold integer;
  v_new_overage integer;
  v_opted_out_count integer;
  v_unsupported_country_count integer;
  v_overage_threshold integer;
  v_period_id uuid;
  v_projected_overage integer;
  v_projected_usage integer;
  v_reasons jsonb := '[]'::jsonb;
  v_selected_count integer;
  v_skipped jsonb;
  v_unique_count integer;
  v_workspace_id uuid;
  v_sender_country text;
begin
  if p_contact_ids is null
    or pg_catalog.cardinality(p_contact_ids) = 0
    or pg_catalog.array_position(p_contact_ids, null::uuid) is not null
  then
    raise exception using
      errcode = '22023',
      message = 'Select at least one contact.';
  end if;

  select campaign.workspace_id
  into v_workspace_id
  from public.campaigns as campaign
  where campaign.id = p_campaign_id
    and campaign.deleted_at is null;

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Campaign not found.';
  end if;

  select phone_numbers.country_code
  into v_sender_country
  from public.phone_numbers
  join public.campaigns on campaigns.phone_number_id = phone_numbers.id
  where campaigns.id = p_campaign_id;

  v_selected_count := pg_catalog.cardinality(p_contact_ids);

  select count(distinct selected.contact_id)::integer
  into v_unique_count
  from pg_catalog.unnest(p_contact_ids) as selected(contact_id);

  select count(*)::integer
  into v_found_count
  from public.contacts as contact
  where contact.workspace_id = v_workspace_id
    and contact.id = any(p_contact_ids);

  if v_found_count <> v_unique_count then
    raise exception using
      errcode = '22023',
      message = 'One or more selected contacts are unavailable.';
  end if;

  v_duplicate_count := v_selected_count - v_unique_count;
  v_period_id := private.ensure_current_billing_period(
    v_workspace_id,
    pg_catalog.now()
  );

  select
    period.included_segments_snapshot,
    usage.actual_outbound_segments + usage.reserved_outbound_segments,
    plan.large_campaign_recipient_threshold,
    plan.large_campaign_overage_credit_threshold
  into
    v_included_segments,
    v_current_effective,
    v_large_threshold,
    v_overage_threshold
  from public.billing_periods as period
  join public.billing_period_usage as usage
    on usage.billing_period_id = period.id
  join public.billing_plans as plan
    on plan.id = period.billing_plan_id
  where period.id = v_period_id;

  with selected as (
    select distinct selected_contact.contact_id
    from pg_catalog.unnest(p_contact_ids) as selected_contact(contact_id)
  ),
  classified as (
    select
      contact.id as contact_id,
      case
        when contact.deleted_at is not null then 'deleted'
        when exists (
          select 1
          from public.suppressions as suppression
          where suppression.workspace_id = contact.workspace_id
            and suppression.phone_e164 = contact.phone_e164
        ) then 'opted_out'
        when exists (
          select 1
          from public.campaign_recipients as active_recipient
          where active_recipient.workspace_id = contact.workspace_id
            and active_recipient.contact_id = contact.id
            and (
              active_recipient.state = 'active'
              or (
                active_recipient.state = 'stopped'
                and active_recipient.stop_reason = 'dispatch_unknown'
              )
            )
        ) then 'active_sequence'
        when v_sender_country is not null and not public.is_destination_allowed(v_sender_country, contact.country_code) then 'unsupported_country'
        else null
      end as reason,
      private.estimate_sms_segments(
        private.render_campaign_template(
          first_step.body,
          contact.first_name,
          contact.last_name,
          contact.company
        )
      ) as estimated_segments
    from selected
    join public.contacts as contact on contact.id = selected.contact_id
    cross join lateral (
      select step.body
      from public.campaign_steps as step
      where step.campaign_id = p_campaign_id
        and step.step_order = 1
    ) as first_step
    where contact.workspace_id = v_workspace_id
  )
  select
    count(*) filter (where reason = 'deleted')::integer,
    count(*) filter (where reason = 'opted_out')::integer,
    count(*) filter (where reason = 'active_sequence')::integer,
    count(*) filter (where reason = 'unsupported_country')::integer,
    count(*) filter (where reason is null)::integer,
    coalesce(sum(estimated_segments) filter (where reason is null), 0)::integer,
    coalesce(
      array_agg(contact_id order by contact_id) filter (where reason is null),
      '{}'::uuid[]
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object('contact_id', contact_id, 'reason', reason)
        order by contact_id
      ) filter (where reason is not null),
      '[]'::jsonb
    )
  into
    v_deleted_count,
    v_opted_out_count,
    v_active_sequence_count,
    v_unsupported_country_count,
    v_eligible_count,
    v_estimated_first_step,
    v_eligible_ids,
    v_skipped
  from classified;

  v_projected_usage := v_current_effective + v_estimated_first_step;
  v_current_overage := greatest(
    0,
    v_current_effective - v_included_segments
  );
  v_projected_overage := greatest(
    0,
    v_projected_usage - v_included_segments
  );
  v_new_overage := v_projected_overage - v_current_overage;

  if v_eligible_count >= v_large_threshold then
    v_reasons := v_reasons || '"large_volume"'::jsonb;
  end if;
  if v_new_overage > 0 and v_new_overage >= v_overage_threshold then
    v_reasons := v_reasons || '"possible_overage"'::jsonb;
  end if;

  return jsonb_build_object(
    'selected_count', v_selected_count,
    'eligible_recipient_count', v_eligible_count,
    'skipped_count',
      v_duplicate_count + v_deleted_count + v_opted_out_count + v_active_sequence_count + coalesce(v_unsupported_country_count, 0),
    'duplicate_selection_count', v_duplicate_count,
    'deleted_count', v_deleted_count,
    'opted_out_count', v_opted_out_count,
    'active_sequence_count', v_active_sequence_count,
    'unsupported_country_count', coalesce(v_unsupported_country_count, 0),
    'eligible_recipient_ids', v_eligible_ids,
    'skipped_recipients', v_skipped,
    'current_effective_usage_credits', v_current_effective,
    'estimated_first_step_credits', v_estimated_first_step,
    'estimated_new_overage_credits', v_new_overage,
    'included_credits', v_included_segments,
    'included_credits_remaining', greatest(0, v_included_segments - v_current_effective),
    'projected_usage_credits', v_projected_usage,
    'reasons', v_reasons,
    'requires_confirmation', jsonb_array_length(v_reasons) > 0
  );
end;
$$;

-- 8. Enforce routing in begin_message_dispatch
alter function private.begin_message_dispatch(uuid, uuid, timestamptz)
  rename to begin_message_dispatch_before_country_check;

create or replace function private.begin_message_dispatch(
  p_message_id uuid,
  p_reservation_token uuid,
  p_now timestamptz default pg_catalog.now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_country text;
  v_destination_country text;
begin
  select phone_numbers.country_code, contacts.country_code
  into v_sender_country, v_destination_country
  from public.messages as message
  join public.phone_numbers on phone_numbers.id = message.phone_number_id
  join public.contacts on contacts.id = message.contact_id
  where message.id = p_message_id;

  if v_sender_country is not null and v_destination_country is not null then
    if not public.is_destination_allowed(v_sender_country, v_destination_country) then
      perform private.release_reserved_message(p_message_id, 'pending', null);
      -- Also stop the message by setting dispatch_state to 'stopped' and stop_reason
      perform private.record_dispatch_unknown_details(
        p_message_id,
        'unsupported_country',
        'Message cannot be routed to this destination country from this sender'
      );
      return pg_catalog.jsonb_build_object(
        'authorized', false,
        'code', 'unsupported_country'
      );
    end if;
  end if;

  return private.begin_message_dispatch_before_country_check(
    p_message_id,
    p_reservation_token,
    p_now
  );
end;
$$;

-- 9. Update create_contact to require country_code
create or replace function public.create_contact(
  p_workspace_id uuid,
  p_phone_e164 text,
  p_country_code text,
  p_first_name text default '',
  p_last_name text default '',
  p_company text default '',
  p_pipeline_stage_id uuid default null
)
returns public.contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_stage_id uuid;
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

  if p_phone_e164 is null or p_country_code is null then
    raise exception using errcode = '22023', message = 'Enter a valid phone number and country code.';
  end if;

  if exists (
    select 1
    from public.contacts as contact
    where contact.workspace_id = p_workspace_id
      and contact.phone_e164 = p_phone_e164
  ) then
    raise exception using errcode = '23505', constraint = 'contacts_workspace_phone_e164_key', message = 'A contact with this phone number already exists.';
  end if;

  v_stage_id := coalesce(p_pipeline_stage_id, private.default_pipeline_stage_id(p_workspace_id));

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = v_stage_id
      and stage.workspace_id = p_workspace_id
  ) then
    raise exception using errcode = '23503', message = 'Pipeline stage not found.';
  end if;

  insert into public.contacts (
    workspace_id,
    pipeline_stage_id,
    first_name,
    last_name,
    company,
    phone_e164,
    country_code
  )
  values (
    p_workspace_id,
    v_stage_id,
    pg_catalog.btrim(coalesce(p_first_name, '')),
    pg_catalog.btrim(coalesce(p_last_name, '')),
    pg_catalog.btrim(coalesce(p_company, '')),
    p_phone_e164,
    p_country_code
  )
  returning * into v_contact;

  return v_contact;
end;
$$;

-- 10. Update update_contact to require country_code
create or replace function public.update_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_company text,
  p_phone_e164 text,
  p_country_code text,
  p_pipeline_stage_id uuid default null
)
returns public.contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_workspace_id uuid;
  v_stage_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required.';
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

  if not found then
    raise exception using errcode = 'P0002', message = 'Contact not found.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
    and contact.workspace_id = v_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Contact not found.';
  end if;

  if v_contact.deleted_at is not null then
    raise exception using errcode = '55000', message = 'Deleted contacts are read-only.';
  end if;

  if p_phone_e164 is null or p_country_code is null then
    raise exception using errcode = '22023', message = 'Enter a valid phone number and country code.';
  end if;

  v_stage_id := coalesce(p_pipeline_stage_id, v_contact.pipeline_stage_id);

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = v_stage_id
      and stage.workspace_id = v_workspace_id
  ) then
    raise exception using errcode = '23503', message = 'Pipeline stage not found.';
  end if;

  update public.contacts
  set
    first_name = pg_catalog.btrim(coalesce(p_first_name, '')),
    last_name = pg_catalog.btrim(coalesce(p_last_name, '')),
    company = pg_catalog.btrim(coalesce(p_company, '')),
    phone_e164 = p_phone_e164,
    country_code = p_country_code,
    pipeline_stage_id = v_stage_id
  where id = p_contact_id
  returning * into v_contact;

  return v_contact;
end;
$$;

-- 11. Update bulk_upsert_contacts to handle country_code
create or replace function public.bulk_upsert_contacts(
  p_workspace_id uuid,
  p_contacts jsonb
)
returns table (
  input_index integer,
  contact_id uuid,
  action text,
  is_suppressed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_value jsonb;
  v_phone_e164 text;
  v_country_code text;
  v_first_name text;
  v_last_name text;
  v_company text;
  v_default_stage_id uuid;
  v_existing public.contacts;
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

  if p_contacts is null or pg_catalog.jsonb_typeof(p_contacts) <> 'array' then
    raise exception using errcode = '22023', message = 'Contacts must be provided as an array.';
  end if;

  v_default_stage_id := private.default_pipeline_stage_id(p_workspace_id);

  for v_item in
    select imported.value, imported.ordinality
    from pg_catalog.jsonb_array_elements(p_contacts)
      with ordinality as imported(value, ordinality)
    order by imported.ordinality
  loop
    v_value := v_item.value;
    input_index := v_item.ordinality::integer;

    if pg_catalog.jsonb_typeof(v_value) <> 'object' then
      raise exception using errcode = '22023', message = pg_catalog.format('Contact at input position %s is invalid.', input_index);
    end if;

    v_phone_e164 := pg_catalog.btrim(coalesce(v_value ->> 'phone_e164', v_value ->> 'phoneE164', ''));
    v_country_code := coalesce(v_value ->> 'country_code', v_value ->> 'countryCode', '');
    v_first_name := pg_catalog.btrim(coalesce(v_value ->> 'first_name', v_value ->> 'firstName', ''));
    v_last_name := pg_catalog.btrim(coalesce(v_value ->> 'last_name', v_value ->> 'lastName', ''));
    v_company := pg_catalog.btrim(coalesce(v_value ->> 'company', ''));

    if v_phone_e164 = '' or v_country_code = '' then
      raise exception using errcode = '22023', message = pg_catalog.format('Contact at input position %s has an invalid phone number or country code.', input_index);
    end if;

    select contact.*
    into v_existing
    from public.contacts as contact
    where contact.workspace_id = p_workspace_id
      and contact.phone_e164 = v_phone_e164
    for update;

    if found and v_existing.deleted_at is null then
      contact_id := v_existing.id;
      action := 'duplicate';
    elsif found then
      update public.contacts
      set
        first_name = v_first_name,
        last_name = v_last_name,
        company = v_company,
        country_code = v_country_code,
        deleted_at = null
      where id = v_existing.id
      returning id into contact_id;
      action := 'restore';
    else
      insert into public.contacts (
        workspace_id,
        pipeline_stage_id,
        first_name,
        last_name,
        company,
        phone_e164,
        country_code
      )
      values (
        p_workspace_id,
        v_default_stage_id,
        v_first_name,
        v_last_name,
        v_company,
        v_phone_e164,
        v_country_code
      )
      returning id into contact_id;
      action := 'create';
    end if;

    select exists (
      select 1
      from public.suppressions as suppression
      where suppression.workspace_id = p_workspace_id
        and suppression.phone_e164 = v_phone_e164
    )
    into is_suppressed;

    return next;
  end loop;
end;
$$;
commit; 
