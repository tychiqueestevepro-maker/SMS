SELECT proname, pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname IN ('begin_message_dispatch_before_billing_rollover');
