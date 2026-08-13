begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(55);

create function pg_temp.inbound_mutation(
  p_event_id text,
  p_provider_message_id text,
  p_from_phone text,
  p_body text,
  p_confirmed_consent text,
  p_occurred_at timestamptz,
  p_num_segments integer,
  p_provider_cost_micro_usd bigint
)
returns jsonb
language plpgsql
as $$
declare
  v_action text;
  v_command text;
  v_context jsonb;
  v_keyword text;
  v_key text := upper(btrim(p_body));
  v_stop_for_reply boolean;
begin
  v_context := public.resolve_sms_webhook_context(
    'inbound_number',
    '+14155550601'
  );

  if v_key in ('STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT')
    or p_confirmed_consent = 'opt_out'
  then
    v_command := 'opt_out';
    v_keyword := case
      when v_key in ('STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT')
        then v_key
      else null
    end;
    v_action := 'upsert_and_stop';
    v_stop_for_reply := false;
  elsif v_key in ('START', 'UNSTOP') then
    v_command := 'opt_in';
    v_keyword := v_key;
    v_action := case
      when p_confirmed_consent = 'opt_in' then 'remove_without_resume'
      else 'none'
    end;
    v_stop_for_reply := true;
  else
    v_command := null;
    v_keyword := null;
    v_action := 'none';
    v_stop_for_reply := true;
  end if;

  return jsonb_build_object(
    'kind', 'inbound',
    'expectedContext', v_context,
    'event', jsonb_build_object(
      'kind', 'inbound',
      'eventId', p_event_id,
      'providerMessageId', p_provider_message_id,
      'fromPhoneNumber', p_from_phone,
      'toPhoneNumber', '+14155550601',
      'body', p_body,
      'occurredAt', p_occurred_at,
      'confirmedConsent', p_confirmed_consent
    ),
    'consent', jsonb_build_object(
      'command', v_command,
      'keyword', v_keyword,
      'suppressionAction', v_action,
      'stopForReplyWhenAssociated', v_stop_for_reply,
      'resumeCampaigns', false
    ),
    'usage', jsonb_build_object(
      'direction', 'inbound',
      'numSegments', p_num_segments,
      'providerCostMicroUsd', p_provider_cost_micro_usd,
      'includedSegments', 0,
      'overageSegments', 0,
      'customerBillableAmountMicroUsd', 0
    )
  );
end;
$$;

create function pg_temp.status_mutation(
  p_event_id text,
  p_provider_message_id text,
  p_status text,
  p_occurred_at timestamptz,
  p_actual_segments integer,
  p_provider_cost_micro_usd bigint,
  p_provider_error_code text
)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'kind', 'status',
    'expectedContext', public.resolve_sms_webhook_context(
      'outbound_message',
      p_provider_message_id
    ),
    'event', jsonb_build_object(
      'kind', 'status',
      'eventId', p_event_id,
      'providerMessageId', p_provider_message_id,
      'status', p_status,
      'occurredAt', p_occurred_at,
      'providerErrorCode', p_provider_error_code
    ),
    'deliveryState', case p_status
      when 'sent' then 'sent'
      when 'delivered' then 'delivered'
      when 'failed' then 'failed'
      else null
    end,
    'usage', jsonb_build_object(
      'actualSegments', p_actual_segments,
      'providerCostMicroUsd', p_provider_cost_micro_usd
    )
  );
