begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(94);

insert into auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001001',
    'authenticated',
    'authenticated',
    'provider-behavior@riink.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001002',
    'authenticated',
    'authenticated',
    'provider-unknown@riink.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

update public.workspaces
set
  timezone = 'UTC',
  send_window_start = time '00:00:00',
  send_window_end = time '23:59:59.999999'
where owner_id in (
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000001002'
);

update public.billing_periods as period
set is_provisional = false
from public.workspaces as workspace
where workspace.id = period.workspace_id
  and workspace.owner_id in (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000001002'
  )
  and period.status = 'open';

insert into private.billing_period_provider_details (
  billing_period_id,
  workspace_id,
  subscription_id,
  activated_at
)
select
  period.id,
  period.workspace_id,
  'subscription-provider-test-' || workspace.owner_id::text,
  now()
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where workspace.owner_id in (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000001002'
  )
  and period.status = 'open';

update private.workspace_billing_accounts as account
set
  stripe_customer_id = 'customer-provider-test-' || workspace.owner_id::text,
  default_payment_method_id = 'payment-provider-test-' || workspace.owner_id::text,
  payment_method_status = 'saved',
  stripe_subscription_id = 'subscription-provider-test-' || workspace.owner_id::text,
  subscription_price_id = 'price-provider-test',
  subscription_status = 'active',
  current_period_start = period.period_start,
  current_period_end = period.period_end
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where account.workspace_id = workspace.id
  and workspace.owner_id in (
    '00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000001002'
  )
  and period.status = 'open';

select is(
  (
    select setup.disposition
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001101'
    ) as setup
  ),
  'claimed'::text,
  'the first workspace setup caller receives the durable claim'
);
select is(
  (
    select setup.disposition
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001102'
    ) as setup
  ),
  'in_progress'::text,
  'a concurrent workspace setup cannot duplicate the provider side effect'
);
select is(
  (
    select setup.operation_id
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001102'
    ) as setup
  ),
  '00000000-0000-4000-8000-000000001101'::uuid,
  'in-progress setup returns the original operation correlation'
);
select is(
  (
    select account.recorded
    from public.messaging_record_workspace_account(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001101',
      'twilio',
      'provider-account-1',
      'encrypted-credential-1'
    ) as account
  ),
  true,
  'workspace account credentials persist behind the durable claim'
);
select is(
  (
    select account.recorded
    from public.messaging_record_workspace_account(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001101',
      'twilio',
      'provider-account-1',
      'encrypted-credential-1'
    ) as account
  ),
  true,
  'workspace account persistence is idempotent'
);
select is(
  (
    select setup.completed
    from public.messaging_complete_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001101',
      'provider-service-1'
    ) as setup
  ),
  true,
  'workspace messaging setup completes once the service identifier is persisted'
);
select is(
  (
    select setup.disposition
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001103'
    ) as setup
  ),
  'ready'::text,
  'completed setup never creates another provider account'
);
select ok(
  (
    select credentials.account_id = 'provider-account-1'
      and credentials.encrypted_auth_token = 'encrypted-credential-1'
      and credentials.messaging_service_id = 'provider-service-1'
    from public.messaging_get_workspace_credentials(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001')
    ) as credentials
  ),
  'credential resolver returns only the exact ready workspace credentials'
);

select is(
  (
    select setup.disposition
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001002'),
      '00000000-0000-4000-8000-000000001111'
    ) as setup
  ),
  'claimed'::text,
  'a second workspace gets an independent setup claim'
);
select is(
  (
    select unknown_result.recorded
    from public.messaging_mark_workspace_setup_unknown(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001002'),
      '00000000-0000-4000-8000-000000001111',
      'account',
      'provider-timeout',
      'raw provider setup timeout',
      'provider-account-unknown'
    ) as unknown_result
  ),
  true,
  'an ambiguous workspace side effect is durably marked unknown'
);
select is(
  (
    select setup.disposition
    from public.messaging_claim_workspace_setup(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001002'),
      '00000000-0000-4000-8000-000000001112'
    ) as setup
  ),
  'reconciliation_required'::text,
  'ambiguous workspace setup is never retried automatically'
);
select is(
  (
    select operation.provider_error_message
    from private.workspace_provider_setup_operations as operation
    where operation.operation_id = '00000000-0000-4000-8000-000000001111'
  ),
  'raw provider setup timeout'::text,
  'raw setup diagnostics remain available only in the private ledger'
);
select is(
  (
    select count(*)
    from public.messaging_get_workspace_credentials(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001002')
    )
  ),
  0::bigint,
  'an unresolved workspace has no usable provider credentials'
);

