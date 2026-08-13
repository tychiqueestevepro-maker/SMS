SELECT proname, pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname IN ('create_campaign_draft', 'update_campaign_draft', 'save_campaign_draft');