$$;

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
values (
  '00000000-0000-4000-8000-000000000601',
  'authenticated',
  'authenticated',
  'inbox-database-test@riink.invalid',
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
where owner_id = '00000000-0000-4000-8000-000000000601';

update public.billing_periods as period
set is_provisional = false
from public.workspaces as workspace
where workspace.id = period.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  and period.status = 'open';

insert into private.billing_period_provider_details (
  billing_period_id,
  workspace_id,
  subscription_id,
  activated_at
)
select period.id, period.workspace_id, 'subscription-inbox-test', now()
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  and period.status = 'open';

update private.workspace_billing_accounts as account
set
  stripe_customer_id = 'customer-inbox-test',
  default_payment_method_id = 'payment-inbox-test',
  payment_method_status = 'saved',
  stripe_subscription_id = 'subscription-inbox-test',
  subscription_price_id = 'price-inbox-test',
  subscription_status = 'active',
  current_period_start = period.period_start,
  current_period_end = period.period_end
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where account.workspace_id = workspace.id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  and period.status = 'open';

insert into public.phone_numbers (
  id,
  workspace_id,
  phone_e164,
  status
)
values (
  '00000000-0000-4000-8000-000000000701',
  (
    select workspace.id
    from public.workspaces as workspace
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  '+14155550601',
  'ready'
);

insert into private.phone_number_provider_details (
  phone_number_id,
  provider,
  provider_number_id,
  provider_status
)
values (
  '00000000-0000-4000-8000-000000000701',
  'simulated',
  'simulated-number-inbox-test',
  'ready'
);

insert into public.contacts (
  id,
  workspace_id,
  pipeline_stage_id,
  first_name,
  last_name,
  company,
  phone_e164,
  deleted_at
)
select
  fixture.id,
  workspace.id,
  stage.id,
  fixture.first_name,
  'Inbox',
  'Riink Test',
  fixture.phone_e164,
  fixture.deleted_at
from public.workspaces as workspace
join public.pipeline_stages as stage
  on stage.workspace_id = workspace.id
  and stage.is_default
cross join (
  values
    (
      '00000000-0000-4000-8000-000000000801'::uuid,
      'Known'::text,
      '+14155550611'::text,
      null::timestamptz
    ),
    (
      '00000000-0000-4000-8000-000000000802'::uuid,
      'Deleted'::text,
      '+14155550612'::text,
      now()::timestamptz
    ),
    (
      '00000000-0000-4000-8000-000000000803'::uuid,
      'Compliance'::text,
      '+14155550613'::text,
      null::timestamptz
    )
) as fixture(id, first_name, phone_e164, deleted_at)
where workspace.owner_id = '00000000-0000-4000-8000-000000000601';

select is(
  public.resolve_sms_webhook_context(
    'inbound_number',
    '+14155550601'
  ) ->> 'phoneNumberId',
  '00000000-0000-4000-8000-000000000701'::text,
  'inbound routing resolves only from the stored Riink phone number'
);
select is(
  public.resolve_sms_webhook_context('inbound_number', '+14155559999'),
  null::jsonb,
  'an unknown inbound route returns no context'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Inbox reply campaign',
      '[
        {"body":"First message","wait_days_after_previous":null},
        {"body":"Second message","wait_days_after_previous":1}
      ]'::jsonb,
      '00000000-0000-4000-8000-000000000701',
      array['00000000-0000-4000-8000-000000000801']::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'a reply-race campaign fixture saves'
);
select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox reply campaign'),
      1,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox reply campaign')
      )
    )
  $$,
  'the reply-race campaign fixture launches'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('inbox-worker-1', now())),
  1::bigint,
  'the first campaign outbound is reserved'
);
select ok(
  (
    public.dispatch_final_validate_and_begin_attempt(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000801'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000801'
          and message.step_order = 1
      ),
      now()
    ) ->> 'authorized'
  )::boolean,
  'the first outbound passes final locked validation'
);
select lives_ok(
  $$
    select public.dispatch_mark_accepted(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000801'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000801'
          and message.step_order = 1
      ),
      'simulated',
      'inbox-reply-outbound-1',
      now()
    )
  $$,
  'the first outbound is accepted'
);
select ok(
  exists (
    select 1
    from private.billing_usage_ledger as ledger
    join public.messages as message on message.id = ledger.message_id
    where message.contact_id = '00000000-0000-4000-8000-000000000801'
      and message.step_order = 1
      and ledger.direction = 'outbound'
      and ledger.num_segments is null
      and ledger.billing_period_id = message.billing_period_id
      and ledger.usage_position = message.usage_position
  ),
  'accepted outbound has an immediate pending ledger trace'
);

update public.campaign_recipients
set next_send_at = now()
where contact_id = '00000000-0000-4000-8000-000000000801'
  and state = 'active';

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('inbox-worker-2', now())),
  1::bigint,
  'the next step can race into a cancelable reservation before the reply'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  2,
  'both accepted-pending usage and the next step estimate are reserved'
);