select is(
  (
    select purchase.disposition
    from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001201',
      '+14155551001',
      'selection-nonce-1',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    ) as purchase
  ),
  'claimed'::text,
  'a selected number is fenced before the external purchase'
);
select ok(
  (
    select purchase.phone_number_id is not null
    from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001201',
      '+14155551001',
      'selection-nonce-1',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    ) as purchase
  ),
  'purchase claims preallocate a stable product number id'
);
select is(
  (
    select count(*)
    from public.phone_numbers as phone_number
    where phone_number.id = (
      select operation.phone_number_id
      from private.phone_number_operations as operation
      where operation.operation_id = '00000000-0000-4000-8000-000000001201'
    )
  ),
  0::bigint,
  'the product number is not published before provider purchase succeeds'
);
select is(
  (
    select purchase.disposition
    from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001201',
      '+14155551001',
      'selection-nonce-1',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    ) as purchase
  ),
  'already_started'::text,
  'purchase replay never issues a second external purchase'
);
select is(
  (
    select completion.completed
    from public.complete_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001201',
      'twilio',
      'provider-number-1',
      'purchased'
    ) as completion
  ),
  true,
  'a successful provider purchase publishes one Pending product number'
);
select is(
  (
    select phone_number.status
    from public.phone_numbers as phone_number
    where phone_number.id = (
      select operation.phone_number_id
      from private.phone_number_operations as operation
      where operation.operation_id = '00000000-0000-4000-8000-000000001201'
    )
  ),
  'pending'::text,
  'purchased numbers remain Pending until admin and billing activation'
);
select ok(
  (
    select operation.business_verification ->> 'legalBusinessName' = 'Riink Fixture'
      and detail.provider_number_id = 'provider-number-1'
    from private.phone_number_operations as operation
    join private.phone_number_provider_details as detail
      on detail.phone_number_id = operation.phone_number_id
    where operation.operation_id = '00000000-0000-4000-8000-000000001201'
  ),
  'business evidence and provider number identifiers remain private'
);
select is(
  (
    select completion.completed
    from public.complete_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001201',
      'twilio',
      'provider-number-1',
      'purchased'
    ) as completion
  ),
  true,
  'purchase completion replay is idempotent'
);

