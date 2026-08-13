begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(69);

select has_table('private', 'workspace_provider_accounts', 'workspace provider credentials are private');
select has_table('private', 'workspace_provider_setup_operations', 'workspace setup operations are private');
select has_table('private', 'phone_number_operations', 'phone purchase and release operations are private');
select has_table('private', 'phone_number_setup_history', 'number setup history is private');
select has_table('private', 'phone_number_activation_attempts', 'number activation attempts are private');
select has_table('private', 'manual_message_dispatches', 'manual dispatch idempotency keys are private');
select has_table('private', 'dispatch_reconciliation_resolutions', 'operator dispatch resolutions are private');

select has_column('private', 'workspace_provider_accounts', 'encrypted_auth_token', 'provider credentials are encrypted at rest');
select has_column('private', 'workspace_provider_accounts', 'advanced_opt_out_enabled', 'advanced opt-out confirmation is private');
select has_column('private', 'workspace_provider_accounts', 'advanced_opt_out_confirmed_at', 'advanced opt-out confirmation time is audited');
select has_column('private', 'workspace_provider_accounts', 'advanced_opt_out_confirmed_by', 'advanced opt-out confirmation actor is audited');
select has_column('private', 'phone_number_provider_details', 'setup_state', 'technical number setup state is private');
select has_column('private', 'phone_number_provider_details', 'a2p_state', 'technical messaging approval is private');
select has_column('private', 'phone_number_provider_details', 'provider_error_code', 'raw number errors remain private');
select has_column('private', 'phone_number_provider_details', 'provider_error_message', 'raw number error messages remain private');
select has_column('private', 'message_provider_details', 'delivery_status_pending', 'delivery polling state is private');
select has_column('private', 'message_provider_details', 'delivery_observed_at', 'delivery observations are audited');
select has_column('private', 'message_provider_details', 'provider_cost_observed_at', 'provider cost observations are audited');

select ok(
  exists (
    select 1 from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'private'
      and index_row.indexname = 'workspace_provider_setup_one_open_idx'
      and index_row.indexdef like '%UNIQUE%'
  ),
  'one unfinished workspace setup operation is allowed at a time'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'private'
      and index_row.indexname = 'phone_number_operations_open_purchase_phone_idx'
      and index_row.indexdef like '%UNIQUE%'
  ),
  'ambiguous purchases fence the selected phone number globally'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_indexes as index_row
    where index_row.schemaname = 'private'
      and index_row.indexname = 'phone_number_activation_one_open_idx'
      and index_row.indexdef like '%UNIQUE%'
  ),
  'a number has at most one open activation attempt'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.manual_message_dispatches'::regclass
      and constraint_row.conname = 'manual_message_dispatches_workspace_request_key'
      and constraint_row.contype = 'u'
  ),
  'manual request IDs are unique per workspace'
);
select ok(
  exists (
    select 1 from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.dispatch_reconciliation_resolutions'::regclass
      and constraint_row.conname = 'dispatch_reconciliation_resolutions_sent_shape'
  ),
  'operator sent resolutions require provider correlation and acceptance time'
);

