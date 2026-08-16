begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(74);

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
  '00000000-0000-4000-8000-000000000201',
  'authenticated',
  'authenticated',
  'campaign-database-test@riink.invalid',
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
where owner_id = '00000000-0000-4000-8000-000000000201';

-- Final V1 dispatch requires an active paid account and the exact current
-- subscription period; simulated-provider tests establish that invariant
-- directly rather than bypassing the production gate.
update public.billing_periods as period
set is_provisional = false
from public.workspaces as workspace
where workspace.id = period.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201'
  and period.status = 'open';

insert into private.billing_period_provider_details (
  billing_period_id,
  workspace_id,
  subscription_id,
  activated_at
)
select period.id, period.workspace_id, 'subscription-campaign-test', now()
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where workspace.owner_id = '00000000-0000-4000-8000-000000000201'
  and period.status = 'open';

update private.workspace_billing_accounts as account
set
  stripe_customer_id = 'customer-campaign-test',
  default_payment_method_id = 'payment-campaign-test',
  payment_method_status = 'saved',
  stripe_subscription_id = 'subscription-campaign-test',
  subscription_price_id = 'price-campaign-test',
  subscription_status = 'active',
  current_period_start = period.period_start,
  current_period_end = period.period_end
from public.billing_periods as period
join public.workspaces as workspace on workspace.id = period.workspace_id
where account.workspace_id = workspace.id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201'
  and period.status = 'open';

insert into public.phone_numbers (
  id,
  workspace_id,
  phone_e164,
  status
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    (
      select workspace.id
      from public.workspaces as workspace
      where workspace.owner_id = '00000000-0000-4000-8000-000000000201'
    ),
    '+14155550130',
    'ready'
  ),
  (
    '00000000-0000-4000-8000-000000000302',
    (
      select workspace.id
      from public.workspaces as workspace
      where workspace.owner_id = '00000000-0000-4000-8000-000000000201'
    ),
    '+14155550139',
    'pending'
  );

insert into public.contacts (
  id,
  workspace_id,
  pipeline_stage_id,
  first_name,
  last_name,
  company,
  phone_e164
)
select
  fixture.id,
  workspace.id,
  stage.id,
  fixture.first_name,
  'Recipient',
  'Riink Test',
  fixture.phone_e164
from public.workspaces as workspace
join public.pipeline_stages as stage
  on stage.workspace_id = workspace.id
  and stage.is_default
cross join (
  values
    (
      '00000000-0000-4000-8000-000000000401'::uuid,
      'Ada'::text,
      '+14155550131'::text
    ),
    (
      '00000000-0000-4000-8000-000000000402'::uuid,
      'Grace'::text,
      '+14155550132'::text
    ),
    (
      '00000000-0000-4000-8000-000000000403'::uuid,
      'Katherine'::text,
      '+14155550133'::text
    ),
    (
      '00000000-0000-4000-8000-000000000404'::uuid,
      'Dorothy'::text,
      '+14155550134'::text
    )
) as fixture(id, first_name, phone_e164)
where workspace.owner_id = '00000000-0000-4000-8000-000000000201';

select is(
  private.estimate_sms_segments(repeat('a', 160)),
  1,
  '160 GSM-7 basic units estimate one SMS credit'
);
select is(
  private.estimate_sms_segments(repeat('a', 161)),
  2,
  '161 GSM-7 basic units estimate two SMS credits'
);
select is(
  private.estimate_sms_segments(repeat('€', 80)),
  1,
  '80 GSM-7 extension characters consume 160 units and one credit'
);
select is(
  private.estimate_sms_segments(repeat('€', 81)),
  2,
  'GSM-7 extension characters consume two units each'
);
select is(
  private.estimate_sms_segments(repeat('😀', 35)),
  1,
  'Unicode estimation counts UTF-16 units like the composer'
);
select is(
  private.estimate_sms_segments(repeat('😀', 36)),
  2,
  'Unicode messages become multipart after 70 UTF-16 units'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Core campaign',
      '[
        {"body":"Hello {{first_name}}","wait_days_after_previous":null},
        {"body":"Following up","wait_days_after_previous":1}
      ]'::jsonb,
      '00000000-0000-4000-8000-000000000301',
      array[
        '00000000-0000-4000-8000-000000000401',
        '00000000-0000-4000-8000-000000000402'
      ]::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_drip_interval_minutes => 4,
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'an owner can atomically save a draft with contacts and two steps'
);
select is(
  (
    select count(*)
    from public.campaign_draft_contacts as draft_contact
    join public.campaigns as campaign on campaign.id = draft_contact.campaign_id
    where campaign.name = 'Core campaign'
  ),
  2::bigint,
  'draft contact selection is persisted before launch'
);
select is(
  (
    select count(*)
    from public.campaign_steps as step
    join public.campaigns as campaign on campaign.id = step.campaign_id
    where campaign.name = 'Core campaign'
  ),
  2::bigint,
  'draft save replaces the complete 1-3 message definition'
);
select is(
  (
    public.assess_campaign_launch(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'eligible_recipient_count'
  )::integer,
  2,
  'launch assessment derives the server-stored draft selection'
);
select is(
  (
    public.assess_campaign_launch(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'requires_confirmation'
  )::boolean,
  false,
  'a small launch within included credits needs no volume confirmation'
);
select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign'),
      2,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
      )
    )
  $$,
  'launch revalidates and enrolls the stored eligible contacts'
);
select is(
  (
    select count(*)
    from public.campaign_recipients as recipient
    join public.campaigns as campaign on campaign.id = recipient.campaign_id
    where campaign.name = 'Core campaign'
      and recipient.state = 'active'
  ),
  2::bigint,
  'launch creates one active recipient per eligible contact'
);

