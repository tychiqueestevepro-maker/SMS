begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(21);

select has_table('public', 'contacts', 'contacts exists');
select has_table('public', 'suppressions', 'suppressions exists');
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.contacts'::regclass
      and constraint_row.conname = 'contacts_phone_e164_valid'
  ),
  'contacts enforce international E.164 phone format'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.suppressions'::regclass
      and constraint_row.conname = 'suppressions_phone_e164_valid'
  ),
  'suppressions enforce international E.164 phone format'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.contacts'::regclass
      and constraint_row.conname = 'contacts_workspace_phone_e164_key'
      and constraint_row.contype = 'u'
  ),
  'workspace and phone remain permanently unique across soft deletes'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.contacts'::regclass
      and constraint_row.conname = 'contacts_workspace_pipeline_stage_fkey'
      and constraint_row.contype = 'f'
  ),
  'contact pipeline stages are constrained to the same workspace'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname = 'contacts_assign_pipeline_stage'
  ),
  'new contacts receive a pipeline stage through the default-stage trigger'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'contacts'
      and policyname = 'contacts_owner_read'
  ),
  'contacts have owner-scoped read RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'suppressions'
      and policyname = 'suppressions_owner_read'
  ),
  'suppressions have owner-scoped read RLS'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.contacts', 'INSERT'),
  'authenticated users cannot insert contacts directly'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.contacts', 'UPDATE'),
  'authenticated users cannot update contacts directly'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.contacts', 'DELETE'),
  'authenticated users cannot delete contacts directly'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.suppressions', 'INSERT'),
  'authenticated users cannot insert suppressions directly'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.suppressions', 'UPDATE'),
  'authenticated users cannot update suppressions directly'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'public.suppressions', 'DELETE'),
  'authenticated users cannot delete suppressions directly'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.bulk_upsert_contacts(uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated users can execute CSV bulk upsert'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.soft_delete_contact(uuid)',
    'EXECUTE'
  ),
  'authenticated users can soft-delete through the safe RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.restore_contact(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users can restore through the safe RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.delete_pipeline_stage(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated users can delete eligible stages through the safe RPC'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.create_contact(uuid,text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous users cannot create contacts'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.bulk_upsert_contacts(uuid,jsonb)',
    'EXECUTE'
  ),
  'anonymous users cannot execute CSV bulk upsert'
);

select * from finish();

rollback;
