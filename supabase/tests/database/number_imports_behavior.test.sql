begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(18);

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
) values (
  '00000000-0000-4000-8000-000000002001',
  'authenticated',
  'authenticated',
  'number-import-test@riink.invalid',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

select is(
  (
    select claim.disposition
    from public.claim_phone_number_import(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002101',
      '+14155552001',
      'US'
    ) as claim
  ),
  'claimed'::text,
  'the first imported number receives a durable claim'
);

select is(
  (
    select started.recorded
    from public.record_phone_number_import_started(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002101',
      'twilio',
      'HR00000000000000000000000000002001',
      'pending-verification',
      'verification',
      '123456'
    ) as started
  ),
  true,
  'provider import start is persisted'
);

select is(
  (
    select context.import_status
    from public.get_phone_number_import_context(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      (select id from public.phone_numbers where phone_e164 = '+14155552001')
    ) as context
  ),
  'verification'::text,
  'the service role can reload import correlation'
);

select is(
  (
    select callback.workspace_id
    from public.get_phone_number_import_callback_context(
      'HR00000000000000000000000000002001'
    ) as callback
  ),
  (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
  'provider callbacks resolve to the correct workspace'
);

select is(
  (
    select updated.updated
    from public.update_phone_number_import_status(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      (select id from public.phone_numbers where phone_e164 = '+14155552001'),
      'active',
      'completed',
      'PN00000000000000000000000000002001',
      null,
      true,
      now()
    ) as updated
  ),
  true,
  'a completed provider order activates the number'
);

select ok(
  (
    select phone_number.status = 'ready'
      and phone_number.number_source = 'imported'
      and phone_number.import_status = 'active'
      and phone_number.activated_at is not null
    from public.phone_numbers as phone_number
    where phone_number.phone_e164 = '+14155552001'
  ),
  'activation exposes only safe product state'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000002001';
set local role authenticated;

select is(
  (
    select detail.verification_code
    from public.get_my_phone_number_import_details() as detail
    where detail.phone_number_id = (
      select id from public.phone_numbers where phone_e164 = '+14155552001'
    )
  ),
  null::text,
  'the owner sees the safe current verification state'
);

reset role;

select is(
  (
    select claim.disposition
    from public.claim_phone_number_import(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002102',
      '+14155552001',
      'US'
    ) as claim
  ),
  'already_started'::text,
  'the same active number cannot start a second import'
);

select is(
  (
    select claim.disposition
    from public.claim_phone_number_import(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002103',
      '+14155552002',
      'US'
    ) as claim
  ),
  'claimed'::text,
  'a second imported number is allowed'
);

select is(
  (
    select claim.disposition
    from public.claim_phone_number_import(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002104',
      '+14155552003',
      'US'
    ) as claim
  ),
  'claimed'::text,
  'a third imported number is allowed'
);

select throws_ok(
  $$
    select * from public.claim_phone_number_import(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      '00000000-0000-4000-8000-000000002105',
      '+14155552004',
      'US'
    )
  $$,
  '23514',
  'This workspace already has three imported phone numbers.',
  'the imported-number allowance is capped at three'
);

select is(
  (
    select disconnect.disposition
    from public.claim_phone_number_import_disconnect(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      (select id from public.phone_numbers where phone_e164 = '+14155552001'),
      '00000000-0000-4000-8000-000000002201'
    ) as disconnect
  ),
  'claimed'::text,
  'an imported number receives a durable disconnect claim'
);

select is(
  (
    select disconnect.completed
    from public.complete_phone_number_import_disconnect(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      (select id from public.phone_numbers where phone_e164 = '+14155552001'),
      '00000000-0000-4000-8000-000000002201'
    ) as disconnect
  ),
  true,
  'provider-confirmed disconnect completes'
);

select ok(
  (
    select phone_number.deleted_at is not null
      and phone_number.status = 'pending'
    from public.phone_numbers as phone_number
    where phone_number.phone_e164 = '+14155552001'
  ),
  'disconnected imports become non-sendable product rows'
);

select is(
  (
    select disconnect.disposition
    from public.claim_phone_number_import_disconnect(
      (select id from public.workspaces where owner_id = '00000000-0000-4000-8000-000000002001'),
      (select id from public.phone_numbers where phone_e164 = '+14155552001'),
      '00000000-0000-4000-8000-000000002202'
    ) as disconnect
  ),
  'already_disconnected'::text,
  'disconnect replay never calls the provider twice'
);

insert into public.phone_numbers (workspace_id, phone_e164, status)
select workspace.id, fixture.phone_e164, 'pending'
from public.workspaces as workspace
cross join (
  values
    ('+14155552101'::text),
    ('+14155552102'::text),
    ('+14155552103'::text)
) as fixture(phone_e164)
where workspace.owner_id = '00000000-0000-4000-8000-000000002001';

select is(
  (
    select count(*)
    from public.phone_numbers as phone_number
    join public.workspaces as workspace on workspace.id = phone_number.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
      and phone_number.number_source = 'included'
      and phone_number.deleted_at is null
  ),
  3::bigint,
  'three Riink numbers are allowed independently of imports'
);

select throws_ok(
  $$
    insert into public.phone_numbers (workspace_id, phone_e164, status)
    select id, '+14155552104', 'pending'
    from public.workspaces
    where owner_id = '00000000-0000-4000-8000-000000002001'
  $$,
  '23514',
  'This workspace already has three Riink phone numbers.',
  'the Riink-number allowance is capped at three'
);

select is(
  (
    select count(*)
    from public.phone_numbers as phone_number
    join public.workspaces as workspace on workspace.id = phone_number.workspace_id
    where workspace.owner_id = '00000000-0000-4000-8000-000000002001'
      and phone_number.deleted_at is null
  ),
  5::bigint,
  'the disconnected import frees one of the six total slots'
);

select * from finish();

rollback;
