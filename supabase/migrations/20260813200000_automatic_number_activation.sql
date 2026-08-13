begin;

-- A purchased number must become usable without an operator impersonating an
-- administrator. The claim is durable so Stripe is never called before the
-- completed provider purchase has been correlated to the workspace and number.
create table private.automatic_phone_number_activations (
  activation_id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers (id) on delete cascade,
  state text not null default 'claimed',
  failure_code text,
  requested_at timestamptz not null,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automatic_phone_number_activations_state_valid check (
    state in ('claimed', 'completed', 'failed')
  ),
  constraint automatic_phone_number_activations_terminal_shape check (
    (
      state = 'claimed'
      and completed_at is null
      and failed_at is null
      and failure_code is null
    )
    or (
      state = 'completed'
      and completed_at is not null
      and failed_at is null
      and failure_code is null
    )
    or (
      state = 'failed'
      and completed_at is null
      and failed_at is not null
      and failure_code is not null
    )
  )
);

create unique index automatic_phone_number_activation_one_open_idx
  on private.automatic_phone_number_activations (phone_number_id)
  where state = 'claimed';

create index automatic_phone_number_activation_workspace_requested_idx
  on private.automatic_phone_number_activations (workspace_id, requested_at desc);

create trigger automatic_phone_number_activations_touch_updated_at
before update on private.automatic_phone_number_activations
for each row execute function private.touch_updated_at();