select ok(to_regprocedure('public.messaging_claim_workspace_setup(uuid,uuid)') is not null, 'workspace setup claim RPC exists');
select ok(to_regprocedure('public.messaging_record_workspace_account(uuid,uuid,text,text,text)') is not null, 'workspace account persistence RPC exists');
select ok(to_regprocedure('public.messaging_complete_workspace_setup(uuid,uuid,text)') is not null, 'workspace setup completion RPC exists');
select ok(to_regprocedure('public.messaging_mark_workspace_setup_unknown(uuid,uuid,text,text,text,text)') is not null, 'ambiguous workspace setup RPC exists');
select ok(to_regprocedure('public.messaging_get_workspace_credentials(uuid)') is not null, 'workspace credential resolver RPC exists');
select ok(to_regprocedure('public.claim_phone_number_purchase(uuid,uuid,text,text,jsonb)') is not null, 'number purchase claim RPC exists');
select ok(to_regprocedure('public.complete_phone_number_purchase(uuid,uuid,text,text,text)') is not null, 'number purchase completion RPC exists');
select ok(to_regprocedure('public.mark_phone_number_purchase_unknown(uuid,uuid,text,text,text)') is not null, 'ambiguous purchase RPC exists');
select ok(to_regprocedure('public.claim_phone_number_release(uuid,uuid,uuid)') is not null, 'number release claim RPC exists');
select ok(to_regprocedure('public.complete_phone_number_release(uuid,uuid,uuid)') is not null, 'number release completion RPC exists');
select ok(to_regprocedure('public.mark_phone_number_release_unknown(uuid,uuid,uuid,text,text,text)') is not null, 'ambiguous release RPC exists');
select ok(to_regprocedure('public.admin_confirm_workspace_advanced_opt_out(uuid,uuid,timestamptz)') is not null, 'admin opt-out confirmation RPC exists');
select ok(to_regprocedure('public.admin_record_phone_number_setup_state(uuid,uuid,uuid,text,text,text,text,text,timestamptz)') is not null, 'admin setup-state RPC exists');
select ok(to_regprocedure('public.admin_claim_approved_number_activation(uuid,uuid,timestamptz)') is not null, 'admin activation claim RPC exists');
select ok(to_regprocedure('public.admin_fail_approved_number_activation(uuid,uuid,timestamptz,text,uuid,uuid)') is not null, 'admin activation failure RPC exists');
select ok(to_regprocedure('public.admin_get_number_operations(integer)') is not null, 'admin number operations read RPC exists');
select ok(to_regprocedure('public.manual_message_claim_and_reserve(uuid,uuid,uuid,text,integer,uuid,timestamptz)') is not null, 'manual dispatch claim RPC exists');
select ok(to_regprocedure('public.manual_message_final_validate_and_begin_attempt(uuid,uuid,uuid,timestamptz)') is not null, 'manual final validation RPC exists');
select ok(to_regprocedure('public.manual_message_mark_accepted(uuid,uuid,text,text,timestamptz,timestamptz)') is not null, 'manual accepted RPC exists');
select ok(to_regprocedure('public.manual_message_mark_known_failure_and_release(uuid,uuid,text,text,text,text,timestamptz)') is not null, 'manual known failure RPC exists');
select ok(to_regprocedure('public.manual_message_mark_unknown(uuid,uuid,text,text,text,text,text,timestamptz)') is not null, 'manual unknown RPC exists');
select ok(to_regprocedure('public.reconciliation_record_delivery_state(uuid,uuid,text,timestamptz)') is not null, 'delivery reconciliation RPC exists');
select ok(to_regprocedure('public.reconciliation_record_provider_cost(uuid,uuid,bigint,boolean,timestamptz)') is not null, 'cost reconciliation RPC exists');
select ok(to_regprocedure('public.admin_resolve_dispatch_unknown_not_sent(uuid,uuid,uuid,timestamptz,text)') is not null, 'operator not-sent resolution RPC exists');
select ok(to_regprocedure('public.admin_resolve_dispatch_unknown_sent(uuid,uuid,uuid,text,text,timestamptz,timestamptz,text)') is not null, 'operator sent resolution RPC exists');

