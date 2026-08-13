SELECT proname, pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname IN ('authorize_message_dispatch', 'reserve_due_campaign_messages', 'launch_campaign', 'is_within_workspace_send_window');
