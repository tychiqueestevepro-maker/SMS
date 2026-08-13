const fs = require('fs');
const f1 = JSON.parse(fs.readFileSync('scripts/funcs.json'));

let launch_campaign = f1.rows[0].pg_get_functiondef;
// It originally has:
// 1,
// v_now,
// v_now
// from pg_catalog.jsonb_array_elements_text(
//   v_assessment -> 'eligible_contact_ids'
// ) as eligible(value);

launch_campaign = launch_campaign.replace(
  /1,\s*v_now,\s*v_now\s*from pg_catalog\.jsonb_array_elements_text\(\s*v_assessment\s*->\s*'eligible_contact_ids'\s*\)\s*as eligible\(value\);/g,
  `1,
    scheduled.drip_time,
    v_now
  from pg_catalog.jsonb_array_elements_text(v_assessment -> 'eligible_contact_ids') with ordinality as eligible(value, idx)
  join private.generate_campaign_drip_schedule(v_now, (v_assessment ->> 'eligible_recipient_count')::integer, v_campaign.timezone, v_campaign.send_window_start, v_campaign.send_window_end, v_campaign.drip_interval_minutes) with ordinality as scheduled(drip_time, idx) on eligible.idx = scheduled.idx;`
);

fs.appendFileSync('supabase/migrations/20260810060300_campaign_drip_scheduler.sql', '\n' + launch_campaign + ';\n');