select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'inbound-reply-event-1',
        'inbound-reply-provider-1',
        '+14155550611',
        'Interested',
        null,
        now() + interval '2 minutes',
        1,
        8000
      )
    ) ->> 'associatedCampaignRecipientId'
  ),
  (
    select recipient.id::text
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000801'
  ),
  'normal inbound associates to the latest accepted non-Failed campaign outbound'
);
select is(
  (
    select recipient.stop_reason
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000801'
  ),
  'reply'::text,
  'an associated normal reply stops the active recipient'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  1,
  'reply atomically releases the raced next-step estimate only'
);
select ok(
  exists (
    select 1
    from public.messages as inbound
    join public.messages as outbound on outbound.id = inbound.in_reply_to_message_id
    where inbound.direction = 'inbound'
      and inbound.contact_id = '00000000-0000-4000-8000-000000000801'
      and inbound.received_at is not null
      and outbound.campaign_recipient_id is not null
  ),
  'inbound stores received_at and a non-colliding outbound reply association'
);
select ok(
  (
    select ledger.direction = 'inbound'
      and ledger.included_segments = 0
      and ledger.overage_segments = 0
      and ledger.customer_billable_amount_micro_usd = 0
      and ledger.billing_period_id is not null
      and ledger.usage_position is null
    from private.billing_usage_ledger as ledger
    join public.messages as message on message.id = ledger.message_id
    where message.direction = 'inbound'
      and message.contact_id = '00000000-0000-4000-8000-000000000801'
  ),
  'inbound provider usage is attached to its period but customer-billable zero'
);
select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'inbound-reply-event-1',
        'inbound-reply-provider-1',
        '+14155550611',
        'Interested',
        null,
        now() + interval '2 minutes',
        1,
        8000
      )
    ) ->> 'duplicate'
  )::boolean,
  true,
  'replaying the same workspace-kind-event key is idempotent'
);
select is(
  (
    select count(*)
    from public.messages as message
    where message.direction = 'inbound'
      and message.contact_id = '00000000-0000-4000-8000-000000000801'
  ),
  1::bigint,
  'webhook replay never creates a second inbound message'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
set local role authenticated;

select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox reply campaign')
    ) ->> 'replies'
  )::integer,
  1,
  'associated inbound records the campaign reply dynamically'
);

reset role;

select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.status_mutation(
        'late-failed-event-1',
        'inbox-reply-outbound-1',
        'failed',
        now() + interval '3 minutes',
        2,
        1000,
        '30007'
      )
    ) ->> 'inboundMessageId'
  ),
  null::text,
  'status mutation returns no inbound message correlation'
);
select is(
  (
    select message.delivery_state
    from public.messages as message
    join private.message_provider_details as detail on detail.message_id = message.id
    where detail.provider_message_id = 'inbox-reply-outbound-1'
  ),
  'failed'::text,
  'late explicit Failed overrides an earlier accepted delivery state'
);
select is(
  (
    select detail.provider_error_code
    from private.message_provider_details as detail
    where detail.provider_message_id = 'inbox-reply-outbound-1'
  ),
  '30007'::text,
  'raw callback error code is retained only in private provider details'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  2,
  'a Failed outbound still consumes actual credits reported by the provider'
);
select ok(
  (
    select ledger.num_segments = 2
      and ledger.provider_cost_micro_usd = 1000
      and ledger.included_segments = 2
      and ledger.overage_segments = 0
    from private.billing_usage_ledger as ledger
    join private.message_provider_details as detail
      on detail.message_id = ledger.message_id
    where detail.provider_message_id = 'inbox-reply-outbound-1'
  ),
  'late status reconciles actual usage and cost in the original ledger position'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
set local role authenticated;

select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox reply campaign')
    ) ->> 'sent_recipients'
  )::integer,
  0,
  'late Failed removes the sole outbound from the Reply Rate denominator'
);

reset role;