select is(
  (
    select setup.activation_eligible
    from public.admin_record_phone_number_setup_state(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      'approved',
      null,
      'approved',
      null,
      null,
      now()
    ) as setup
  ),
  false,
  'A2P approval alone is not activation-eligible without opt-out attestation'
);
select is(
  (
    select activation.disposition
    from public.admin_claim_approved_number_activation(
      '00000000-0000-4000-8000-000000001001',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      now()
    ) as activation
  ),
  'not_approved'::text,
  'activation fails closed until Advanced Opt-Out is confirmed'
);
select is(
  (
    select confirmation.confirmed
    from public.admin_confirm_workspace_advanced_opt_out(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      now()
    ) as confirmation
  ),
  true,
  'an admin can attest Advanced Opt-Out after the messaging service is ready'
);
select ok(
  (
    select account.advanced_opt_out_enabled
      and account.advanced_opt_out_confirmed_by = '00000000-0000-4000-8000-000000001001'
    from private.workspace_provider_accounts as account
    where account.workspace_id = (
      select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
    )
  ),
  'the opt-out attestation records its internal actor'
);
select is(
  (
    select setup.activation_eligible
    from public.admin_record_phone_number_setup_state(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      'approved',
      null,
      'approved',
      null,
      null,
      now()
    ) as setup
  ),
  true,
  'approved setup becomes eligible only after the compliance attestation'
);
select is(
  (
    select activation.disposition
    from public.admin_claim_approved_number_activation(
      '00000000-0000-4000-8000-000000001001',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      now()
    ) as activation
  ),
  'claimed'::text,
  'an approved compliant Pending number can claim billing activation'
);
select is(
  (
    select activation.disposition
    from public.admin_claim_approved_number_activation(
      '00000000-0000-4000-8000-000000001001',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      now()
    ) as activation
  ),
  'in_progress'::text,
  'concurrent admin activation cannot duplicate billing activation'
);
select is(
  (
    select failure.recorded
    from public.admin_fail_approved_number_activation(
      (select activation.activation_id from private.phone_number_activation_attempts as activation where activation.state = 'claimed'),
      '00000000-0000-4000-8000-000000001001',
      now(),
      'billing_setup_failed',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001')
    ) as failure
  ),
  true,
  'failed activation releases its claim while leaving the number Pending'
);
select is(
  (
    select phone_number.status
    from public.phone_numbers as phone_number
    where phone_number.id = (
      select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'
    )
  ),
  'pending'::text,
  'Slice 6 never marks a number Ready before billing completion'
);
select is(
  (
    select activation.disposition
    from public.admin_claim_approved_number_activation(
      '00000000-0000-4000-8000-000000001001',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      now() + interval '1 second'
    ) as activation
  ),
  'claimed'::text,
  'a known failed activation can be safely retried with a new attempt'
);
select ok(
  (
    select operation.activation_eligible and operation.advanced_opt_out_confirmed
    from public.admin_get_number_operations(100) as operation
    where operation.number_id = (
      select number_operation.phone_number_id
      from private.phone_number_operations as number_operation
      where number_operation.operation_id = '00000000-0000-4000-8000-000000001201'
    )
  ),
  'admin operations expose the exact activation eligibility prerequisites'
);

