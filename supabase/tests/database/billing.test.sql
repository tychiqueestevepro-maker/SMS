begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select no_plan();

select has_table('private', 'workspace_billing_accounts', 'billing accounts are private');
select has_table('private', 'billing_setup_intents', 'payment setup correlation is private');
select has_table('private', 'billing_period_provider_details', 'period subscription correlation is private');
select has_table('private', 'billing_webhook_events', 'billing webhook claims are private');
select has_table('private', 'billing_invoice_runs', 'aggregated invoice runs are private');
select has_table('private', 'billing_invoice_run_entries', 'invoice run message deltas are private');
select has_table('private', 'billing_subscription_cancellation_requests', 'cancellation requests are private');
select has_table('private', 'provider_fixed_cost_ledger', 'fixed provider costs are private');
select has_table('private', 'operation_rate_limit_policies', 'rate policies have one private source');
select has_table('private', 'operation_rate_limit_attempts', 'rate attempts are durable');

select has_column('private', 'workspace_billing_accounts', 'subscription_price_id', 'subscription price correlation is persisted');
select has_column('private', 'workspace_billing_accounts', 'terminal_at', 'terminal lifecycle state is durable');
select has_column('private', 'workspace_billing_accounts', 'grace_ends_at', 'grace expiry is durable');
select has_column('private', 'billing_usage_ledger', 'billed_overage_segments', 'ledger tracks billed overage credits');
select has_column('private', 'billing_usage_ledger', 'billed_customer_amount_micro_usd', 'ledger tracks billed customer amount');
select has_column('private', 'billing_usage_ledger', 'reserved_overage_segments', 'ledger tracks claimed overage credits');
select has_column('private', 'billing_usage_ledger', 'reserved_customer_amount_micro_usd', 'ledger tracks claimed invoice amount');
select has_column('private', 'billing_usage_ledger', 'reserved_billing_invoice_run_id', 'ledger delta belongs to one pending run');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.billing_invoice_runs'::regclass
      and constraint_row.conname = 'billing_invoice_runs_stripe_invoice_id_key'
      and constraint_row.contype = 'u'
  ),
  'one aggregated run exists per invoice'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.billing_invoice_run_entries'::regclass
      and constraint_row.conname = 'billing_invoice_run_entries_run_ledger_key'
      and constraint_row.contype = 'u'
  ),
  'one ledger entry is snapshotted once per invoice run'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_row
    where trigger_row.tgrelid = 'public.billing_periods'::regclass
      and trigger_row.tgname = 'billing_periods_prevent_overlap'
      and not trigger_row.tgisinternal
  ),
  'billing periods reject overlaps'
);

select ok(to_regprocedure('public.billing_get_workspace_account(uuid)') is not null, 'workspace billing account RPC exists');
select ok(to_regprocedure('public.billing_record_customer(uuid,text,timestamptz)') is not null, 'customer persistence RPC exists');
select ok(to_regprocedure('public.billing_record_setup_intent(uuid,text,text,timestamptz)') is not null, 'setup persistence RPC exists');
select ok(
  to_regprocedure('public.billing_record_subscription(uuid,text,text,text,text,timestamptz,timestamptz,text,timestamptz)') is not null,
  'subscription persistence requires an explicit price correlation'
);
select ok(to_regprocedure('public.billing_claim_webhook_event(timestamptz,text,text,timestamptz)') is not null, 'billing webhook claim RPC exists');
select ok(to_regprocedure('public.billing_complete_webhook_event(uuid,text,text,timestamptz)') is not null, 'billing webhook completion RPC exists');
select ok(to_regprocedure('public.billing_fail_webhook_event(uuid,text,timestamptz,text,text,text)') is not null, 'billing webhook failure RPC exists');
select ok(to_regprocedure('public.billing_apply_payment_method_event(uuid,text,text,timestamptz,text,text,uuid)') is not null, 'payment method event RPC exists');
select ok(
  to_regprocedure('public.billing_prepare_additional_usage_invoice_run(text,uuid,text,text,timestamptz,text,timestamptz,timestamptz,timestamptz,text)') is not null,
  'aggregated additional usage preparation RPC exists'
);
select ok(
  to_regprocedure('public.billing_complete_additional_usage_invoice_run(integer,uuid,uuid,timestamptz,text,text,text,uuid)') is not null,
  'aggregated additional usage completion RPC exists'
);
select ok(
  to_regprocedure('public.billing_apply_lifecycle_event(boolean,boolean,uuid,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz,text,text,uuid)') is not null,
  'subscription lifecycle RPC exists'
);
select ok(to_regprocedure('public.billing_prepare_subscription_cancellation(timestamptz,uuid)') is not null, 'cancellation preparation RPC exists');
select ok(to_regprocedure('public.billing_complete_subscription_cancellation(uuid,timestamptz,text,uuid)') is not null, 'cancellation completion RPC exists');
select ok(to_regprocedure('public.billing_expire_grace_periods(integer,timestamptz)') is not null, 'grace expiration RPC exists');
select ok(to_regprocedure('public.get_billing_usage_summary()') is not null, 'safe customer usage summary exists');
select ok(to_regprocedure('public.admin_complete_approved_number_activation(uuid,uuid,timestamptz,uuid,timestamptz,timestamptz,text,uuid)') is not null, 'billing-gated number activation exists');
select ok(to_regprocedure('public.messaging_claim_number_search(uuid,uuid,timestamptz)') is not null, 'number search throttling RPC exists');
select ok(to_regprocedure('public.billing_claim_payment_setup_attempt(uuid,text,timestamptz)') is not null, 'payment setup throttling RPC exists');
select ok(to_regprocedure('public.admin_get_customers(integer)') is not null, 'admin customer operations RPC exists');
select ok(to_regprocedure('public.admin_get_message_operations(integer)') is not null, 'admin message operations RPC exists');
select ok(to_regprocedure('public.admin_get_billing_operations(integer)') is not null, 'admin billing operations RPC exists');

