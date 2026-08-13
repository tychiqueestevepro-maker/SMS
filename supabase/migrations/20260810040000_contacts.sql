begin;

alter table public.pipeline_stages
  add constraint pipeline_stages_workspace_id_id_key
  unique (workspace_id, id);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  pipeline_stage_id uuid not null,
  first_name text not null default '',
  last_name text not null default '',
  company text not null default '',
  phone_e164 text not null,
  last_contacted_at timestamptz,
  last_replied_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_workspace_phone_e164_key
    unique (workspace_id, phone_e164),
  constraint contacts_workspace_pipeline_stage_fkey
    foreign key (workspace_id, pipeline_stage_id)
    references public.pipeline_stages (workspace_id, id)
    on delete restrict,
  constraint contacts_phone_e164_us_format check (
    phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  ),
  constraint contacts_first_name_trimmed check (
    first_name = btrim(first_name)
  ),
  constraint contacts_last_name_trimmed check (
    last_name = btrim(last_name)
  ),
  constraint contacts_company_trimmed check (
    company = btrim(company)
  )
);

create index contacts_workspace_active_created_idx
  on public.contacts (workspace_id, created_at desc)
  where deleted_at is null;

create index contacts_workspace_stage_active_idx
  on public.contacts (workspace_id, pipeline_stage_id, created_at desc)
  where deleted_at is null;

create index contacts_workspace_last_replied_idx
  on public.contacts (workspace_id, last_replied_at desc)
  where deleted_at is null and last_replied_at is not null;

create table public.suppressions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_e164 text not null,
  source text not null default 'opt_out',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, phone_e164),
  constraint suppressions_phone_e164_us_format check (
    phone_e164 ~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  ),
  constraint suppressions_source_not_blank check (
    source = btrim(source) and char_length(source) > 0
  )
);

create trigger contacts_touch_updated_at
before update on public.contacts
for each row execute function private.touch_updated_at();

create trigger suppressions_touch_updated_at
before update on public.suppressions
for each row execute function private.touch_updated_at();

create or replace function private.default_pipeline_stage_id(
  p_workspace_id uuid
)
returns uuid
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_stage_id uuid;
begin
  select stage.id
  into v_stage_id
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id
    and stage.is_default;

  if v_stage_id is null then
    raise exception using
      errcode = '23514',
      constraint = 'pipeline_stages_exactly_one_default',
      message = 'The workspace does not have a default pipeline stage.';
  end if;

  return v_stage_id;
end;
$$;

create or replace function private.assign_contact_pipeline_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pipeline_stage_id is null then
    new.pipeline_stage_id := private.default_pipeline_stage_id(
      new.workspace_id
    );
  end if;

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = new.pipeline_stage_id
      and stage.workspace_id = new.workspace_id
  ) then
    raise exception using
      errcode = '23503',
      constraint = 'contacts_workspace_pipeline_stage_fkey',
      message = 'The pipeline stage does not belong to this workspace.';
  end if;

  return new;
end;
$$;

create trigger contacts_assign_pipeline_stage
before insert or update of workspace_id, pipeline_stage_id
on public.contacts
for each row execute function private.assign_contact_pipeline_stage();

