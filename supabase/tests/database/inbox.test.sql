begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(44);

select has_column('public', 'messages', 'received_at', 'messages expose inbound occurrence time');
select has_column('public', 'messages', 'in_reply_to_message_id', 'inbound replies use a separate association');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_in_reply_to_fkey'
      and constraint_row.contype = 'f'
  ),
  'reply association is referentially constrained'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_body_valid'
  ),
  'outbound bodies remain nonempty while signed inbound events can be empty'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'public.messages'::regclass
      and constraint_row.conname = 'messages_recipient_step_key'
      and constraint_row.contype = 'u'
  ),
  'inbound association did not weaken outbound recipient-step uniqueness'
);
select has_table('private', 'webhook_events', 'webhook idempotency keys are private');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.webhook_events'::regclass
      and constraint_row.conname = 'webhook_events_workspace_kind_event_key'
      and constraint_row.contype = 'u'
  ),
  'webhook events deduplicate by workspace, kind, and event id'
);
select has_table('private', 'billing_usage_ledger', 'message billing trace is private');
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.billing_usage_ledger'::regclass
      and constraint_row.conname = 'billing_usage_ledger_inbound_zero_customer_usage'
  ),
  'inbound ledger rows enforce zero customer allocation'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'private'
      and index_row.indexname = 'message_provider_details_message_id_global_key'
      and index_row.indexdef like '%UNIQUE%'
  ),
  'provider message routing identifiers are globally unambiguous in V1'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'public'
      and index_row.indexname = 'phone_numbers_active_phone_e164_key'
      and index_row.indexdef like '%UNIQUE%'
  ),
  'an active Riink phone number routes to exactly one workspace'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'messages_trace_accepted_outbound_in_ledger'
      and not trigger_row.tgisinternal
  ),
  'accepted outbound messages create their audit trace immediately'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'messages_prevent_billing_attribution_change'
      and not trigger_row.tgisinternal
  ),
  'accepted billing period, position, and snapshots are immutable'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgname = 'messages_validate_inbound_reply_association'
      and not trigger_row.tgisinternal
  ),
  'inbound campaign associations are validated in the database'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'public'
      and published.tablename = 'messages'
  ),
  'product-safe messages are published for Inbox Realtime'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'public'
      and published.tablename = 'contacts'
  ),
  'product-safe contacts are published for Inbox Realtime'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and (
        published.schemaname = 'private'
        or published.tablename like '%provider%'
        or published.tablename in ('webhook_events', 'billing_usage_ledger')
      )
  ),
  'no provider, webhook, ledger, or private table enters Realtime'
);
select ok(
  pg_catalog.has_table_privilege('authenticated', 'public.messages', 'SELECT'),
  'workspace users retain RLS-scoped Inbox message reads'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.webhook_events', 'SELECT'),
  'workspace users cannot read webhook events'
);
select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.billing_usage_ledger', 'SELECT'),
  'workspace users cannot read internal billing allocation or cost'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.resolve_sms_webhook_context(text,text)',
    'EXECUTE'
  ),
  'service role can resolve signed webhook routing context'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.resolve_sms_webhook_context(text,text)',
    'EXECUTE'
  ),
  'workspace users cannot resolve internal webhook context'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.apply_verified_sms_webhook_event(jsonb)',
    'EXECUTE'
  ),
  'service role can apply one verified event atomically'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.apply_verified_sms_webhook_event(jsonb)',
    'EXECUTE'
  ),
  'workspace users cannot forge verified webhook mutations'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.send_manual_message_simulated(uuid,uuid,text)',
    'EXECUTE'
  ),
  'the temporary simulated manual-send RPC is retired after provider wiring'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon',
    'public.send_manual_message_simulated(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous users cannot send manual messages'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.inbound_reconciliation_claim_next(text,timestamptz)',
    'EXECUTE'
  ),
  'service role can claim missing inbound provider usage'
);
select ok(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'public.inbound_reconciliation_claim_next(text,timestamptz)',
    'EXECUTE'
  ),
  'workspace users cannot claim inbound reconciliation'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.inbound_reconciliation_complete(uuid,uuid,integer,bigint,boolean,timestamptz)',
    'EXECUTE'
  ),
  'service role can complete inbound reconciliation'
);
select ok(
  pg_catalog.has_function_privilege(
    'service_role',
    'public.inbound_reconciliation_defer(uuid,uuid,timestamptz,text,timestamptz)',
    'EXECUTE'
  ),
  'service role can safely defer inbound reconciliation'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.apply_verified_sms_webhook_event(jsonb)'::regprocedure
  ) ilike '%resolve_sms_webhook_context%for update%webhook_events%',
  'the one webhook RPC re-resolves, locks, and deduplicates in its transaction'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.apply_verified_inbound_sms_webhook(jsonb,jsonb)'::regprocedure
  ) ilike '%delivery_state is distinct from ''failed''%',
  'reply association excludes only explicit Failed outbound messages'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.apply_verified_inbound_sms_webhook(jsonb,jsonb)'::regprocedure
  ) ilike '%default_pipeline_stage_id%',
  'unknown inbound contacts use the database default stage'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.apply_verified_inbound_sms_webhook(jsonb,jsonb)'::regprocedure
  ) ilike '%upsert_and_stop%stop_campaign_recipient_for_inbound%'
  and pg_catalog.pg_get_functiondef(
    'private.stop_campaign_recipient_for_inbound(uuid,text,timestamptz)'::regprocedure
  ) ilike '%release_reserved_message%',
  'STOP-family handling and reservation release are inside the same RPC'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.apply_verified_inbound_sms_webhook(jsonb,jsonb)'::regprocedure
  ) ilike '%remove_without_resume%',
  'confirmed START removes suppression through the no-resume path'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.apply_verified_status_sms_webhook(jsonb,jsonb)'::regprocedure
  ) ilike '%provider_error_code%',
  'raw callback error codes stay in the private status path'
);
select ok(
  not exists (
    select 1 from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'messages'
      and column_row.column_name like '%provider%'
  ),
  'public Inbox messages contain no provider fields'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.trace_accepted_outbound_in_ledger()'::regprocedure
  ) ilike '%num_segments is null%usage_position%included_segments_snapshot%',
  'pending actual usage still has immutable period, position, and snapshots'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.manual_message_claim_and_reserve(uuid,uuid,uuid,text,integer,uuid,timestamptz)'::regprocedure
  ) ilike '%actual_outbound_segments%reserved_outbound_segments%safety_cap%',
  'real manual sending enforces effective usage transactionally'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.claim_inbound_reconciliation(integer,timestamptz)'::regprocedure
  ) ilike '%for update of detail skip locked%',
  'inbound reconciliation claims use SKIP LOCKED'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.inbound_reconciliation_complete(uuid,uuid,integer,bigint,boolean,timestamptz)'::regprocedure
  ) ilike '%included_segments = 0%overage_segments = 0%',
  'late inbound reconciliation preserves zero customer allocation'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.recalculate_billing_period_allocations(uuid)'::regprocedure
  ) ilike '%usage_position%included_segments_snapshot%',
  'outbound allocation is recomputed in immutable original usage order'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.record_message_delivery_state(uuid,text,timestamptz)'::regprocedure
  ) ilike '%delivery_state = ''failed''%',
  'late explicit Failed remains a terminal product delivery transition'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.stop_campaign_recipient_for_inbound(uuid,text,timestamptz)'::regprocedure
  ) ilike '%state <> ''active''%',
  'inbound never resumes or rewrites a non-active recipient'
);

select * from finish();

rollback;