reset role;

select ok(
  (
    select confirmation.consent_confirmed
      and not confirmation.large_launch_confirmed
      and confirmation.launch_assessment is not null
    from public.consent_confirmations as confirmation
    join public.campaigns as campaign on campaign.id = confirmation.campaign_id
    where campaign.name = 'Core campaign'
  ),
  'launch stores consent and its assessment snapshot for audit'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Conflicting campaign',
      '[{"body":"Hello again","wait_days_after_previous":null}]'::jsonb,
      '00000000-0000-4000-8000-000000000301',
      array['00000000-0000-4000-8000-000000000401']::uuid[],
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'another draft can be prepared while a contact is already sequenced'
);
select is(
  (
    public.assess_campaign_launch(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Conflicting campaign')
    ) ->> 'active_sequence_count'
  )::integer,
  1,
  'eligibility excludes a contact already in an active sequence'
);
select throws_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Conflicting campaign'),
      0,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Conflicting campaign')
      )
    )
  $$,
  '22023',
  'No selected contacts are eligible for this campaign.',
  'one contact cannot enter a second active sequence'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-one', now())),
  1::bigint,
  'the worker wrapper claims one due message'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-two', now() + interval '2 minutes')),
  0::bigint,
  'the campaign-specific drip interval blocks an early second dispatch'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-two', now() + interval '4 minutes')),
  1::bigint,
  'the next recipient becomes claimable at the configured drip interval'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-three', now())),
  0::bigint,
  'already-reserved recipient steps cannot be claimed twice'
);
select is(
  (
    select count(*)
    from public.messages as message
    join public.campaigns as campaign on campaign.id = message.campaign_id
    where campaign.name = 'Core campaign'
  ),
  2::bigint,
  'the unique recipient-step key produces exactly two message rows'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000201'
  ),
  2,
  'estimated credits are reserved exactly once'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.pause_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    )
  $$,
  'an active campaign can be paused'
);
select is(
  (
    select count(*)
    from public.messages as message
    join public.campaigns as campaign on campaign.id = message.campaign_id
    where campaign.name = 'Core campaign'
      and message.dispatch_state = 'pending'
  ),
  2::bigint,
  'pause cancels every still-cancelable reservation'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
  ),
  0,
  'pause releases estimated usage transactionally'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('paused-worker', now())),
  0::bigint,
  'a paused campaign cannot be claimed'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.resume_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    )
  $$,
  'a paused campaign can resume with shifted deadlines'
);

reset role;

update public.campaign_recipients as recipient
set next_send_at = now()
from public.campaigns as campaign
where campaign.id = recipient.campaign_id
  and campaign.name = 'Core campaign'
  and recipient.state = 'active';

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-four', now())),
  1::bigint,
  'a released pending message can be reserved again once resumed'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-five-early', now() + interval '2 minutes')),
  0::bigint,
  'resumed work still respects the campaign-specific drip interval'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('worker-five', now() + interval '4 minutes')),
  1::bigint,
  'resumed work becomes claimable when its configured interval elapses'
);