create or replace function public.create_contact(
  p_workspace_id uuid,
  p_phone_e164 text,
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
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace not found.';
  end if;

  if p_phone_e164 is null
    or p_phone_e164 !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid US phone number.';
  end if;

  if exists (
    select 1
    from public.contacts as contact
    where contact.workspace_id = p_workspace_id
      and contact.phone_e164 = p_phone_e164
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'contacts_workspace_phone_e164_key',
      message = 'A contact with this phone number already exists.';
  end if;

  v_stage_id := coalesce(
    p_pipeline_stage_id,
    private.default_pipeline_stage_id(p_workspace_id)
  );

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = v_stage_id
      and stage.workspace_id = p_workspace_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Pipeline stage not found.';
  end if;

  insert into public.contacts (
    workspace_id,
    pipeline_stage_id,
    first_name,
    last_name,
    company,
    phone_e164
  )
  values (
    p_workspace_id,
    v_stage_id,
    pg_catalog.btrim(coalesce(p_first_name, '')),
    pg_catalog.btrim(coalesce(p_last_name, '')),
    pg_catalog.btrim(coalesce(p_company, '')),
    p_phone_e164
  )
  returning * into v_contact;

  return v_contact;
end;
$$;

create or replace function public.update_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_company text,
  p_phone_e164 text,
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
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select contact.workspace_id
  into v_workspace_id
  from public.contacts as contact
  join public.workspaces as workspace
    on workspace.id = contact.workspace_id
  where contact.id = p_contact_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
    and contact.workspace_id = v_workspace_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  if v_contact.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'Deleted contacts are read-only.';
  end if;

  if p_phone_e164 is null
    or p_phone_e164 !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$'
  then
    raise exception using
      errcode = '22023',
      message = 'Enter a valid US phone number.';
  end if;

  v_stage_id := coalesce(p_pipeline_stage_id, v_contact.pipeline_stage_id);

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = v_stage_id
      and stage.workspace_id = v_workspace_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Pipeline stage not found.';
  end if;

  update public.contacts
  set
    first_name = pg_catalog.btrim(coalesce(p_first_name, '')),
    last_name = pg_catalog.btrim(coalesce(p_last_name, '')),
    company = pg_catalog.btrim(coalesce(p_company, '')),
    phone_e164 = p_phone_e164,
    pipeline_stage_id = v_stage_id
  where id = p_contact_id
  returning * into v_contact;

  return v_contact;
end;
$$;

create or replace function public.move_contact_to_stage(
  p_contact_id uuid,
  p_pipeline_stage_id uuid
)
returns public.contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select contact.workspace_id
  into v_workspace_id
  from public.contacts as contact
  join public.workspaces as workspace
    on workspace.id = contact.workspace_id
  where contact.id = p_contact_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  if v_contact.deleted_at is not null then
    raise exception using
      errcode = '55000',
      message = 'Deleted contacts are read-only.';
  end if;

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = p_pipeline_stage_id
      and stage.workspace_id = v_workspace_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Pipeline stage not found.';
  end if;

  update public.contacts
  set pipeline_stage_id = p_pipeline_stage_id
  where id = p_contact_id
  returning * into v_contact;

  return v_contact;
end;
$$;

create or replace function public.soft_delete_contact(
  p_contact_id uuid
)
returns public.contacts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact public.contacts;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select contact.workspace_id
  into v_workspace_id
  from public.contacts as contact
  join public.workspaces as workspace
    on workspace.id = contact.workspace_id
  where contact.id = p_contact_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  if v_contact.deleted_at is null then
    update public.contacts
    set deleted_at = pg_catalog.now()
    where id = p_contact_id
    returning * into v_contact;
  end if;

  return v_contact;
end;
$$;

create or replace function public.restore_contact(
  p_contact_id uuid,
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
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select contact.workspace_id
  into v_workspace_id
  from public.contacts as contact
  join public.workspaces as workspace
    on workspace.id = contact.workspace_id
  where contact.id = p_contact_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  select contact.*
  into v_contact
  from public.contacts as contact
  where contact.id = p_contact_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Contact not found.';
  end if;

  if v_contact.deleted_at is null then
    return v_contact;
  end if;

  v_stage_id := coalesce(
    p_pipeline_stage_id,
    v_contact.pipeline_stage_id
  );

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.id = v_stage_id
      and stage.workspace_id = v_workspace_id
  ) then
    raise exception using
      errcode = '23503',
      message = 'Pipeline stage not found.';
  end if;

  update public.contacts
  set
    pipeline_stage_id = v_stage_id,
    deleted_at = null
  where id = p_contact_id
  returning * into v_contact;

  return v_contact;
end;
$$;

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
  v_first_name text;
  v_last_name text;
  v_company text;
  v_default_stage_id uuid;
  v_existing public.contacts;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace not found.';
  end if;

  if p_contacts is null or pg_catalog.jsonb_typeof(p_contacts) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Contacts must be provided as an array.';
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
      raise exception using
        errcode = '22023',
        message = pg_catalog.format(
          'Contact at input position %s is invalid.',
          input_index
        );
    end if;

    v_phone_e164 := pg_catalog.btrim(
      coalesce(v_value ->> 'phone_e164', v_value ->> 'phoneE164', '')
    );
    v_first_name := pg_catalog.btrim(
      coalesce(v_value ->> 'first_name', v_value ->> 'firstName', '')
    );
    v_last_name := pg_catalog.btrim(
      coalesce(v_value ->> 'last_name', v_value ->> 'lastName', '')
    );
    v_company := pg_catalog.btrim(coalesce(v_value ->> 'company', ''));

    if v_phone_e164 !~ '^[+]1[2-9][0-9]{2}[2-9][0-9]{6}$' then
      raise exception using
        errcode = '22023',
        message = pg_catalog.format(
          'Contact at input position %s has an invalid US phone number.',
          input_index
        );
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
        phone_e164
      )
      values (
        p_workspace_id,
        v_default_stage_id,
        v_first_name,
        v_last_name,
        v_company,
        v_phone_e164
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

create or replace function public.create_pipeline_stage(
  p_workspace_id uuid,
  p_name text
)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_position integer;
  v_stage public.pipeline_stages;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Workspace not found.';
  end if;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Stage name is required.';
  end if;

  select coalesce(max(stage.position), -1) + 1
  into v_position
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id;

  insert into public.pipeline_stages (
    workspace_id,
    name,
    position,
    is_default
  )
  values (
    p_workspace_id,
    v_name,
    v_position,
    false
  )
  returning * into v_stage;

  return v_stage;
end;
$$;

create or replace function public.rename_pipeline_stage(
  p_stage_id uuid,
  p_name text
)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_stage public.pipeline_stages;
  v_workspace_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select stage.workspace_id
  into v_workspace_id
  from public.pipeline_stages as stage
  join public.workspaces as workspace
    on workspace.id = stage.workspace_id
  where stage.id = p_stage_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Pipeline stage not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  v_name := pg_catalog.btrim(coalesce(p_name, ''));
  if v_name = '' then
    raise exception using
      errcode = '22023',
      message = 'Stage name is required.';
  end if;

  update public.pipeline_stages
  set name = v_name
  where id = p_stage_id
    and workspace_id = v_workspace_id
  returning * into v_stage;

  return v_stage;
end;
$$;

create or replace function public.delete_pipeline_stage(
  p_stage_id uuid,
  p_reassign_to_stage_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_count integer;
  v_stage_count integer;
  v_stage_position integer;
  v_workspace_id uuid;
  v_is_default boolean;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  select stage.workspace_id
  into v_workspace_id
  from public.pipeline_stages as stage
  join public.workspaces as workspace
    on workspace.id = stage.workspace_id
  where stage.id = p_stage_id
    and workspace.owner_id = (select auth.uid());

  if v_workspace_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'Pipeline stage not found.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = v_workspace_id
    and workspace.owner_id = (select auth.uid())
  for update;

  perform 1
  from public.pipeline_stages as stage
  where stage.workspace_id = v_workspace_id
  order by stage.id
  for update;

  select stage.position, stage.is_default
  into v_stage_position, v_is_default
  from public.pipeline_stages as stage
  where stage.id = p_stage_id
    and stage.workspace_id = v_workspace_id;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'Pipeline stage not found.';
  end if;

  select count(*)::integer
  into v_stage_count
  from public.pipeline_stages as stage
  where stage.workspace_id = v_workspace_id;

  if v_stage_count <= 1 then
    raise exception using
      errcode = '55000',
      message = 'The last pipeline stage cannot be deleted.';
  end if;

  if v_is_default then
    raise exception using
      errcode = '55000',
      message = 'Choose another default stage before deleting this stage.';
  end if;

  select count(*)::integer
  into v_contact_count
  from public.contacts as contact
  where contact.workspace_id = v_workspace_id
    and contact.pipeline_stage_id = p_stage_id;

  if v_contact_count > 0 and p_reassign_to_stage_id is null then
    raise exception using
      errcode = '23503',
      message = 'Choose a destination stage for the contacts in this stage.';
  end if;

  if p_reassign_to_stage_id is not null then
    if p_reassign_to_stage_id = p_stage_id
      or not exists (
        select 1
        from public.pipeline_stages as destination
        where destination.id = p_reassign_to_stage_id
          and destination.workspace_id = v_workspace_id
      )
    then
      raise exception using
        errcode = '23503',
        message = 'Destination stage not found.';
    end if;
  end if;

  if v_contact_count > 0 then
    update public.contacts
    set pipeline_stage_id = p_reassign_to_stage_id
    where workspace_id = v_workspace_id
      and pipeline_stage_id = p_stage_id;
  end if;

  delete from public.pipeline_stages
  where id = p_stage_id
    and workspace_id = v_workspace_id;

  update public.pipeline_stages
  set position = position - 1
  where workspace_id = v_workspace_id
    and position > v_stage_position;

  return p_stage_id;
end;
$$;

alter table public.contacts enable row level security;
alter table public.suppressions enable row level security;

create policy contacts_owner_read
on public.contacts
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = contacts.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

create policy suppressions_owner_read
on public.suppressions
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = suppressions.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

revoke all on table public.contacts from anon, authenticated;
revoke all on table public.suppressions from anon, authenticated;
grant select on table public.contacts to authenticated;
grant select on table public.suppressions to authenticated;

revoke all on function public.create_contact(uuid, text, text, text, text, uuid)
  from public, anon;
revoke all on function public.update_contact(uuid, text, text, text, text, uuid)
  from public, anon;
revoke all on function public.move_contact_to_stage(uuid, uuid)
  from public, anon;
revoke all on function public.soft_delete_contact(uuid)
  from public, anon;
revoke all on function public.restore_contact(uuid, uuid)
  from public, anon;
revoke all on function public.bulk_upsert_contacts(uuid, jsonb)
  from public, anon;
revoke all on function public.create_pipeline_stage(uuid, text)
  from public, anon;
revoke all on function public.rename_pipeline_stage(uuid, text)
  from public, anon;
revoke all on function public.delete_pipeline_stage(uuid, uuid)
  from public, anon;

grant execute on function public.create_contact(uuid, text, text, text, text, uuid)
  to authenticated;
grant execute on function public.update_contact(uuid, text, text, text, text, uuid)
  to authenticated;
grant execute on function public.move_contact_to_stage(uuid, uuid)
  to authenticated;
grant execute on function public.soft_delete_contact(uuid)
  to authenticated;
grant execute on function public.restore_contact(uuid, uuid)
  to authenticated;
grant execute on function public.bulk_upsert_contacts(uuid, jsonb)
  to authenticated;
grant execute on function public.create_pipeline_stage(uuid, text)
  to authenticated;
grant execute on function public.rename_pipeline_stage(uuid, text)
  to authenticated;
grant execute on function public.delete_pipeline_stage(uuid, uuid)
  to authenticated;

revoke all on all functions in schema private
  from public, anon, authenticated;

comment on table public.contacts is
  'Workspace contacts retained across soft deletion for messaging history.';
comment on constraint contacts_workspace_phone_e164_key on public.contacts is
  'Permanent phone uniqueness includes soft-deleted contacts.';
comment on table public.suppressions is
  'Active workspace opt-outs keyed independently by phone number.';
comment on function public.bulk_upsert_contacts(uuid, jsonb) is
  'CSV-oriented import: creates new contacts, restores deleted contacts, and skips active duplicates without clearing suppressions.';
comment on function public.delete_pipeline_stage(uuid, uuid) is
  'Deletes a non-default, non-final stage and transactionally reassigns all contacts when required.';

commit;
