begin;

create extension if not exists pgtap;

set local search_path = public, extensions;

select plan(23);

select has_column('public', 'phone_numbers', 'number_source', 'number source is product-visible');
select has_column('public', 'phone_numbers', 'import_status', 'import status is product-visible');
select has_column('public', 'phone_numbers', 'activated_at', 'activation time is product-visible');
select has_table('private', 'phone_number_imports', 'provider import state is private');
select has_column('private', 'phone_number_imports', 'provider_import_id', 'provider order correlation is private');
select has_column('private', 'phone_number_imports', 'verification_code', 'verification material is private');

select ok(to_regprocedure('public.claim_phone_number_import(uuid,uuid,text,text)') is not null, 'import claim RPC exists');
select ok(to_regprocedure('public.record_phone_number_import_started(uuid,uuid,text,text,text,text,text)') is not null, 'import start RPC exists');
select ok(to_regprocedure('public.mark_phone_number_import_unknown(uuid,uuid,text,text,text)') is not null, 'import ambiguity RPC exists');
select ok(to_regprocedure('public.get_phone_number_import_context(uuid,uuid)') is not null, 'import context RPC exists');
select ok(to_regprocedure('public.get_phone_number_import_callback_context(text)') is not null, 'callback context RPC exists');
select ok(to_regprocedure('public.update_phone_number_import_status(uuid,uuid,text,text,text,text,boolean,timestamptz)') is not null, 'import update RPC exists');
select ok(to_regprocedure('public.claim_phone_number_import_disconnect(uuid,uuid,uuid)') is not null, 'disconnect claim RPC exists');
select ok(to_regprocedure('public.complete_phone_number_import_disconnect(uuid,uuid,uuid)') is not null, 'disconnect completion RPC exists');
select ok(to_regprocedure('public.mark_phone_number_import_disconnect_unknown(uuid,uuid,uuid,text,text,text)') is not null, 'disconnect ambiguity RPC exists');
select ok(to_regprocedure('public.get_my_phone_number_import_details()') is not null, 'workspace import detail RPC exists');

select ok(pg_catalog.has_function_privilege('service_role', 'public.claim_phone_number_import(uuid,uuid,text,text)', 'EXECUTE'), 'service role can claim imports');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.claim_phone_number_import(uuid,uuid,text,text)', 'EXECUTE'), 'workspace users cannot claim imports directly');
select ok(pg_catalog.has_function_privilege('service_role', 'public.update_phone_number_import_status(uuid,uuid,text,text,text,text,boolean,timestamptz)', 'EXECUTE'), 'service role can persist provider status');
select ok(not pg_catalog.has_function_privilege('authenticated', 'public.update_phone_number_import_status(uuid,uuid,text,text,text,text,boolean,timestamptz)', 'EXECUTE'), 'workspace users cannot forge provider status');
select ok(pg_catalog.has_function_privilege('authenticated', 'public.get_my_phone_number_import_details()', 'EXECUTE'), 'workspace users can read their safe import details');
select ok(not pg_catalog.has_table_privilege('authenticated', 'private.phone_number_imports', 'SELECT'), 'workspace users cannot read private import rows');
select ok(not pg_catalog.has_table_privilege('anon', 'private.phone_number_imports', 'SELECT'), 'anonymous users cannot read private import rows');

select * from finish();

rollback;
