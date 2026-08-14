begin;

create or replace function public.admin_get_number_operations(
  p_limit integer default 100
)
returns table (
  number_id uuid,
  phone_number text,
  workspace_id uuid,
  workspace_name text,
  product_status text,
  provider text,
  provider_number_id text,
  provider_status text,
  setup_state text,
  a2p_state text,
  provider_error_code text,
  provider_error_message text,
  account_sid text,
  messaging_service_sid text,
  activation_eligible boolean,
  advanced_opt_out_confirmed boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023',
      message = 'Admin result limit must be between 1 and 1,000.';
  end if;

  return query
  select
    phone_number.id,
    coalesce(
      phone_number.phone_e164,
      release_operation.original_phone_e164
    ),
    phone_number.workspace_id,
    workspace.name,
    case
      when phone_number.deleted_at is not null then 'released'
      else phone_number.status
    end,
    coalesce(detail.provider, case when configured.provider_number_id is not null then 'twilio' end),
    coalesce(detail.provider_number_id, configured.provider_number_id),
    detail.provider_status,
    detail.setup_state,
    detail.a2p_state,
    coalesce(detail.provider_error_code, configured.provider_error_code),
    coalesce(detail.provider_error_message, configured.provider_error_message),
    account.provider_account_id,
    account.messaging_service_id,
    phone_number.deleted_at is null
      and phone_number.status = 'pending'
      and detail.setup_state = 'approved'
      and detail.a2p_state = 'approved'
      and coalesce(account.advanced_opt_out_enabled, false),
    coalesce(account.advanced_opt_out_enabled, false),
    greatest(
      phone_number.updated_at,
      detail.updated_at,
      configured.created_at,
      configured.completed_at
    )
  from public.phone_numbers as phone_number
  join public.workspaces as workspace on workspace.id = phone_number.workspace_id
  left join private.phone_number_provider_details as detail
    on detail.phone_number_id = phone_number.id
  left join private.configured_number_connections as configured
    on configured.phone_number_id = phone_number.id
  left join private.workspace_provider_accounts as account
    on account.workspace_id = phone_number.workspace_id
  left join lateral (
    select operation.original_phone_e164
    from private.phone_number_operations as operation
    where operation.phone_number_id = phone_number.id
      and operation.operation_type = 'release'
    order by operation.created_at desc
    limit 1
  ) as release_operation on true
  order by greatest(
    phone_number.updated_at,
    detail.updated_at,
    configured.created_at,
    configured.completed_at
  ) desc
  limit p_limit;
end;
$$;

revoke all on function public.admin_get_number_operations(integer)
  from public, anon, authenticated;
grant execute on function public.admin_get_number_operations(integer)
  to service_role;

commit;
