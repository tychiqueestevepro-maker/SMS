begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(31);

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
    '00000000-0000-4000-8000-000000000101',
    'authenticated',
    'authenticated',
    'database-test-one@riink.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    'authenticated',
    'authenticated',
    'database-test-two@riink.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

select is(
  (select count(*) from public.profiles where id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102'
  )),
  2::bigint,
  'confirmed users receive profiles'
);
select is(
  (select count(*) from public.workspaces where owner_id in (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102'
  )),
  2::bigint,
  'confirmed users receive one workspace each'
);
select is(
  (
    select count(*)
    from public.pipeline_stages as stage
    join public.workspaces as workspace on workspace.id = stage.workspace_id
    where workspace.owner_id in (
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102'
    )
  ),
  2::bigint,
  'new workspaces receive one pipeline stage'
);
select is(
  (
    select count(*)
    from public.pipeline_stages as stage
    join public.workspaces as workspace on workspace.id = stage.workspace_id
    where workspace.owner_id in (
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102'
    )
      and stage.name = 'New'
      and stage.is_default
  ),
  2::bigint,
  'the initial New stage is the unique default'
);

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000102';
set local role authenticated;

select is(
  (
    select stage.name
    from public.create_contact(
      (select workspace.id from public.workspaces as workspace),
      '+14155550121',
      'US',
      'Second',
      'Workspace',
      'Riink Test',
      '',
      '',
      null::uuid
    ) as contact
    join public.pipeline_stages as stage
      on stage.id = contact.pipeline_stage_id
  ),
  'New'::text,
  'a contact created without a stage uses that workspace default'
);

reset role;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';
set local role authenticated;

select is(
  (select count(*) from public.workspaces),
  1::bigint,
  'workspace RLS hides the other owner workspace'
);
select is(
  (select count(*) from public.contacts),
  0::bigint,
  'contact RLS hides contacts from other workspaces'
);
select is(
  (
    select stage.name
    from public.create_pipeline_stage(
      (select workspace.id from public.workspaces as workspace),
      'Qualified'
    ) as stage
  ),
  'Qualified'::text,
  'an owner can create a pipeline stage'
);
select is(
  (
    select stage.name
    from public.create_pipeline_stage(
      (select workspace.id from public.workspaces as workspace),
      'Won'
    ) as stage
  ),
  'Won'::text,
  'an owner can create another pipeline stage'
);
select lives_ok(
  $$
    select *
    from public.reorder_pipeline_stages(
      (select workspace.id from public.workspaces as workspace),
      array[
        (select stage.id from public.pipeline_stages as stage where stage.name = 'Qualified'),
        (select stage.id from public.pipeline_stages as stage where stage.name = 'New'),
        (select stage.id from public.pipeline_stages as stage where stage.name = 'Won')
      ]::uuid[]
    )
  $$,
  'a complete pipeline reorder succeeds'
);
select is(
  (
    select string_agg(stage.name, ',' order by stage.position)
    from public.pipeline_stages as stage
  ),
  'Qualified,New,Won'::text,
  'pipeline reorder applies every requested position'
);
select is(
  (
    select stage.name
    from public.pipeline_stages as stage
    where stage.is_default
  ),
  'New'::text,
  'pipeline reorder never changes the default stage'
);
select ok(
  (
    select changed_stage.is_default
    from public.set_default_pipeline_stage(
      (select stage.id from public.pipeline_stages as stage where stage.name = 'Qualified')
    ) as changed_stage
  ),
  'set-default marks the requested stage'
);
select is(
  (
    select count(*)
    from public.pipeline_stages as stage
    where stage.is_default and stage.name = 'Qualified'
  ),
  1::bigint,
  'set-default atomically leaves exactly one requested default'
);
select throws_ok(
  $$
    select public.delete_pipeline_stage(
      (select stage.id from public.pipeline_stages as stage where stage.name = 'Qualified'),
      (select stage.id from public.pipeline_stages as stage where stage.name = 'New')
    )
  $$,
  '55000',
  'Choose another default stage before deleting this stage.',
  'the default stage cannot be deleted before replacement'
);
select ok(
  (
    select changed_stage.is_default
    from public.set_default_pipeline_stage(
      (select stage.id from public.pipeline_stages as stage where stage.name = 'New')
    ) as changed_stage
  ),
  'another stage can replace the default'
);
select is(
  (
    select stage.name
    from public.create_contact(
      (select workspace.id from public.workspaces as workspace),
      '+14155550120',
      'US',
      'Alice',
      'Example',
      'Acme',
      '',
      '',
      null::uuid
    ) as contact
    join public.pipeline_stages as stage
      on stage.id = contact.pipeline_stage_id
  ),
  'New'::text,
  'a newly created contact uses the current default stage'
);
select is(
  (
    select stage.name
    from public.move_contact_to_stage(
      (select contact.id from public.contacts as contact where contact.phone_e164 = '+14155550120'),
      (select stage.id from public.pipeline_stages as stage where stage.name = 'Won')
    ) as moved_contact
    join public.pipeline_stages as stage
      on stage.id = moved_contact.pipeline_stage_id
  ),
  'Won'::text,
  'an active contact can move to another pipeline stage'
);
select ok(
  (
    select deleted_contact.deleted_at is not null
    from public.soft_delete_contact(
      (select contact.id from public.contacts as contact where contact.phone_e164 = '+14155550120')
    ) as deleted_contact
  ),
  'contact deletion is a soft delete'
);
select throws_ok(
  $$
    select public.create_contact(
      (select workspace.id from public.workspaces as workspace),
      '+14155550120',
      'US',
      'Duplicate',
      'Contact',
      '',
      '',
      '',
      null::uuid
    )
  $$,
  '23505',
  'A contact with this phone number already exists.',
  'soft-deleted contacts retain permanent phone uniqueness'
);