insert into public.phone_numbers (
  id,
  workspace_id,
  phone_e164,
  status
)
values (
  '00000000-0000-4000-8000-000000001301',
  (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
  '+14155551002',
  'ready'
);

insert into private.phone_number_provider_details (
  phone_number_id,
  provider,
  provider_number_id,
  provider_status,
  setup_state,
  a2p_state
)
values (
  '00000000-0000-4000-8000-000000001301',
  'twilio',
  'provider-number-ready',
  'ready',
  'ready',
  'approved'
);

insert into public.contacts (
  id,
  workspace_id,
  pipeline_stage_id,
  first_name,
  phone_e164
)
select
  fixture.id,
  workspace.id,
  stage.id,
  fixture.first_name,
  fixture.phone_e164
from public.workspaces as workspace
join public.pipeline_stages as stage
  on stage.workspace_id = workspace.id and stage.is_default
cross join (
  values
    ('00000000-0000-4000-8000-000000001401'::uuid, 'Manual'::text, '+14155551011'::text),
    ('00000000-0000-4000-8000-000000001402'::uuid, 'Deleted'::text, '+14155551012'::text)
) as fixture(id, first_name, phone_e164)
where workspace.owner_id = '00000000-0000-4000-8000-000000001001';

update public.contacts
set deleted_at = now()
where id = '00000000-0000-4000-8000-000000001402';

select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Estimate mismatch',
      2,
      '00000000-0000-4000-8000-000000001501',
      now()
    )
  $$,
  '22023',
  'Manual message SMS credit estimate is invalid.',
  'manual reservations reject a client-side credit underestimate or mismatch'
);
select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001402',
      '00000000-0000-4000-8000-000000001301',
      'Deleted contact',
      1,
      '00000000-0000-4000-8000-000000001502',
      now()
    )
  $$,
  '55000',
  'This contact is no longer available.',
  'manual reservations reject soft-deleted contacts'
);
select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      (select operation.phone_number_id from private.phone_number_operations as operation where operation.operation_id = '00000000-0000-4000-8000-000000001201'),
      'Pending number',
      1,
      '00000000-0000-4000-8000-000000001503',
      now()
    )
  $$,
  '55000',
  'This phone number is not ready for messaging yet.',
  'manual reservations reject Pending numbers'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      repeat('a', 161),
      2,
      '00000000-0000-4000-8000-000000001511',
      now()
    ) as claim
  ),
  'claimed'::text,
  'manual multipart send reserves its DB-computed credits once'
);
select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      repeat('a', 161),
      2,
      '00000000-0000-4000-8000-000000001511',
      now()
    ) as claim
  ),
  'already_claimed'::text,
  'manual requestId replay returns the existing claim'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    where usage.workspace_id = (
      select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
    )
  ),
  2,
  'manual request replay cannot double-reserve credits'
);
select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Different body',
      1,
      '00000000-0000-4000-8000-000000001511',
      now()
    )
  $$,
  '23514',
  'Manual message request correlation failed.',
  'a requestId cannot be reused for different message content'
);
select is(
  (
    public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      now()
    ) ->> 'authorized'
  )::boolean,
  true,
  'manual final validation authorizes exactly one provider attempt'
);
select is(
  (
    select message.dispatch_state
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001511'
  ),
  'dispatch_unknown'::text,
  'manual final validation persists the ambiguity fence before the call'
);
select lives_ok(
  $$
    select public.manual_message_mark_accepted(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      'twilio',
      'manual-provider-message-1',
      now(),
      now()
    )
  $$,
  'accepted manual sends receive immutable billing attribution'
);
select ok(
  (
    select message.dispatch_state = 'accepted'
      and message.billing_period_id is not null
      and message.usage_position is not null
      and message.reserved_segments = 2
      and message.num_segments is null
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001511'
  ),
  'accepted manual estimate stays reserved until actual segments arrive'
);
select is(
  (select count(*) from public.reconciliation_claim_next('manual-reconciler-1', now() + interval '1 minute')),
  1::bigint,
  'manual accepted messages are claimable with nullable campaign correlation'
);
select lives_ok(
  $$
    select public.reconciliation_record_delivery_state(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      'sent',
      now() + interval '1 minute'
    )
  $$,
  'delivery status can persist before actual segments are known'
);
select lives_ok(
  $$
    select public.reconciliation_record_provider_cost(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      1200,
      false,
      now() + interval '1 minute'
    )
  $$,
  'provider cost persists independently while segments remain unavailable'
);
select ok(
  (
    select usage.actual_outbound_segments = 0
      and usage.reserved_outbound_segments = 2
      and ledger.provider_cost_micro_usd = 1200
      and ledger.num_segments is null
    from public.billing_period_usage as usage
    join private.billing_usage_ledger as ledger
      on ledger.workspace_id = usage.workspace_id
    where ledger.message_id = (
      select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'
    )
  ),
  'cost-only observation never moves an estimate into actual customer usage'
);
select lives_ok(
  $$
    select public.reconciliation_record_delivery_state(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      'delivered',
      now() + interval '2 minutes'
    )
  $$,
  'terminal delivery observation ends delivery polling'
);
select lives_ok(
  $$
    select public.reconciliation_complete(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      3,
      1200,
      false,
      now() + interval '2 minutes'
    )
  $$,
  'actual multipart usage replaces the estimate transactionally'
);
select ok(
  (
    select usage.actual_outbound_segments = 3
      and usage.reserved_outbound_segments = 0
      and ledger.num_segments = 3
      and ledger.included_segments = 3
      and ledger.overage_segments = 0
      and ledger.provider_cost_micro_usd = 1200
    from public.billing_period_usage as usage
    join private.billing_usage_ledger as ledger
      on ledger.workspace_id = usage.workspace_id
    where ledger.message_id = (
      select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'
    )
  ),
  'manual actual credits and private provider cost reconcile exactly once'
);
select lives_ok(
  $$
    select public.reconciliation_complete(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      3,
      1200,
      false,
      now() + interval '3 minutes'
    )
  $$,
  'manual actual usage reconciliation replay is idempotent'
);
select lives_ok(
  $$
    select public.reconciliation_record_delivery_state(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001511'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-1'),
      'failed',
      now() + interval '4 minutes'
    )
  $$,
  'a late explicit Failed transition is manual-message safe'
);
select ok(
  (
    select message.delivery_state = 'failed'
      and message.num_segments = 3
      and message.campaign_id is null
      and message.campaign_recipient_id is null
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001511'
  ),
  'manual late Failed preserves consumed actual usage without campaign dereference'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    where usage.workspace_id = (
      select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
    )
  ),
  3,
  'late Failed never removes actual provider-consumed credits'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Known failure',
      1,
      '00000000-0000-4000-8000-000000001512',
      now()
    ) as claim
  ),
  'claimed'::text,
  'a second manual request reserves independently'
);
select is(
  (
    public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001512'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001512'),
      now()
    ) ->> 'authorized'
  )::boolean,
  true,
  'known-failure fixture passes final validation'
);
select lives_ok(
  $$
    select public.manual_message_mark_known_failure_and_release(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001512'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001512'),
      'twilio',
      null,
      '21211',
      'raw invalid destination',
      now()
    )
  $$,
  'known pre-accept failure is persisted and its reservation released'
);
select ok(
  (
    select message.dispatch_state = 'failed'
      and message.reserved_segments = 0
      and detail.provider_error_code = '21211'
      and detail.provider_error_message = 'raw invalid destination'
    from public.messages as message
    join private.message_provider_details as detail on detail.message_id = message.id
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001512'
  ),
  'known provider diagnostics remain private and cannot consume credits'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Ambiguous message',
      1,
      '00000000-0000-4000-8000-000000001513',
      now()
    ) as claim
  ),
  'claimed'::text,
  'ambiguous manual fixture reserves once'
);
select lives_ok(
  $$
    select public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001513'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001513'),
      now()
    )
  $$,
  'ambiguous manual fixture persists its pre-call fence'
);
select lives_ok(
  $$
    select public.manual_message_mark_unknown(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001513'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001513'),
      'provider_result_ambiguous',
      'twilio',
      null,
      'timeout',
      'raw timeout after request',
      now()
    )
  $$,
  'ambiguous provider result remains fenced without automatic retry'
);
select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Do not duplicate',
      1,
      '00000000-0000-4000-8000-000000001514',
      now()
    )
  $$,
  '55000',
  'An earlier manual message requires reconciliation.',
  'an unresolved ambiguous manual send blocks any new send to the same contact and number'
);
select is(
  (
    select resolution.resolved
    from public.admin_resolve_dispatch_unknown_not_sent(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001513'),
      now(),
      'Confirmed absent in provider console'
    ) as resolution
  ),
  true,
  'an operator can confirm an ambiguous attempt was not sent'
);
select ok(
  (
    select message.dispatch_state = 'failed'
      and message.failure_code = 'operator_confirmed_not_sent'
      and message.reserved_segments = 0
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001513'
  ),
  'confirmed-not-sent resolution releases usage without retrying'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Opt-out race',
      1,
      '00000000-0000-4000-8000-000000001515',
      now()
    ) as claim
  ),
  'claimed'::text,
  'a manual request can reserve before a concurrent opt-out arrives'
);

