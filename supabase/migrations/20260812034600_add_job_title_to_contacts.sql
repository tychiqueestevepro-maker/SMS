ALTER TABLE contacts ADD COLUMN job_title text;

-- Update create_contact to include job_title
create or replace function public.create_contact(
  p_workspace_id uuid,
  p_phone_e164 text,
  p_country_code text,
  p_first_name text default '',
  p_last_name text default '',
  p_company text default '',
  p_job_title text default '',
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
    job_title,
    phone_e164,
    country_code
  )
  values (
    p_workspace_id,
    v_stage_id,
    pg_catalog.btrim(coalesce(p_first_name, '')),
    pg_catalog.btrim(coalesce(p_last_name, '')),
    pg_catalog.btrim(coalesce(p_company, '')),
    pg_catalog.btrim(coalesce(p_job_title, '')),
    p_phone_e164,
    p_country_code
  )
  returning * into v_contact;

  return v_contact;
end;
$$;

-- Update update_contact to include job_title
create or replace function public.update_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_company text,
  p_job_title text,
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
  for update;

  if p_phone_e164 is null or p_country_code is null then
    raise exception using errcode = '22023', message = 'Enter a valid phone number and country code.';
  end if;

  if exists (
    select 1
    from public.contacts as contact
    where contact.workspace_id = v_workspace_id
      and contact.phone_e164 = p_phone_e164
      and contact.id != p_contact_id
  ) then
    raise exception using errcode = '23505', constraint = 'contacts_workspace_phone_e164_key', message = 'A contact with this phone number already exists.';
  end if;

  if p_pipeline_stage_id is not null then
    if not exists (
      select 1
      from public.pipeline_stages as stage
      where stage.id = p_pipeline_stage_id
        and stage.workspace_id = v_workspace_id
    ) then
      raise exception using errcode = '23503', message = 'Pipeline stage not found.';
    end if;
    v_stage_id := p_pipeline_stage_id;
  else
    v_stage_id := v_contact.pipeline_stage_id;
  end if;

  update public.contacts
  set
    first_name = pg_catalog.btrim(coalesce(p_first_name, '')),
    last_name = pg_catalog.btrim(coalesce(p_last_name, '')),
    company = pg_catalog.btrim(coalesce(p_company, '')),
    job_title = pg_catalog.btrim(coalesce(p_job_title, '')),
    phone_e164 = p_phone_e164,
    country_code = p_country_code,
    pipeline_stage_id = v_stage_id,
    updated_at = now()
  where id = p_contact_id
  returning * into v_contact;

  return v_contact;
end;
$$;

-- Update bulk_upsert_contacts to include job_title
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
  v_job_title text;
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
    v_job_title := pg_catalog.btrim(coalesce(v_value ->> 'job_title', v_value ->> 'jobTitle', ''));

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
        job_title = v_job_title,
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
        job_title,
        phone_e164,
        country_code
      )
      values (
        p_workspace_id,
        v_default_stage_id,
        v_first_name,
        v_last_name,
        v_company,
        v_job_title,
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