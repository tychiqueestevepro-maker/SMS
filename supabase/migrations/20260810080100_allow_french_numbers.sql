DO $$
BEGIN
    -- Relâcher la contrainte sur les contacts pour accepter tout numéro E.164 (dont la France +33)
    alter table public.contacts drop constraint if exists contacts_phone_e164_us_format;
    alter table public.contacts drop constraint if exists contacts_phone_e164_valid;
    alter table public.contacts add constraint contacts_phone_e164_valid check (phone_e164 ~ '^\+[1-9]\d{1,14}$');

    -- Relâcher la contrainte sur les numéros de l'espace de travail
    alter table public.phone_numbers drop constraint if exists phone_numbers_phone_e164_us_format;
    alter table public.phone_numbers drop constraint if exists phone_numbers_phone_e164_valid;
    alter table public.phone_numbers add constraint phone_numbers_phone_e164_valid check (phone_e164 ~ '^\+[1-9]\d{1,14}$');

    -- Relâcher la contrainte sur les suppressions (opt-out)
    alter table public.suppressions drop constraint if exists suppressions_phone_e164_us_format;
    alter table public.suppressions drop constraint if exists suppressions_phone_e164_valid;
    alter table public.suppressions add constraint suppressions_phone_e164_valid check (phone_e164 ~ '^\+[1-9]\d{1,14}$');
END $$;