insert into public.suppressions (workspace_id, phone_e164, source)
select workspace.id, '+14155551011', 'opt_out'
from public.workspaces as workspace
where workspace.owner_id = '00000000-0000-4000-8000-000000001001';

select is(
  (
    public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001515'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001515'),
      now()
    ) ->> 'code'
  ),
  'contact_opted_out'::text,
  'final validation catches an opt-out that raced after reservation'
);
select ok(
  (
    select message.dispatch_state = 'failed'
      and message.failure_code = 'contact_opted_out'
      and message.reserved_segments = 0
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001515'
  ),
  'the opt-out race releases the estimate without calling the provider'
);

delete from public.suppressions
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
)
  and phone_e164 = '+14155551011';

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Operator confirms sent',
      1,
      '00000000-0000-4000-8000-000000001516',
      now()
    ) as claim
  ),
  'claimed'::text,
  'a new request is allowed after the prior ambiguity is explicitly resolved'
);
select lives_ok(
  $$
    select public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      now()
    )
  $$,
  'confirmed-sent fixture persists a dispatch fence'
);
select lives_ok(
  $$
    select public.manual_message_mark_unknown(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      'post_provider_persistence_failed',
      'twilio',
      'manual-provider-message-2',
      null,
      null,
      now()
    )
  $$,
  'a provider identifier can be retained while persistence remains ambiguous'
);
select is(
  (
    select resolution.resolved
    from public.admin_resolve_dispatch_unknown_sent(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      'twilio',
      'manual-provider-message-2',
      now(),
      now(),
      'Confirmed accepted in provider console'
    ) as resolution
  ),
  true,
  'an operator can attribute a confirmed-sent ambiguous message without resending'
);
select ok(
  (
    select message.dispatch_state = 'accepted'
      and message.billing_period_id is not null
      and message.usage_position is not null
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001516'
  ),
  'confirmed-sent resolution enters normal immutable usage reconciliation'
);
select is(
  (select count(*) from public.reconciliation_claim_next('manual-reconciler-2', now() + interval '1 minute')),
  1::bigint,
  'operator-confirmed sent usage is claimable for actual data'
);
select lives_ok(
  $$
    select public.reconciliation_record_delivery_state(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-2'),
      'delivered',
      now() + interval '1 minute'
    )
  $$,
  'confirmed-sent message receives a terminal delivery observation'
);
select lives_ok(
  $$
    select public.reconciliation_record_provider_cost(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-2'),
      500,
      false,
      now() + interval '1 minute'
    )
  $$,
  'confirmed-sent provider cost is retained privately'
);
select lives_ok(
  $$
    select public.reconciliation_complete(
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001516'),
      (select detail.reconciliation_token from private.message_provider_details as detail where detail.provider_message_id = 'manual-provider-message-2'),
      1,
      500,
      false,
      now() + interval '1 minute'
    )
  $$,
  'confirmed-sent actual usage reconciles without a second send'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    where usage.workspace_id = (
      select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
    )
  ),
  4,
  'operator-confirmed sent usage contributes exactly one additional credit'
);

