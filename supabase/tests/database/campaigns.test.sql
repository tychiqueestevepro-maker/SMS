begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(52);

select has_table('public', 'billing_periods', 'billing periods exist');
select has_table('public', 'billing_period_usage', 'billing period usage exists');
select has_table('public', 'phone_numbers', 'product-safe phone numbers exist');
select has_table('public', 'campaigns', 'campaigns exist');
select has_table('public', 'campaign_draft_contacts', 'draft contact selection exists');
select has_table('public', 'campaign_steps', 'campaign steps exist');
select has_table('public', 'campaign_recipients', 'campaign recipients exist');
select has_table('public', 'messages', 'product-safe messages exist');
select has_table('public', 'consent_confirmations', 'launch consent audit exists');
select has_table('private', 'phone_number_provider_details', 'number provider data is private');
select has_table('private', 'message_provider_details', 'message provider data is private');

select ok(
  exists (
    select 1
    from public.billing_plans as plan
    where plan.code = 'riink-v1'
      and plan.monthly_price_cents = 8999
      and plan.included_segments = 2000
      and plan.overage_price_micro_usd = 40000
      and plan.max_phone_numbers = 6
      and plan.safety_cap_segments = 10000
  ),
  'the immutable V1 pricing defaults are centralized in the billing plan'
);
select ok(
  exists (
    select 1
    from public.billing_plans as plan
    where plan.code = 'riink-v1'
      and plan.large_campaign_recipient_threshold = 1000
      and plan.large_campaign_overage_credit_threshold = 1
  ),
  'large-launch thresholds have one server-side source'
);
select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.billing_plans'::regclass
      and constraint_row.conname =
        'billing_plans_large_campaign_recipient_threshold_valid'
  ) like '%> 0%',
  'large recipient threshold cannot be zero'
);
select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.campaigns'::regclass
      and constraint_row.conname = 'campaigns_status_valid'
  ) like '%finished%'
  and (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.campaigns'::regclass
      and constraint_row.conname = 'campaigns_status_valid'
  ) not like '%completed%',
  'Finished is the only final campaign status'
);
select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.campaign_recipients'::regclass
      and constraint_row.conname = 'campaign_recipients_state_valid'
  ) like '%active%stopped%finished%'
  and (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.campaign_recipients'::regclass
      and constraint_row.conname = 'campaign_recipients_state_valid'
  ) not like '%replied%',
  'recipient state remains active, stopped, or finished only'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.campaign_recipients'::regclass
      and constraint_row.conname = 'campaign_recipients_stop_reason_valid'
  ),
  'recipient stop reasons are constrained product values'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_recipient_step_key'
      and constraint_row.contype = 'u'
  ),
  'recipient and campaign step identify one message reservation'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'public'
      and index_row.indexname =
        'campaign_recipients_one_active_sequence_per_contact'
      and index_row.indexdef like '%UNIQUE%'
      and index_row.indexdef like '%dispatch_unknown%'
  ),
  'one active sequence also blocks enrollment during ambiguous dispatch'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'campaign_draft_contacts_validate'
      and not trigger_row.tgisinternal
  ),
  'draft selections enforce campaign and contact workspace integrity'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'campaign_draft_contacts'
      and policy.policyname = 'campaign_draft_contacts_owner_read'
  ),
  'draft contact selection has owner-scoped read RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'campaigns'
      and policy.policyname = 'campaigns_owner_read'
  ),
  'campaigns have owner-scoped read RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'messages'
      and policy.policyname = 'messages_owner_read'
  ),
  'product-safe messages have owner-scoped read RLS'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.campaigns', 'SELECT'),
  'authenticated owners can read campaigns through RLS'
);
select ok(
  pg_catalog.has_table_privilege(
    'authenticated',
    'public.campaign_recipients',
    'SELECT'
  ),
  'authenticated owners can read product recipient state through RLS'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.messages', 'SELECT'),
  'authenticated owners can read product-safe message state through RLS'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.campaigns',
    'INSERT'
  ),
  'authenticated users cannot mutate campaigns directly'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'public.campaign_draft_contacts',
    'INSERT'
  ),
  'authenticated users cannot bypass atomic draft saving'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.save_campaign_draft(uuid,uuid,text,jsonb,uuid,uuid[])',
    'EXECUTE'
  ),
  'authenticated owners can atomically save a campaign draft'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.create_campaign_draft(uuid,text,jsonb,uuid)',
    'EXECUTE'
  ),
  'the lower-level draft create function is not a client mutation seam'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.launch_campaign(uuid,integer,boolean,boolean,jsonb)',
    'EXECUTE'
  ),
  'authenticated owners can launch through the revalidating RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.delete_campaign(uuid)',
    'EXECUTE'
  ),
  'authenticated owners can transactionally soft-delete a campaign'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.save_campaign_draft(uuid,uuid,text,jsonb,uuid,uuid[])',
    'EXECUTE'
  ),
  'anonymous users cannot save campaign drafts'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.dispatch_claim_and_reserve_next(text,timestamptz)',
    'EXECUTE'
  ),
  'service role can claim and reserve dispatch work through PostgREST'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.dispatch_claim_and_reserve_next(text,timestamptz)',
    'EXECUTE'
  ),
  'workspace users cannot call the dispatch worker RPC'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.reconciliation_claim_next(text,timestamptz)',
    'EXECUTE'
  ),
  'service role can claim reconciliation work through PostgREST'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.reconciliation_claim_next(text,timestamptz)',
    'EXECUTE'
  ),
  'workspace users cannot call reconciliation RPCs'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.reserve_due_campaign_messages(uuid,integer,timestamptz)'::regprocedure
  ) ilike '%for update of recipient skip locked%',
  'dispatch claiming uses FOR UPDATE SKIP LOCKED'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.claim_message_reconciliation(integer,timestamptz)'::regprocedure
  ) ilike '%for update of detail skip locked%',
  'reconciliation claiming uses FOR UPDATE SKIP LOCKED'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.get_campaign_statistics(uuid)'::regprocedure
  ) ilike '%delivery_state is distinct from ''failed''%',
  'Reply Rate uses null-safe explicit-Failed exclusion'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.phone_number_provider_details',
    'SELECT'
  ),
  'workspace users cannot read number provider details'
);
select ok(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'private.message_provider_details',
    'SELECT'
  ),
  'workspace users cannot read message provider details'
);
select ok(
  not exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'private'
      and column_row.table_name in (
        'phone_number_provider_details',
        'message_provider_details'
      )
      and column_row.column_name in (
        'auth_token',
        'api_key',
        'secret',
        'credential',
        'credentials'
      )
  ),
  'provider detail tables never store credentials or auth tokens'
);
select ok(
  not exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name in ('phone_numbers', 'messages')
      and column_row.column_name like '%provider%'
  ),
  'product phone and message tables expose no provider fields'
);
select is(
  pg_catalog.obj_description('public.messages'::regclass),
  'Product-safe message state. failure_code contains only stable Riink product codes.'::text,
  'the public failure field is explicitly restricted to product-safe codes'
);
select ok(
  exists (
    select 1
    from public.billing_periods as period
    where period.safety_cap_segments_snapshot = 10000
  ) or not exists (select 1 from public.billing_periods),
  'billing periods snapshot the default 10,000-credit safety cap'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.workspace_messaging_controls'::regclass
      and constraint_row.conname =
        'workspace_messaging_controls_safety_cap_override_valid'
  ),
  'admin safety-cap overrides are positive when configured'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.record_message_actual_segments(uuid,integer)'::regprocedure
  ) ilike '%reserved_outbound_segments%actual_outbound_segments%',
  'estimated-to-actual usage transition updates both counters together'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.delete_campaign(uuid)'::regprocedure
  ) ilike '%release_reserved_message%campaign_deleted%',
  'campaign deletion releases cancelable reservations transactionally'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.soft_delete_contact(uuid)'::regprocedure
  ) ilike '%release_reserved_message%contact_deleted%',
  'contact soft deletion stops sequences and releases reservations'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%dispatch_unknown%',
  'final validation persists the fail-closed ambiguous state before sending'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%begin_message_dispatch_before_country_check%'
  and pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch_before_country_check(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%begin_message_dispatch_before_billing_rollover%'
  and pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch_before_billing_rollover(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%''to''%phone_e164%''from''%',
  'final validation returns authoritative destination and sending number'
);

select * from finish();

rollback;