select ok(
  (
    public.dispatch_final_validate_and_begin_attempt(
      (
        select message.id
        from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select message.reservation_token
        from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      now()
    ) ->> 'authorized'
  )::boolean,
  'final validation authorizes the first and only provider attempt'
);
select is(
  (
    select message.dispatch_state
    from public.messages as message
    where message.contact_id = '00000000-0000-4000-8000-000000000401'
      and message.step_order = 1
  ),
  'dispatch_unknown'::text,
  'authorization durably records dispatch_unknown before the external call'
);
select is(
  (
    select recipient.stop_reason
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000401'
      and recipient.campaign_id = (
        select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign'
      )
  ),
  'dispatch_unknown'::text,
  'the recipient is fail-closed until the result is reconciled'
);
select is(
  (
    public.dispatch_final_validate_and_begin_attempt(
      (
        select message.id
        from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select message.reservation_token
        from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      now()
    ) ->> 'authorized'
  )::boolean,
  false,
  'replaying final validation never authorizes a second provider call'
);

select lives_ok(
  $$
    select public.dispatch_mark_accepted(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      'simulated',
      'simulated-message-1',
      now()
    )
  $$,
  'an accepted result is persisted with immutable billing attribution'
);
select lives_ok(
  $$
    select public.dispatch_mark_accepted(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select message.reservation_token from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      'simulated',
      'simulated-message-1',
      now()
    )
  $$,
  'replaying accepted persistence is idempotent'
);
select ok(
  (
    select message.billing_period_id is not null
      and message.usage_position = 1
      and message.included_segments_snapshot = 2000
    from public.messages as message
    where message.contact_id = '00000000-0000-4000-8000-000000000401'
      and message.step_order = 1
  ),
  'accepted outbound receives immutable period, position, and pricing snapshots'
);
select is(
  (select count(*) from public.reconciliation_claim_next('reconciler-one', now())),
  1::bigint,
  'an accepted message with unknown actual credits is claimed for reconciliation'
);
select lives_ok(
  $$
    select public.reconciliation_complete(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select detail.reconciliation_token
        from private.message_provider_details as detail
        join public.messages as message on message.id = detail.message_id
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      2,
      1234,
      false,
      now()
    )
  $$,
  'reconciliation atomically replaces the estimate with actual credits'
);
select lives_ok(
  $$
    select public.reconciliation_complete(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      (
        select detail.reconciliation_token
        from private.message_provider_details as detail
        join public.messages as message on message.id = detail.message_id
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      2,
      1234,
      false,
      now()
    )
  $$,
  'replaying reconciliation cannot count actual credits twice'
);
select is(
  (
    select usage.actual_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
  ),
  2,
  'a two-segment message consumes two backend credits'
);
select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
  ),
  1,
  'only the other unresolved message estimate remains reserved'
);

update public.campaign_recipients as recipient
set replied_at = message.accepted_at + interval '1 minute'
from public.messages as message
where message.campaign_recipient_id = recipient.id
  and message.contact_id = '00000000-0000-4000-8000-000000000401'
  and message.step_order = 1;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'sent_recipients'
  )::integer,
  1,
  'accepted with delivery_state NULL enters the Reply Rate denominator'
);
select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'replies'
  )::integer,
  1,
  'a reply after an accepted outbound enters Replies'
);

reset role;

select lives_ok(
  $$
    select private.record_message_delivery_state(
      (
        select message.id from public.messages as message
        where message.contact_id = '00000000-0000-4000-8000-000000000401'
          and message.step_order = 1
      ),
      'failed',
      now()
    )
  $$,
  'an explicit later delivery failure is recorded'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'sent_recipients'
  )::integer,
  0,
  'an explicitly Failed sole message is removed from the denominator'
);
select is(
  (
    public.get_campaign_statistics(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    ) ->> 'replies'
  )::integer,
  0,
  'Reply count recalculates when the qualifying outbound becomes Failed'
);
select lives_ok(
  $$
    select public.delete_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Core campaign')
    )
  $$,
  'campaign deletion completes in one transaction'
);
select ok(
  (
    select campaign.deleted_at is not null and campaign.status = 'finished'
    from public.campaigns as campaign
    where campaign.name = 'Core campaign'
  ),
  'a deleted campaign is soft-deleted and Finished'
);

reset role;

select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
  ),
  0,
  'campaign deletion releases every remaining cancelable estimate'
);
select is(
  (
    select count(*)
    from public.messages as message
    join public.campaigns as campaign on campaign.id = message.campaign_id
    where campaign.name = 'Core campaign'
  ),
  2::bigint,
  'campaign deletion preserves outbound history'
);
select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('after-delete', now())),
  0::bigint,
  'a deleted campaign can never produce another claim'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Pending number campaign',
      '[{"body":"Ready check","wait_days_after_previous":null}]'::jsonb,
      '00000000-0000-4000-8000-000000000302',
      array['00000000-0000-4000-8000-000000000403']::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'a campaign can be fully saved while its number is Pending'
);
select throws_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign'),
      1,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
      )
    )
  $$,
  '55000',
  'This phone number is not ready for messaging yet.',
  'Pending number blocks launch only'
);
select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign'),
      'Pending number campaign',
      '[{"body":"Ready check","wait_days_after_previous":null}]'::jsonb,
      '00000000-0000-4000-8000-000000000301',
      array['00000000-0000-4000-8000-000000000403']::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'the draft can select a Ready number without changing scope'
);

reset role;

