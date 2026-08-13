begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null,
  included_segments integer not null,
  overage_price_micro_usd bigint not null,
  max_phone_numbers integer not null,
  safety_cap_segments integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plans_code_not_blank check (
    code = btrim(code) and char_length(code) > 0
  ),
  constraint billing_plans_name_not_blank check (
    name = btrim(name) and char_length(name) > 0
  ),
  constraint billing_plans_monthly_price_nonnegative check (
    monthly_price_cents >= 0
  ),
  constraint billing_plans_included_segments_nonnegative check (
    included_segments >= 0
  ),
  constraint billing_plans_overage_price_nonnegative check (
    overage_price_micro_usd >= 0
  ),
  constraint billing_plans_phone_limit_positive check (
    max_phone_numbers > 0
  ),
  constraint billing_plans_safety_cap_valid check (
    safety_cap_segments >= included_segments
  )
);

insert into public.billing_plans (
  code,
  name,
  monthly_price_cents,
  included_segments,
  overage_price_micro_usd,
  max_phone_numbers,
  safety_cap_segments
)
values (
  'riink-v1',
  'Riink',
  8999,
  2000,
  40000,
  3,
  10000
)
on conflict (code) do update
set
  name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  included_segments = excluded.included_segments,
  overage_price_micro_usd = excluded.overage_price_micro_usd,
  max_phone_numbers = excluded.max_phone_numbers,
  safety_cap_segments = excluded.safety_cap_segments,
  is_active = true,
  updated_at = now();

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_not_blank check (
    email is null or char_length(btrim(email)) > 0
  ),
  constraint profiles_display_name_not_blank check (
    display_name is null or char_length(btrim(display_name)) > 0
  )
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles (id) on delete cascade,
  billing_plan_id uuid not null references public.billing_plans (id) on delete restrict,
  name text not null default 'My workspace',
  timezone text not null default 'America/New_York',
  send_window_start time without time zone not null default time '09:00:00',
  send_window_end time without time zone not null default time '20:00:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (
    name = btrim(name) and char_length(name) > 0
  ),
  constraint workspaces_send_window_ordered check (
    send_window_start < send_window_end
  )
);

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  position integer not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipeline_stages_name_not_blank check (
    name = btrim(name) and char_length(name) > 0
  ),
  constraint pipeline_stages_position_nonnegative check (position >= 0),
  constraint pipeline_stages_workspace_position_key
    unique (workspace_id, position)
    deferrable initially deferred
);

create unique index pipeline_stages_workspace_name_key
  on public.pipeline_stages (workspace_id, lower(name));

create unique index pipeline_stages_one_default_per_workspace
  on public.pipeline_stages (workspace_id)
  where is_default;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger billing_plans_touch_updated_at
before update on public.billing_plans
for each row execute function private.touch_updated_at();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create trigger workspaces_touch_updated_at
before update on public.workspaces
for each row execute function private.touch_updated_at();

create trigger pipeline_stages_touch_updated_at
before update on public.pipeline_stages
for each row execute function private.touch_updated_at();

create or replace function private.validate_workspace_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as timezone_name
    where timezone_name.name = new.timezone
  ) then
    raise exception using
      errcode = '22023',
      message = 'Invalid workspace timezone.';
  end if;

  return new;
end;
$$;

create trigger workspaces_validate_timezone
before insert or update of timezone on public.workspaces
for each row execute function private.validate_workspace_timezone();

create or replace function private.initialize_workspace_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pipeline_stages (
    workspace_id,
    name,
    position,
    is_default
  )
  values (
    new.id,
    'New',
    0,
    true
  );

  return new;
end;
$$;

create trigger workspaces_initialize_pipeline
after insert on public.workspaces
for each row execute function private.initialize_workspace_pipeline();

create or replace function private.assert_workspace_has_one_default_stage(
  p_workspace_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_default_count integer;
begin
  if not exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = p_workspace_id
  ) then
    return;
  end if;

  select count(*)::integer
  into v_default_count
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id
    and stage.is_default;

  if v_default_count <> 1 then
    raise exception using
      errcode = '23514',
      constraint = 'pipeline_stages_exactly_one_default',
      message = 'A workspace must have exactly one default pipeline stage.';
  end if;
end;
$$;

create or replace function private.enforce_workspace_default_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_workspace_has_one_default_stage(new.id);
  return new;
