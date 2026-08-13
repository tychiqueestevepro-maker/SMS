-- Allow authenticated owners to update specific contact fields
create policy contacts_owner_update
  on public.contacts
  for update
  to authenticated
  using (
    workspace_id in (
      select id
      from public.workspaces
      where owner_id = auth.uid()
    )
  );

grant update (notes, deleted_at, has_unread_messages)
  on table public.contacts
  to authenticated;