reset role;

insert into public.suppressions (workspace_id, phone_e164, source)
select workspace.id, '+14155550120', 'database_test'
from public.workspaces as workspace
where workspace.owner_id = '00000000-0000-4000-8000-000000000101';

set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000101';
set local role authenticated;

select is(
  (
    select imported.action
    from public.bulk_upsert_contacts(
      (select workspace.id from public.workspaces as workspace),
      '[{"firstName":"Alicia","lastName":"Example","company":"Acme Updated","phoneE164":"+14155550120","countryCode":"US"}]'::jsonb
    ) as imported
  ),
  'restore'::text,
  'CSV upsert restores a matching soft-deleted contact'
);
select ok(
  (
    select contact.deleted_at is null
      and contact.first_name = 'Alicia'
      and contact.company = 'Acme Updated'
    from public.contacts as contact
    where contact.phone_e164 = '+14155550120'
  ),
  'CSV restoration applies new values and clears deleted_at'
);
select is(
  (
    select stage.name
    from public.contacts as contact
    join public.pipeline_stages as stage on stage.id = contact.pipeline_stage_id
    where contact.phone_e164 = '+14155550120'
  ),
  'Won'::text,
  'CSV restoration preserves the existing pipeline stage'
);
select is(
  (
    select count(*)
    from public.suppressions as suppression
    where suppression.phone_e164 = '+14155550120'
  ),
  1::bigint,
  'CSV restoration never clears an existing suppression'
);
select throws_ok(
  $$
    select public.delete_pipeline_stage(
      (select stage.id from public.pipeline_stages as stage where stage.name = 'Won'),
      null
    )
  $$,
  '23503',
  'Choose a destination stage for the contacts in this stage.',
  'a populated stage requires contact reassignment before deletion'
);
select lives_ok(
  $$
    select public.delete_pipeline_stage(
      (select stage.id from public.pipeline_stages as stage where stage.name = 'Won'),
      (select stage.id from public.pipeline_stages as stage where stage.name = 'New')
    )
  $$,
  'a populated non-default stage can be deleted with reassignment'
);
select is(
  (
    select stage.name
    from public.contacts as contact
    join public.pipeline_stages as stage on stage.id = contact.pipeline_stage_id
    where contact.phone_e164 = '+14155550120'
  ),
  'New'::text,
  'stage deletion reassigns contacts transactionally'
);
select is(
  (select count(*) from public.contacts),
  1::bigint,
  'contact RLS remains isolated after restore and reassignment'
);
select is(
  (
    select imported.action
    from public.bulk_upsert_contacts(
      (select workspace.id from public.workspaces as workspace),
      '[{"firstName":"Should Not Replace","lastName":"Example","company":"Changed","phoneE164":"+14155550120","countryCode":"US"}]'::jsonb
    ) as imported
  ),
  'duplicate'::text,
  'CSV upsert skips an active duplicate'
);
select is(
  (
    select contact.first_name
    from public.contacts as contact
    where contact.phone_e164 = '+14155550120'
  ),
  'Alicia'::text,
  'skipping an active duplicate leaves its values unchanged'
);
select is(
  (
    select count(*)
    from public.pipeline_stages as stage
    where stage.is_default
  ),
  1::bigint,
  'pipeline operations preserve exactly one default stage'
);

select * from finish();

rollback;