end;
$$;

create constraint trigger workspaces_require_default_stage
after insert on public.workspaces
deferrable initially deferred
for each row execute function private.enforce_workspace_default_stage();

create or replace function private.enforce_pipeline_default_stage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.assert_workspace_has_one_default_stage(old.workspace_id);
    return old;
  end if;

  perform private.assert_workspace_has_one_default_stage(new.workspace_id);

  if tg_op = 'UPDATE'
    and old.workspace_id is distinct from new.workspace_id
  then
    perform private.assert_workspace_has_one_default_stage(old.workspace_id);
  end if;

  return new;
end;
$$;

create constraint trigger pipeline_stages_require_exactly_one_default
after insert or delete or update of workspace_id, is_default
on public.pipeline_stages
deferrable initially deferred
for each row execute function private.enforce_pipeline_default_stage();

create or replace function private.provision_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_billing_plan_id uuid;
  v_workspace_id uuid;
  v_display_name text;
  v_workspace_name text;
begin
  if new.email_confirmed_at is null then
    return new;
  end if;

  v_display_name := nullif(
    pg_catalog.btrim(
      coalesce(new.raw_user_meta_data ->> 'full_name', '')
    ),
    ''
  );

  v_workspace_name := nullif(
    pg_catalog.btrim(
      coalesce(new.raw_user_meta_data ->> 'workspace_name', '')
    ),
    ''
  );

  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, v_display_name)
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = coalesce(
      public.profiles.display_name,
      excluded.display_name
    );

  select plan.id
  into v_billing_plan_id
  from public.billing_plans as plan
  where plan.code = 'riink-v1'
    and plan.is_active;

  if v_billing_plan_id is null then
    raise exception using
      errcode = '23514',
      message = 'The active Riink billing plan is missing.';
  end if;

  insert into public.workspaces (
    owner_id,
    billing_plan_id,
    name
  )
  values (
    new.id,
    v_billing_plan_id,
    coalesce(v_workspace_name, 'My workspace')
  )
  on conflict (owner_id) do nothing;

  select workspace.id
  into v_workspace_id
  from public.workspaces as workspace
  where workspace.owner_id = new.id;

  if not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.workspace_id = v_workspace_id
  ) then
    insert into public.pipeline_stages (
      workspace_id,
      name,
      position,
      is_default
    )
    values (
      v_workspace_id,
      'New',
      0,
      true
    );
  elsif not exists (
    select 1
    from public.pipeline_stages as stage
    where stage.workspace_id = v_workspace_id
      and stage.is_default
  ) then
    update public.pipeline_stages
    set is_default = true
    where id = (
      select stage.id
      from public.pipeline_stages as stage
      where stage.workspace_id = v_workspace_id
      order by stage.position, stage.id
      limit 1
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_provisioned on auth.users;
create trigger on_auth_user_provisioned
after insert or update of email_confirmed_at, email on auth.users
for each row execute function private.provision_confirmed_user();

insert into public.profiles (id, email, display_name)
select
  auth_user.id,
  auth_user.email,
  nullif(btrim(coalesce(auth_user.raw_user_meta_data ->> 'full_name', '')), '')
from auth.users as auth_user
where auth_user.email_confirmed_at is not null
on conflict (id) do nothing;

insert into public.workspaces (owner_id, billing_plan_id, name)
select
  profile.id,
  plan.id,
  coalesce(
    nullif(
      btrim(coalesce(auth_user.raw_user_meta_data ->> 'workspace_name', '')),
      ''
    ),
    'My workspace'
  )
from public.profiles as profile
join auth.users as auth_user on auth_user.id = profile.id
cross join public.billing_plans as plan
where plan.code = 'riink-v1'
  and plan.is_active
on conflict (owner_id) do nothing;

insert into public.pipeline_stages (
  workspace_id,
  name,
  position,
  is_default
)
select
  workspace.id,
  'New',
  0,
  true
from public.workspaces as workspace
where not exists (
  select 1
  from public.pipeline_stages as stage
  where stage.workspace_id = workspace.id
);

create or replace function public.set_default_pipeline_stage(
  p_stage_id uuid
)
returns public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_stage public.pipeline_stages;
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
  for update;

  update public.pipeline_stages
  set is_default = false
  where workspace_id = v_workspace_id
    and is_default
    and id <> p_stage_id;

  update public.pipeline_stages
  set is_default = true
  where id = p_stage_id
  returning * into v_stage;

  return v_stage;
end;
$$;

create or replace function public.reorder_pipeline_stages(
  p_workspace_id uuid,
  p_stage_ids uuid[]
)
returns setof public.pipeline_stages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
  v_distinct_count integer;
begin
  if (select auth.uid()) is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication required.';
  end if;

  if p_stage_ids is null
    or pg_catalog.cardinality(p_stage_ids) = 0
    or pg_catalog.array_position(p_stage_ids, null::uuid) is not null
  then
    raise exception using
      errcode = '22023',
      message = 'A complete stage order is required.';
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

  perform 1
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id
  order by stage.id
  for update;

  select count(*)::integer
  into v_expected_count
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id;

  select count(distinct requested.stage_id)::integer
  into v_distinct_count
  from pg_catalog.unnest(p_stage_ids) as requested(stage_id);

  if pg_catalog.cardinality(p_stage_ids) <> v_expected_count
    or v_distinct_count <> v_expected_count
    or (
      select count(*)::integer
      from public.pipeline_stages as stage
      where stage.workspace_id = p_workspace_id
        and stage.id = any(p_stage_ids)
    ) <> v_expected_count
  then
    raise exception using
      errcode = '22023',
      message = 'The stage order must contain every workspace stage exactly once.';
  end if;

  with requested_order as (
    select
      requested.stage_id,
      (requested.ordinality - 1)::integer as position
    from pg_catalog.unnest(p_stage_ids)
      with ordinality as requested(stage_id, ordinality)
  )
  update public.pipeline_stages as stage
  set position = requested_order.position
  from requested_order
  where stage.id = requested_order.stage_id
    and stage.workspace_id = p_workspace_id;

  return query
  select stage.*
  from public.pipeline_stages as stage
  where stage.workspace_id = p_workspace_id
  order by stage.position;
end;
$$;

-- Existing confirmed Auth users are backfilled above. Flush the deferred
-- one-default-stage checks before altering those tables to enable RLS.
set constraints all immediate;

alter table public.billing_plans enable row level security;
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.pipeline_stages enable row level security;

create policy billing_plans_authenticated_read
on public.billing_plans
for select
to authenticated
using (true);

create policy profiles_owner_read
on public.profiles
for select
to authenticated
using (id = (select auth.uid()));

create policy profiles_owner_update
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy workspaces_owner_read
on public.workspaces
for select
to authenticated
using (owner_id = (select auth.uid()));

create policy workspaces_owner_update
on public.workspaces
for update
to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy pipeline_stages_owner_read
on public.pipeline_stages
for select
to authenticated
using (
  exists (
    select 1
    from public.workspaces as workspace
    where workspace.id = pipeline_stages.workspace_id
      and workspace.owner_id = (select auth.uid())
  )
);

revoke all on table public.billing_plans from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.pipeline_stages from anon, authenticated;

grant select on table public.billing_plans to authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.workspaces to authenticated;
grant update (
  name,
  timezone,
  send_window_start,
  send_window_end
) on table public.workspaces to authenticated;
grant select on table public.pipeline_stages to authenticated;

revoke all on function public.set_default_pipeline_stage(uuid)
  from public, anon;
revoke all on function public.reorder_pipeline_stages(uuid, uuid[])
  from public, anon;
grant execute on function public.set_default_pipeline_stage(uuid)
  to authenticated;
grant execute on function public.reorder_pipeline_stages(uuid, uuid[])
  to authenticated;

revoke all on all functions in schema private
  from public, anon, authenticated;

comment on table public.billing_plans is
  'Central source for customer pricing and usage limits.';
comment on column public.billing_plans.included_segments is
  'Backend SMS segments included per Stripe billing period; exposed as SMS credits.';
comment on column public.billing_plans.overage_price_micro_usd is
  'Customer price in micro-USD for each additional outbound segment.';
comment on column public.billing_plans.safety_cap_segments is
  'Outbound safety cap, distinct from included usage.';
comment on column public.pipeline_stages.is_default is
  'Exactly one stage per workspace receives new contacts.';
comment on function public.set_default_pipeline_stage(uuid) is
  'Atomically changes the default stage for the caller workspace.';
comment on function public.reorder_pipeline_stages(uuid, uuid[]) is
  'Atomically applies a complete stage order without changing the default stage.';

commit;
