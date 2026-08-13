const fs = require('fs');
const f1 = JSON.parse(fs.readFileSync('scripts/funcs.json'));
const f3 = JSON.parse(fs.readFileSync('scripts/funcs3.json'));

let out = `ALTER TABLE public.campaigns 
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC', 
  ADD COLUMN send_window_start time NOT NULL DEFAULT time '09:00:00', 
  ADD COLUMN send_window_end time NOT NULL DEFAULT time '18:00:00', 
  ADD COLUMN drip_interval_minutes integer NOT NULL DEFAULT 0, 
  ADD CONSTRAINT campaigns_send_window_valid CHECK (send_window_start < send_window_end), 
  ADD CONSTRAINT campaigns_drip_valid CHECK (drip_interval_minutes >= 0);\n\n`;

out += `ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_phone_e164_valid;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_phone_e164_valid CHECK (phone_e164 ~ '^\\\\+[1-9]\\\\d{9,14}$');

ALTER TABLE public.phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_phone_e164_valid;
ALTER TABLE public.phone_numbers ADD CONSTRAINT phone_numbers_phone_e164_valid CHECK (phone_e164 ~ '^\\\\+[1-9]\\\\d{9,14}$');

ALTER TABLE public.suppressions DROP CONSTRAINT IF EXISTS suppressions_phone_e164_valid;
ALTER TABLE public.suppressions ADD CONSTRAINT suppressions_phone_e164_valid CHECK (phone_e164 ~ '^\\\\+[1-9]\\\\d{9,14}$');\n\n`;

out += `DROP FUNCTION IF EXISTS private.is_within_workspace_send_window(uuid, timestamp with time zone);\n
CREATE OR REPLACE FUNCTION private.is_within_campaign_send_window(p_campaign_id uuid, p_at timestamp with time zone) 
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' 
AS $$ 
  select (p_at at time zone campaign.timezone)::time >= campaign.send_window_start and (p_at at time zone campaign.timezone)::time < campaign.send_window_end 
  from public.campaigns as campaign where campaign.id = p_campaign_id; 
$$;\n\n`;

let launch_campaign = f1.rows[0].pg_get_functiondef;
// modify launch_campaign to stagger next_send_at
launch_campaign = launch_campaign.replace(
  /1,\s*v_now,\s*v_now\s*from pg_catalog\.jsonb_array_elements_text\(\s*v_assessment\s*->\s*'eligible_contact_ids'\s*\)\s*as eligible\(value\);/g,
  `1,
    v_now + ((row_number() over() - 1) * v_campaign.drip_interval_minutes * interval '1 minute'),
    v_now
  from pg_catalog.jsonb_array_elements_text(
    v_assessment -> 'eligible_contact_ids'
  ) as eligible(value);`
);
out += launch_campaign + ';\n\n';

let reserve_msg = f1.rows[2].pg_get_functiondef;
reserve_msg = reserve_msg.replace(
  /private\.is_within_workspace_send_window\(\s*recipient\.workspace_id,\s*p_now\s*\)/g,
  `private.is_within_campaign_send_window(recipient.campaign_id, p_now)`
);
out += reserve_msg + ';\n\n';

let auth_msg = f3.rows[0].pg_get_functiondef;
auth_msg = auth_msg.replace(
  /if not private\.is_within_workspace_send_window\(v_workspace_id, p_now\) then/g,
  `if not private.is_within_campaign_send_window(v_campaign.id, p_now) then`
);
out += auth_msg + ';\n\n';

fs.writeFileSync('supabase/migrations/20260810060200_campaign_sending_rules.sql', out);
