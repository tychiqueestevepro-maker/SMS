begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(19);

select has_table('public', 'billing_plans', 'billing_plans exists');
select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'workspaces', 'workspaces exists');
select has_table('public', 'pipeline_stages', 'pipeline_stages exists');

select is(
  (select monthly_price_cents from public.billing_plans where code = 'riink-v1'),
  8999,
  'Riink V1 monthly price is seeded centrally'
);
select is(
  (select included_segments from public.billing_plans where code = 'riink-v1'),
  2000,
  'Riink V1 includes 2,000 outbound segments'
);
select is(
  (select overage_price_micro_usd from public.billing_plans where code = 'riink-v1'),
  40000::bigint,
  'Riink V1 overage price is 40,000 micro-USD'
);
select is(
  (select max_phone_numbers from public.billing_plans where code = 'riink-v1'),
  6,
  'Riink V1 includes three Riink numbers and three imported numbers'
);
select is(
  (select safety_cap_segments from public.billing_plans where code = 'riink-v1'),
  10000,
  'Riink V1 safety cap is 10,000 outbound segments'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'pipeline_stages_one_default_per_workspace'
      and indexdef like '%WHERE is_default%'
  ),
  'partial unique default-stage index exists'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'pipeline_stages_require_exactly_one_default'
      and tgdeferrable
      and tginitdeferred
  ),
  'pipeline exact-one trigger is deferred'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'workspaces_initialize_pipeline'
  ),
  'workspace pipeline initializer exists'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'workspaces_require_default_stage'
      and tgdeferrable
      and tginitdeferred
  ),
  'workspace default-stage check is deferred'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'workspaces'
      and policyname = 'workspaces_owner_read'
  ),
  'workspace owner read policy exists'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.pipeline_stages',
    'UPDATE'
  ),
  'authenticated users cannot update stages directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.set_default_pipeline_stage(uuid)',
    'EXECUTE'
  ),
  'authenticated users can set the default stage through the safe RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.reorder_pipeline_stages(uuid,uuid[])',
    'EXECUTE'
  ),
  'authenticated users can reorder stages through the safe RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.set_default_pipeline_stage(uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot set the default stage'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.reorder_pipeline_stages(uuid,uuid[])',
    'EXECUTE'
  ),
  'anonymous users cannot reorder stages'
);

select * from finish();

rollback;