update public.billing_period_usage
set actual_outbound_segments = 9999
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Exactly at cap',
      1,
      '00000000-0000-4000-8000-000000001517',
      now()
    ) as claim
  ),
  'claimed'::text,
  'a reservation may bring effective usage exactly to the safety cap'
);
select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Beyond cap',
      1,
      '00000000-0000-4000-8000-000000001518',
      now()
    )
  $$,
  '23514',
  'The SMS usage safety cap has been reached.',
  'the next reservation beyond 10,000 credits is blocked'
);
select is(
  (
    public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001517'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001517'),
      now()
    ) ->> 'authorized'
  )::boolean,
  true,
  'the exact-cap reservation remains valid immediately before the provider call'
);
select lives_ok(
  $$
    select public.admin_resolve_dispatch_unknown_not_sent(
      '00000000-0000-4000-8000-000000001001',
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001517'),
      now(),
      'Cap fixture was not sent'
    )
  $$,
  'operator resolution releases the exact-cap test reservation'
);

update public.billing_period_usage
set actual_outbound_segments = 10000
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);

select throws_ok(
  $$
    select * from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'At cap blocked',
      1,
      '00000000-0000-4000-8000-000000001519',
      now()
    )
  $$,
  '23514',
  'The SMS usage safety cap has been reached.',
  'new sends stop once actual usage is already at the safety cap'
);

update public.billing_period_usage
set actual_outbound_segments = 4
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);
update private.workspace_messaging_controls
set safety_cap_segments_override = 10
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);

select is(
  (
    select claim.disposition
    from public.manual_message_claim_and_reserve(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001401',
      '00000000-0000-4000-8000-000000001301',
      'Cap changed after reserve',
      1,
      '00000000-0000-4000-8000-000000001520',
      now()
    ) as claim
  ),
  'claimed'::text,
  'manual fixture reserves below an initial admin cap'
);

update private.workspace_messaging_controls
set safety_cap_segments_override = 4
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);