select ok(
  pg_catalog.pg_get_functiondef(
    'private.ensure_current_billing_period(uuid,timestamptz)'::regprocedure
  ) ilike '%status = ''open''%exact active billing period is unavailable%',
  'outbound period lookup never returns a closed overlapping period'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.billing_period_for_occurrence(uuid,timestamptz)'::regprocedure
  ) ilike '%period.status = ''open''%period.is_provisional%ensure_current_billing_period%',
  'historical inbound attribution remains deterministic'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%begin_message_dispatch_before_country_check%'
  and pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch_before_country_check(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%move_message_reservation_to_current_period%begin_message_dispatch_before_billing_rollover%'
  and pg_catalog.pg_get_functiondef(
    'private.begin_message_dispatch_before_billing_rollover(uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%dispatch_unknown%',
  'campaign dispatch moves rollover reservations before its provider fence'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.manual_message_final_validate_and_begin_attempt(uuid,uuid,uuid,timestamptz)'::regprocedure
  ) ilike '%move_message_reservation_to_current_period%dispatch_unknown%',
  'manual dispatch moves rollover reservations before its provider fence'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.billing_prepare_additional_usage_invoice_run(text,uuid,text,text,timestamptz,text,timestamptz,timestamptz,timestamptz,text)'::regprocedure
  ) ilike '%reserved_billing_invoice_run_id%for update of ledger%'
  and pg_catalog.pg_get_functiondef(
    'public.billing_prepare_additional_usage_invoice_run(text,uuid,text,text,timestamptz,text,timestamptz,timestamptz,timestamptz,text)'::regprocedure
  ) ilike '%period.status%closed%',
  'invoice preparation atomically claims only closed-period ledger deltas'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.billing_apply_lifecycle_event(boolean,boolean,uuid,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz,text,text,uuid)'::regprocedure
  ) ilike '%terminal_at%subscription_ended%messaging_enabled%',
  'terminal lifecycle disables messaging without losing correlation'
);
select ok(
  pg_catalog.pg_get_functiondef('public.get_billing_usage_summary()'::regprocedure)
    ilike '%actual_outbound_segments%reserved_outbound_segments%'
  and pg_catalog.pg_get_functiondef('public.get_billing_usage_summary()'::regprocedure)
    ilike '%v_effective >= v_cap%',
  'customer summary separates displayed actual credits from effective safety usage'
);

select ok(pg_catalog.has_function_privilege('service_role', 'public.billing_claim_webhook_event(timestamptz,text,text,timestamptz)', 'EXECUTE'), 'service role can claim billing events');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.billing_claim_webhook_event(timestamptz,text,text,timestamptz)', 'EXECUTE'), 'workspace users cannot claim billing events');
select ok(pg_catalog.has_function_privilege('authenticated', 'public.get_billing_usage_summary()', 'EXECUTE'), 'workspace users can read their safe summary');
select ok(not pg_catalog.has_function_privilege('anon', 'public.get_billing_usage_summary()', 'EXECUTE'), 'anonymous users cannot read usage');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.workspace_billing_accounts', 'SELECT'), 'workspace users cannot read billing provider IDs');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.billing_usage_ledger', 'SELECT'), 'workspace users cannot read the billing ledger');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.billing_invoice_runs', 'SELECT'), 'workspace users cannot read invoice runs');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.operation_rate_limit_attempts', 'SELECT'), 'workspace users cannot read throttle internals');
select ok(
  not exists (
    select 1
    from pg_catalog.pg_publication_tables as published
    where published.pubname = 'supabase_realtime'
      and published.schemaname = 'private'
  ),
  'billing internals are absent from Realtime'
);

select is((select monthly_price_cents from public.billing_plans where code = 'riink-v1'), 8999, 'monthly plan remains 89.99 dollars');
select is((select included_segments from public.billing_plans where code = 'riink-v1'), 2000, 'plan includes 2000 outbound credits');
select is((select overage_price_micro_usd from public.billing_plans where code = 'riink-v1'), 40000::bigint, 'additional credit remains 0.04 dollars');
select is((select safety_cap_segments from public.billing_plans where code = 'riink-v1'), 10000, 'safety cap remains 10000 credits');
select is((select max_phone_numbers from public.billing_plans where code = 'riink-v1'), 6, 'plan includes three Riink numbers and three imported numbers');

select * from finish();

rollback;