select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.status_mutation(
        'late-failed-event-1',
        'inbox-reply-outbound-1',
        'failed',
        now() + interval '3 minutes',
        2,
        1000,
        '30007'
      )
    ) ->> 'duplicate'
  )::boolean,
  true,
  'status webhook replay is idempotent'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  2,
  'status replay cannot double-count actual credits'
);

select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'unknown-inbound-event-1',
        'unknown-inbound-provider-1',
        '+14155550614',
        'Hello',
        null,
        now() + interval '4 minutes',
        null,
        null
      )
    ) ->> 'deletedContact'
  )::boolean,
  false,
  'unknown inbound creates an active minimal contact'
);
select ok(
  exists (
    select 1
    from public.contacts as contact
    join public.pipeline_stages as stage on stage.id = contact.pipeline_stage_id
    where contact.phone_e164 = '+14155550614'
      and contact.first_name = ''
      and contact.last_name = ''
      and contact.company = ''
      and stage.is_default
  ),
  'unknown inbound contact is minimal and uses is_default stage'
);
select is(
  (select count(*) from public.inbound_reconciliation_claim_next('inbound-reconciler', now() + interval '5 minutes')),
  1::bigint,
  'missing inbound segments and cost remain claimable'
);
select is(
  (
    select detail.reconciliation_attempt_count
    from private.message_provider_details as detail
    where detail.provider_message_id = 'unknown-inbound-provider-1'
  ),
  1,
  'inbound reconciliation tracks claim attempts'
);
select lives_ok(
  $$
    select public.inbound_reconciliation_complete(
      (
        select detail.message_id
        from private.message_provider_details as detail
        where detail.provider_message_id = 'unknown-inbound-provider-1'
      ),
      (
        select detail.reconciliation_token
        from private.message_provider_details as detail
        where detail.provider_message_id = 'unknown-inbound-provider-1'
      ),
      3,
      500,
      false,
      now() + interval '5 minutes'
    )
  $$,
  'late inbound usage reconciliation completes atomically'
);
select ok(
  (
    select ledger.num_segments = 3
      and ledger.provider_cost_micro_usd = 500
      and ledger.included_segments = 0
      and ledger.overage_segments = 0
      and ledger.customer_billable_amount_micro_usd = 0
    from private.billing_usage_ledger as ledger
    join private.message_provider_details as detail
      on detail.message_id = ledger.message_id
    where detail.provider_message_id = 'unknown-inbound-provider-1'
  ),
  'late inbound cost never becomes customer usage or overage'
);
select lives_ok(
  $$
    select public.inbound_reconciliation_complete(
      (
        select detail.message_id
        from private.message_provider_details as detail
        where detail.provider_message_id = 'unknown-inbound-provider-1'
      ),
      (
        select detail.reconciliation_token
        from private.message_provider_details as detail
        where detail.provider_message_id = 'unknown-inbound-provider-1'
      ),
      3,
      500,
      false,
      now() + interval '5 minutes'
    )
  $$,
  'inbound reconciliation replay is idempotent'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000601'
  ),
  2,
  'inbound reconciliation never increments outbound usage'
);

select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'deleted-inbound-event-1',
        'deleted-inbound-provider-1',
        '+14155550612',
        'Still here',
        null,
        now() + interval '6 minutes',
        1,
        700
      )
    ) ->> 'contactId'
  ),
  '00000000-0000-4000-8000-000000000802'::text,
  'soft-deleted inbound reuses the exact existing contact id'
);
select ok(
  (
    select contact.deleted_at is not null
    from public.contacts as contact
    where contact.id = '00000000-0000-4000-8000-000000000802'
  ),
  'inbound never restores a soft-deleted contact'
);
select is(
  (
    select count(*)
    from public.contacts as contact
    where contact.phone_e164 = '+14155550612'
  ),
  1::bigint,
  'soft-deleted inbound never creates a duplicate contact'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000601';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Inbox compliance campaign',
      '[
        {"body":"Compliance first","wait_days_after_previous":null},
        {"body":"Compliance second","wait_days_after_previous":1}
      ]'::jsonb,
      '00000000-0000-4000-8000-000000000701',
      array['00000000-0000-4000-8000-000000000803']::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'a STOP campaign fixture saves'
);
select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox compliance campaign'),
      1,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Inbox compliance campaign')
      )
    )
  $$,
  'the STOP campaign fixture launches'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('stop-worker-1', now())),
  1::bigint,
  'STOP fixture first step reserves'
);
select ok(
  (
    public.dispatch_final_validate_and_begin_attempt(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000803'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000803'
          and message.step_order = 1
      ),
      now()
    ) ->> 'authorized'
  )::boolean,
  'STOP fixture outbound passes final validation'
);
select lives_ok(
  $$
    select public.dispatch_mark_accepted(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000803'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000803'
          and message.step_order = 1
      ),
      'simulated',
      'stop-outbound-provider-1',
      now()
    )
  $$,
  'STOP fixture outbound is accepted'
);

