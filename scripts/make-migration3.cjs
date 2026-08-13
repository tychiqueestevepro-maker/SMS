const fs = require('fs');
const drafts = JSON.parse(fs.readFileSync('scripts/draft-funcs.json', 'utf8'));
let createFn = drafts.rows.find(r => r.proname === 'create_campaign_draft').pg_get_functiondef;
let updateFn = drafts.rows.find(r => r.proname === 'update_campaign_draft').pg_get_functiondef;
let saveFn = drafts.rows.find(r => r.proname === 'save_campaign_draft').pg_get_functiondef;

createFn = createFn.replace('p_phone_number_id uuid DEFAULT NULL::uuid', `p_phone_number_id uuid DEFAULT NULL::uuid,
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2`);
createFn = createFn.replace('name\n  )', `name,
    timezone,
    send_window_start,
    send_window_end,
    drip_interval_minutes
  )`);
createFn = createFn.replace('v_name\n  )', `v_name,
    p_timezone,
    p_send_window_start,
    p_send_window_end,
    p_drip_interval_minutes
  )`);

updateFn = updateFn.replace('p_phone_number_id uuid DEFAULT NULL::uuid', `p_phone_number_id uuid DEFAULT NULL::uuid,
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2`);
updateFn = updateFn.replace('phone_number_id = p_phone_number_id', `phone_number_id = p_phone_number_id,
    timezone = p_timezone,
    send_window_start = p_send_window_start,
    send_window_end = p_send_window_end,
    drip_interval_minutes = p_drip_interval_minutes`);

saveFn = saveFn.replace('p_contact_ids uuid[]', `p_contact_ids uuid[],
  p_timezone text DEFAULT 'UTC'::text,
  p_send_window_start time without time zone DEFAULT '09:00:00'::time without time zone,
  p_send_window_end time without time zone DEFAULT '18:00:00'::time without time zone,
  p_drip_interval_minutes integer DEFAULT 2`);
saveFn = saveFn.replace('p_phone_number_id\n    )', `p_phone_number_id,
      p_timezone,
      p_send_window_start,
      p_send_window_end,
      p_drip_interval_minutes
    )`);
saveFn = saveFn.replace('p_phone_number_id\n    )', `p_phone_number_id,
      p_timezone,
      p_send_window_start,
      p_send_window_end,
      p_drip_interval_minutes
    )`); // inside save_campaign_draft there are 2 calls

fs.writeFileSync('supabase/migrations/20260810060400_campaign_draft_args.sql', createFn + ';\n\n' + updateFn + ';\n\n' + saveFn + ';\n\n');
