begin;

-- The public plan includes three Riink numbers plus three imported numbers.
update public.billing_plans
set max_phone_numbers = 6
where code = 'riink-v1';

-- Keep legacy inserts and provider completion functions compatible with the
-- country-aware schema. Explicit country codes supplied by current clients
-- are preserved.
create or replace function private.infer_phone_country_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.country_code is null or pg_catalog.btrim(new.country_code) = '' then
    new.country_code := case
      when new.phone_e164 like '+33%' then 'FR'
      when new.phone_e164 ~ '^\+1(204|226|236|249|250|263|289|306|343|365|367|368|403|416|418|431|437|450|468|474|506|514|519|548|579|581|587|604|613|639|647|672|683|705|709|742|753|778|780|807|819|825|867|873|902|905|942)' then 'CA'
      when new.phone_e164 like '+1%' then 'US'
      else 'US'
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists phone_numbers_infer_country_code on public.phone_numbers;
create trigger phone_numbers_infer_country_code
before insert or update of phone_e164, country_code on public.phone_numbers
for each row execute function private.infer_phone_country_code();

drop trigger if exists contacts_infer_country_code on public.contacts;
create trigger contacts_infer_country_code
before insert or update of phone_e164, country_code on public.contacts
for each row execute function private.infer_phone_country_code();

commit;