update public.billing_period_usage as usage
set actual_outbound_segments = 2000
from public.workspaces as workspace
where workspace.id = usage.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201';

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select ok(
  (
    public.assess_campaign_launch(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
    ) ->> 'requires_confirmation'
  )::boolean,
  'a first step likely to enter overage requires explicit confirmation'
);
select throws_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign'),
      1,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
      )
    )
  $$,
  'P0001',
  'Campaign launch confirmation is required.',
  'overage warning is revalidated server-side'
);
select throws_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign'),
      1,
      true,
      true,
      pg_catalog.jsonb_set(
        public.assess_campaign_launch(
          (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
        ),
        '{current_effective_usage_credits}',
        '1999'::jsonb
      )
    )
  $$,
  '40001',
  'Campaign launch assessment changed. Review the launch again.',
  'a stale usage assessment cannot authorize a changed large launch'
);
select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign'),
      1,
      true,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
      )
    )
  $$,
  'confirmation permits overage without creating a new campaign limit'
);

reset role;

update public.billing_period_usage as usage
set actual_outbound_segments = 10000
from public.workspaces as workspace
where workspace.id = usage.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201';

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Cap launch campaign',
      '[{"body":"Cap check","wait_days_after_previous":null}]'::jsonb,
      '00000000-0000-4000-8000-000000000301',
      array['00000000-0000-4000-8000-000000000404']::uuid[],
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'draft creation remains available at the safety cap'
);
select throws_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Cap launch campaign'),
      1,
      true,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Cap launch campaign')
      )
    )
  $$,
  '55000',
  'The workspace SMS credit safety limit has been reached.',
  'a direct authenticated launch cannot bypass the safety cap'
);

select lives_ok(
  $$
    select public.pause_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
    )
  $$,
  'an active campaign can still be paused at the safety cap'
);
select throws_ok(
  $$
    select public.resume_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
    )
  $$,
  '55000',
  'The workspace SMS credit safety limit has been reached.',
  'a direct authenticated resume cannot bypass the safety cap'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('cap-worker', now())),
  0::bigint,
  'the default 10,000-credit safety cap blocks new reservations'
);

update private.workspace_messaging_controls as control
set safety_cap_segments_override = 10001
from public.workspaces as workspace
where workspace.id = control.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201';

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.resume_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
    )
  $$,
  'an administrator-raised cap permits an explicit resume'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('override-worker', now())),
  1::bigint,
  'a centralized admin override can raise the safety cap without changing included credits'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.delete_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Pending number campaign')
    )
  $$,
  'deleting the capped campaign releases its override-authorized reservation'
);

reset role;

update public.billing_period_usage as usage
set actual_outbound_segments = 0
from public.workspaces as workspace
where workspace.id = usage.workspace_id
  and workspace.owner_id = '00000000-0000-4000-8000-000000000201';

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.save_campaign_draft(
      (select workspace.id from public.workspaces as workspace),
      null,
      'Contact deletion campaign',
      '[{"body":"Will be cancelled","wait_days_after_previous":null}]'::jsonb,
      '00000000-0000-4000-8000-000000000301',
      array['00000000-0000-4000-8000-000000000404']::uuid[],
      p_send_window_start => time '00:00:00',
      p_send_window_end => time '23:59:59.999999',
      p_sending_days => array[1, 2, 3, 4, 5]::integer[]
    )
  $$,
  'a final campaign fixture can be saved'
);
select lives_ok(
  $$
    select public.launch_campaign(
      (select campaign.id from public.campaigns as campaign where campaign.name = 'Contact deletion campaign'),
      1,
      false,
      true,
      public.assess_campaign_launch(
        (select campaign.id from public.campaigns as campaign where campaign.name = 'Contact deletion campaign')
      )
    )
  $$,
  'the final campaign fixture launches'
);

reset role;

select is(
  (select count(*) from public.dispatch_claim_and_reserve_next('delete-contact-worker', now())),
  1::bigint,
  'the contact deletion fixture reserves one estimated credit'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000201';
set local role authenticated;

select lives_ok(
  $$
    select public.soft_delete_contact('00000000-0000-4000-8000-000000000404')
  $$,
  'soft-deleting a contact stops its sequence transactionally'
);
select is(
  (
    select recipient.stop_reason
    from public.campaign_recipients as recipient
    where recipient.contact_id = '00000000-0000-4000-8000-000000000404'
  ),
  'contact_deleted'::text,
  'contact deletion records the stable product stop reason'
);

reset role;

select is(
  (
    select usage.reserved_outbound_segments
    from public.billing_period_usage as usage
    join public.workspaces as workspace on workspace.id = usage.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000000201'
  ),
  0,
  'contact deletion releases its pending reservation without losing history'
);

select * from finish();

rollback;