select ok(pg_catalog.has_function_privilege('service_role', 'public.messaging_get_workspace_credentials(uuid)', 'EXECUTE'), 'service role can resolve encrypted workspace credentials');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.messaging_get_workspace_credentials(uuid)', 'EXECUTE'), 'workspace users cannot resolve provider credentials');
select ok(pg_catalog.has_function_privilege('service_role', 'public.claim_phone_number_purchase(uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'service role can claim number purchases');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.claim_phone_number_purchase(uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'workspace users cannot bypass number purchase orchestration');
select ok(pg_catalog.has_function_privilege('service_role', 'public.manual_message_claim_and_reserve(uuid,uuid,uuid,text,integer,uuid,timestamptz)', 'EXECUTE'), 'service role can claim real manual sends');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.manual_message_claim_and_reserve(uuid,uuid,uuid,text,integer,uuid,timestamptz)', 'EXECUTE'), 'workspace users cannot call manual dispatch internals');
select ok(pg_catalog.has_function_privilege('service_role', 'public.admin_record_phone_number_setup_state(uuid,uuid,uuid,text,text,text,text,text,timestamptz)', 'EXECUTE'), 'service role can record admin setup decisions');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.admin_record_phone_number_setup_state(uuid,uuid,uuid,text,text,text,text,text,timestamptz)', 'EXECUTE'), 'workspace users cannot approve their own number');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.send_manual_message_simulated(uuid,uuid,text)', 'EXECUTE'), 'simulated manual sending is no longer a client bypass');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.workspace_provider_accounts', 'SELECT'), 'workspace users cannot read encrypted provider accounts');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.phone_number_operations', 'SELECT'), 'workspace users cannot read private number operations');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.manual_message_dispatches', 'SELECT'), 'workspace users cannot read dispatch idempotency tokens');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.dispatch_reconciliation_resolutions', 'SELECT'), 'workspace users cannot read operator reconciliation details');

select ok(
  pg_catalog.pg_get_functiondef(
    'public.manual_message_claim_and_reserve(uuid,uuid,uuid,text,integer,uuid,timestamptz)'::regprocedure
  ) ilike '%estimate_sms_segments%p_estimated_segments is distinct from v_server_estimate%actual_outbound_segments%reserved_outbound_segments%',
  'manual claims recompute credits and reserve effective usage transactionally'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.manual_message_final_validate_and_begin_attempt(uuid,uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%manual_message_final_validate_before_billing_rollover%'
  and pg_catalog.pg_get_functiondef(
    'public.manual_message_final_validate_before_billing_rollover(uuid,uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%contact_opted_out%phone_number_not_ready%usage_safety_cap_reached%dispatch_unknown%',
  'manual final validation rechecks compliance, readiness, cap, and persists its fence'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.claim_message_reconciliation(integer,timestamptz)'::regprocedure
  ) ilike '%delivery_status_pending%for update of detail skip locked%',
  'outbound reconciliation polls delivery with SKIP LOCKED'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.reconciliation_record_provider_cost(uuid,uuid,bigint,boolean,timestamptz)'::regprocedure
  ) ilike '%billing_usage_ledger%provider_cost_micro_usd%'
  and pg_catalog.pg_get_functiondef(
    'public.reconciliation_record_provider_cost(uuid,uuid,bigint,boolean,timestamptz)'::regprocedure
  ) not ilike '%actual_outbound_segments%',
  'cost-only reconciliation cannot move reserved credits into actual usage'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.record_message_delivery_state(uuid,text,timestamptz)'::regprocedure
  ) ilike '%campaign_recipient_id is not null%',
  'delivery failure logic explicitly handles manual messages without campaign recipients'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.admin_claim_approved_number_activation(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%advanced_opt_out_enabled%'
  and pg_catalog.pg_get_functiondef(
    'public.admin_claim_approved_number_activation(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%a2p_state%approved%',
  'Ready activation requires both messaging approval and advanced opt-out attestation'
);
select ok(
  not exists (
    select 1
    from information_schema.columns as column_row
    where column_row.table_schema = 'public'
      and column_row.column_name in (
        'provider_account_id',
        'encrypted_auth_token',
        'provider_number_id',
        'provider_error_message',
        'advanced_opt_out_enabled'
      )
  ),
  'provider and compliance internals never appear in public tables'
);
select ok(
  not exists (
    select 1
    from pg_catalog.pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'private'
  ),
  'private provider and reconciliation tables are absent from Realtime'
);

select * from finish();

rollback;