update public.campaign_recipients
set next_send_at = now()
where contact_id = '00000000-0000-4000-8000-000000000803'
  and state = 'active';

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('stop-worker-2', now())),
  1::bigint,
  'STOP fixture next step races into a reservation'
);
select is(
  (
    public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'stop-event-1',
        'stop-inbound-provider-1',
        '+14155550613',
        ' STOP ',
        'opt_out',
        now() + interval '7 minutes',
        1,
        800
      )
    ) ->> 'duplicate'
  )::boolean,
  false,
  'signed STOP event applies once'
);
select ok(
  exists (
    select 1 from public.suppressions as suppression
    where suppression.phone_e164 = '+14155550613'
  ),
  'STOP upserts the permanent workspace suppression'
);
select is(
  (
    select recipient.stop_reason
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000803'
  ),
  'opt_out'::text,
  'STOP stops the active recipient with the product reason'
);
select is(
  (
    select count(*)
    from public.messages as message
    where message.contact_id = '00000000-0000-4000-8000-000000000803'
      and message.step_order = 2
      and message.dispatch_state = 'failed'
      and message.failure_code = 'contact_opted_out'
  ),
  1::bigint,
  'STOP releases and cancels the raced next-step reservation'
);

select lives_ok(
  $$
    select public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'unconfirmed-start-event-1',
        'unconfirmed-start-provider-1',
        '+14155550613',
        'START',
        null,
        now() + interval '8 minutes',
        1,
        800
      )
    )
  $$,
  'unconfirmed START is retained as an inbound reply'
);
select ok(
  exists (
    select 1 from public.suppressions as suppression
    where suppression.phone_e164 = '+14155550613'
  ),
  'unconfirmed START never removes suppression'
);
select lives_ok(
  $$
    select public.apply_verified_sms_webhook_event(
      pg_temp.inbound_mutation(
        'confirmed-start-event-1',
        'confirmed-start-provider-1',
        '+14155550613',
        'START',
        'opt_in',
        now() + interval '9 minutes',
        1,
        800
      )
    )
  $$,
  'provider-confirmed START is applied'
);
select is(
  (
    select count(*) from public.suppressions as suppression
    where suppression.phone_e164 = '+14155550613'
  ),
  0::bigint,
  'confirmed START removes suppression'
);
select is(
  (
    select recipient.stop_reason
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000803'
  ),
  'opt_out'::text,
  'confirmed START never resumes or rewrites the old campaign recipient'
);
select is(
  (
    select recipient.next_send_at
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000803'
  ),
  null::timestamptz,
  'confirmed START leaves every old schedule cleared'
);

select throws_ok(
  $$
    select public.apply_verified_sms_webhook_event(
      jsonb_set(
        pg_temp.inbound_mutation(
          'mismatched-context-event-1',
          'mismatched-context-provider-1',
          '+14155550615',
          'Context check',
          null,
          now() + interval '10 minutes',
          1,
          100
        ),
        '{expectedContext,phoneNumberId}',
        '"00000000-0000-4000-8000-000000009999"'::jsonb
      )
    )
  $$,
  '55000',
  'SMS webhook routing context changed.',
  'atomic RPC fails closed when expected routing context changed'
);
select is(
  (
    select count(*) from private.webhook_events as event
    where event.event_id = 'mismatched-context-event-1'
  ),
  0::bigint,
  'a failed context transaction never retains its idempotency key'
);

select * from finish();

rollback;