select is(
  (
    public.manual_message_final_validate_and_begin_attempt(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      (select manual.message_id from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001520'),
      (select manual.claim_token from private.manual_message_dispatches as manual where manual.request_id = '00000000-0000-4000-8000-000000001520'),
      now()
    ) ->> 'code'
  ),
  'usage_safety_cap_reached'::text,
  'final validation catches an admin cap reduction after reservation'
);
select ok(
  (
    select message.dispatch_state = 'failed' and message.reserved_segments = 0
    from public.messages as message
    join private.manual_message_dispatches as manual on manual.message_id = message.id
    where manual.request_id = '00000000-0000-4000-8000-000000001520'
  ),
  'final safety-cap rejection releases the reservation transactionally'
);

update private.workspace_messaging_controls
set safety_cap_segments_override = null
where workspace_id = (
  select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
);

update public.billing_plans
set max_phone_numbers = 1
where code = 'riink-v1';

select is(
  (
    select period.max_phone_numbers_snapshot
    from public.billing_periods as period
    join public.workspaces as workspace on workspace.id = period.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000001001'
      and period.status = 'open'
  ),
  6,
  'the current period keeps its original six-number allowance after a plan edit'
);

select is(
  (
    select purchase.disposition
    from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001202',
      '+14155551003',
      'selection-nonce-2',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    ) as purchase
  ),
  'claimed'::text,
  'an in-flight third number consumes the final plan slot'
);

update public.billing_plans
set max_phone_numbers = 6
where code = 'riink-v1';

select is(
  (
    select unknown_result.recorded
    from public.mark_phone_number_purchase_unknown(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001202',
      'purchase-timeout',
      'raw ambiguous purchase',
      'provider-number-unknown'
    ) as unknown_result
  ),
  true,
  'an ambiguous purchase remains charged against number capacity'
);

insert into public.phone_numbers (
  id,
  workspace_id,
  phone_e164,
  status,
  number_source,
  import_status,
  activated_at
)
select fixture.id, workspace.id, fixture.phone_e164, 'ready', 'imported', 'active', now()
from public.workspaces as workspace
cross join (
  values
    ('00000000-0000-4000-8000-000000001302'::uuid, '+14155551005'::text),
    ('00000000-0000-4000-8000-000000001303'::uuid, '+14155551006'::text),
    ('00000000-0000-4000-8000-000000001304'::uuid, '+14155551007'::text)
) as fixture(id, phone_e164)
where workspace.owner_id = '00000000-0000-4000-8000-000000001001';

select throws_ok(
  $$
    select * from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001203',
      '+14155551004',
      'selection-nonce-3',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    )
  $$,
  '23514',
  'This workspace already has the maximum number of phone numbers.',
  'pending and ambiguous purchases cannot bypass the six-number plan limit'
);
select is(
  (
    select purchase.disposition
    from public.claim_phone_number_purchase(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001204',
      '+14155551003',
      'selection-nonce-4',
      '{"legalBusinessName":"Riink Fixture"}'::jsonb
    ) as purchase
  ),
  'reconciliation_required'::text,
  'another operation cannot retry an ambiguous selected number'
);

select is(
  (
    select release.disposition
    from public.claim_phone_number_release(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001301',
      '00000000-0000-4000-8000-000000001601'
    ) as release
  ),
  'claimed'::text,
  'number release receives a durable provider-side claim'
);
select ok(
  (
    select phone_number.deleted_at is not null
      and phone_number.phone_e164 is null
      and phone_number.status = 'pending'
    from public.phone_numbers as phone_number
    where phone_number.id = '00000000-0000-4000-8000-000000001301'
  ),
  'release immediately masks and makes the product number non-sendable'
);
select is(
  (
    select release.completed
    from public.complete_phone_number_release(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001301',
      '00000000-0000-4000-8000-000000001601'
    ) as release
  ),
  true,
  'successful external release completes the private operation'
);
select is(
  (
    select release.disposition
    from public.claim_phone_number_release(
      (select workspace.id from public.workspaces as workspace where workspace.owner_id = '00000000-0000-4000-8000-000000001001'),
      '00000000-0000-4000-8000-000000001301',
      '00000000-0000-4000-8000-000000001602'
    ) as release
  ),
  'already_released'::text,
  'release replay never calls the provider twice'
);

select * from finish();

rollback;