create or replace function public.claim_automatic_number_activation(
  p_workspace_id uuid,
  p_number_id uuid,
  p_requested_at timestamptz
)
returns table (
  activation_id uuid,
  disposition text,
  number_id uuid,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation private.automatic_phone_number_activations;
  v_detail private.phone_number_provider_details;
  v_operation private.phone_number_operations;
  v_phone public.phone_numbers;
begin
  if p_workspace_id is null or p_number_id is null or p_requested_at is null then
    raise exception using errcode = '22023', message = 'Invalid automatic number activation request.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Workspace not found.';
  end if;

  select phone.*
  into v_phone
  from public.phone_numbers as phone
  where phone.id = p_number_id
    and phone.workspace_id = p_workspace_id
  for update;

  if not found or v_phone.deleted_at is not null then
    raise exception using errcode = 'P0002', message = 'Phone number not found.';
  end if;

  if v_phone.status = 'ready' then
    return query select null::uuid, 'already_ready'::text, v_phone.id, v_phone.workspace_id;
    return;
  end if;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = p_number_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.workspace_id = p_workspace_id
    and operation.phone_number_id = p_number_id
    and operation.operation_type = 'purchase'
  order by operation.created_at desc
  limit 1
  for update;

  if v_phone.status <> 'pending'
    or v_detail.phone_number_id is null
    or v_detail.setup_state <> 'purchased'
    or v_detail.provider_number_id is null
    or v_operation.operation_id is null
    or v_operation.state <> 'completed'
    or v_operation.provider is distinct from v_detail.provider
    or v_operation.provider_number_id is distinct from v_detail.provider_number_id
    or not exists (
      select 1
      from private.workspace_provider_accounts as account
      where account.workspace_id = p_workspace_id
        and account.provider = v_detail.provider
        and account.setup_state = 'ready'
        and account.messaging_service_id is not null
    )
  then
    return query select null::uuid, 'provider_not_ready'::text, v_phone.id, v_phone.workspace_id;
    return;
  end if;

  select activation.*
  into v_activation
  from private.automatic_phone_number_activations as activation
  where activation.phone_number_id = p_number_id
    and activation.state = 'claimed'
  for update;

  if found and v_activation.requested_at > p_requested_at - interval '15 minutes' then
    return query select v_activation.activation_id, 'in_progress'::text, v_phone.id, v_phone.workspace_id;
    return;
  end if;

  if found then
    update private.automatic_phone_number_activations as activation
    set
      state = 'failed',
      failure_code = 'stale_reclaimed',
      failed_at = p_requested_at
    where activation.activation_id = v_activation.activation_id;
  end if;

  insert into private.automatic_phone_number_activations (
    workspace_id,
    phone_number_id,
    requested_at
  )
  values (p_workspace_id, p_number_id, p_requested_at)
  returning * into v_activation;

  return query select v_activation.activation_id, 'claimed'::text, v_phone.id, v_phone.workspace_id;
end;
$$;

create or replace function public.complete_automatic_number_activation(
  p_activation_id uuid,
  p_completed_at timestamptz,
  p_number_id uuid,
  p_period_end timestamptz,
  p_period_start timestamptz,
  p_subscription_id text,
  p_workspace_id uuid
)
returns table (
  activated boolean,
  activation_id uuid,
  number_id uuid,
  product_status text,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account private.workspace_billing_accounts;
  v_activation private.automatic_phone_number_activations;
  v_detail private.phone_number_provider_details;
  v_operation private.phone_number_operations;
  v_phone public.phone_numbers;
begin
  if p_activation_id is null
    or p_completed_at is null
    or p_period_start is null
    or p_period_end is null
    or p_period_end <= p_period_start
    or pg_catalog.btrim(coalesce(p_subscription_id, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Invalid automatic number activation completion.';
  end if;

  perform 1
  from public.workspaces as workspace
  where workspace.id = p_workspace_id
  for update;

  select activation.*
  into v_activation
  from private.automatic_phone_number_activations as activation
  where activation.activation_id = p_activation_id
    and activation.workspace_id = p_workspace_id
    and activation.phone_number_id = p_number_id
  for update;

  select phone.*
  into v_phone
  from public.phone_numbers as phone
  where phone.id = p_number_id
    and phone.workspace_id = p_workspace_id
  for update;

  select detail.*
  into v_detail
  from private.phone_number_provider_details as detail
  where detail.phone_number_id = p_number_id
  for update;

  select operation.*
  into v_operation
  from private.phone_number_operations as operation
  where operation.workspace_id = p_workspace_id
    and operation.phone_number_id = p_number_id
    and operation.operation_type = 'purchase'
  order by operation.created_at desc
  limit 1
  for update;

  select account.*
  into v_account
  from private.workspace_billing_accounts as account
  where account.workspace_id = p_workspace_id
  for update;

  if v_activation.state = 'completed' and v_phone.status = 'ready' then
    return query select true, p_activation_id, p_number_id, 'ready'::text, p_workspace_id;
    return;
  end if;

  if v_activation.activation_id is null
    or v_activation.state <> 'claimed'
    or v_phone.id is null
    or v_phone.deleted_at is not null
    or v_phone.status <> 'pending'
    or v_detail.phone_number_id is null
    or v_detail.setup_state <> 'purchased'
    or v_operation.operation_id is null
    or v_operation.state <> 'completed'
    or v_operation.provider is distinct from v_detail.provider
    or v_operation.provider_number_id is distinct from v_detail.provider_number_id
    or not exists (
      select 1
      from private.workspace_provider_accounts as provider_account
      where provider_account.workspace_id = p_workspace_id
        and provider_account.provider = v_detail.provider
        and provider_account.setup_state = 'ready'
        and provider_account.messaging_service_id is not null
    )
    or v_account.workspace_id is null
    or v_account.subscription_status <> 'active'
    or v_account.terminal_at is not null
    or v_account.stripe_subscription_id is distinct from p_subscription_id
    or v_account.current_period_start is distinct from p_period_start
    or v_account.current_period_end is distinct from p_period_end
    or not exists (
      select 1
      from public.billing_periods as period
      join private.billing_period_provider_details as period_detail
        on period_detail.billing_period_id = period.id
      where period.workspace_id = p_workspace_id
        and period.status = 'open'
        and not period.is_provisional
        and period.period_start = p_period_start
        and period.period_end = p_period_end
        and period_detail.subscription_id = p_subscription_id
    )
  then
    raise exception using errcode = '55000', message = 'Automatic number activation prerequisites are not satisfied.';
  end if;

  update public.phone_numbers
  set
    status = 'ready',
    activated_at = p_completed_at
  where id = p_number_id;

  update private.phone_number_provider_details
  set
    setup_state = 'ready',
    provider_status = 'ready',
    a2p_state = coalesce(a2p_state, 'provider_confirmed'),
    provider_error_code = null,
    provider_error_message = null
  where phone_number_id = p_number_id;

  update private.automatic_phone_number_activations as activation
  set
    state = 'completed',
    completed_at = p_completed_at
  where activation.activation_id = p_activation_id;

  insert into private.phone_number_setup_history (
    workspace_id,
    phone_number_id,
    previous_state,
    next_state,
    provider_status,
    a2p_state,
    changed_at
  )
  values (
    p_workspace_id,
    p_number_id,
    'purchased',
    'ready',
    'ready',
    coalesce(v_detail.a2p_state, 'provider_confirmed'),
    p_completed_at
  );

  update private.workspace_messaging_controls as control
  set
    messaging_enabled = true,
    suspension_reason = null
  where control.workspace_id = p_workspace_id;

  return query select true, p_activation_id, p_number_id, 'ready'::text, p_workspace_id;
end;
$$;

create or replace function public.fail_automatic_number_activation(
  p_activation_id uuid,
  p_failed_at timestamptz,
  p_failure_code text,
  p_number_id uuid,
  p_workspace_id uuid
)
returns table (
  activation_id uuid,
  number_id uuid,
  recorded boolean,
  workspace_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activation private.automatic_phone_number_activations;
begin
  if p_activation_id is null
    or p_failed_at is null
    or pg_catalog.btrim(coalesce(p_failure_code, '')) = ''
  then
    raise exception using errcode = '22023', message = 'Invalid automatic number activation failure.';
  end if;

  select activation.*
  into v_activation
  from private.automatic_phone_number_activations as activation
  where activation.activation_id = p_activation_id
    and activation.workspace_id = p_workspace_id
    and activation.phone_number_id = p_number_id
  for update;

  if not found then
    return query select p_activation_id, p_number_id, false, p_workspace_id;
    return;
  end if;

  if v_activation.state = 'failed' then
    return query select p_activation_id, p_number_id, true, p_workspace_id;
    return;
  end if;

  if v_activation.state <> 'claimed' then
    return query select p_activation_id, p_number_id, false, p_workspace_id;
    return;
  end if;

  update private.automatic_phone_number_activations as activation
  set
    state = 'failed',
    failure_code = pg_catalog.left(pg_catalog.btrim(p_failure_code), 200),
    failed_at = p_failed_at
  where activation.activation_id = p_activation_id;

  return query select p_activation_id, p_number_id, true, p_workspace_id;
end;
$$;

revoke all on table private.automatic_phone_number_activations
  from public, anon, authenticated;
revoke all on function public.claim_automatic_number_activation(uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.complete_automatic_number_activation(
  uuid, timestamptz, uuid, timestamptz, timestamptz, text, uuid
) from public, anon, authenticated;
revoke all on function public.fail_automatic_number_activation(
  uuid, timestamptz, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.claim_automatic_number_activation(uuid, uuid, timestamptz)
  to service_role;
grant execute on function public.complete_automatic_number_activation(
  uuid, timestamptz, uuid, timestamptz, timestamptz, text, uuid
) to service_role;
grant execute on function public.fail_automatic_number_activation(
  uuid, timestamptz, text, uuid, uuid
) to service_role;

commit;
