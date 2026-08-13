/* eslint-disable @typescript-eslint/no-require-imports */
const postgres = require('postgres');

const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function main() {
  const email = 'test@riink.app';

  try {
    console.log("Seeding rich mock data for local demo...");

    // Update billing plans limit
    await sql`update public.billing_plans set max_phone_numbers = 6`;

    // 1. Get or create auth user
    let users = await sql`select id from auth.users where email = ${email}`;
    let userId;

    if (users.length === 0) {
      const newUsers = await sql`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
        ) values (
          '00000000-0000-0000-0000-000000000000',
          gen_random_uuid(),
          'authenticated',
          'authenticated',
          ${email},
          crypt('password123', gen_salt('bf')),
          now(),
          now(),
          now(),
          '{"provider":"email","providers":["email"]}',
          '{"full_name":"Tychique Esteve"}',
          now(),
          now(),
          '',
          '',
          '',
          ''
        ) returning id
      `;
      userId = newUsers[0].id;
    } else {
      userId = users[0].id;
      await sql`
        update auth.users 
        set encrypted_password = crypt('password123', gen_salt('bf')), email_confirmed_at = now()
        where id = ${userId}
      `;
    }
    console.log("User ID:", userId);

    // 2. Workspace
    let workspaces = await sql`select id from public.workspaces where owner_id = ${userId}`;
    let workspaceId;
    if (workspaces.length === 0) {
      const newWs = await sql`insert into public.workspaces (owner_id) values (${userId}) returning id`;
      workspaceId = newWs[0].id;
    } else {
      workspaceId = workspaces[0].id;
    }
    console.log("Workspace ID:", workspaceId);

    // Update open billing period snapshot to 6
    await sql`
      update public.billing_periods
      set max_phone_numbers_snapshot = 6
      where workspace_id = ${workspaceId}
    `;

    // Clean up existing data in correct FK order
    await sql`delete from public.messages where workspace_id = ${workspaceId}`;
    await sql`delete from public.campaign_recipients where workspace_id = ${workspaceId}`;
    await sql`delete from public.campaign_steps where campaign_id in (select id from public.campaigns where workspace_id = ${workspaceId})`;
    await sql`delete from public.campaigns where workspace_id = ${workspaceId}`;
    await sql`delete from public.suppressions where workspace_id = ${workspaceId}`;
    await sql`delete from public.contacts where workspace_id = ${workspaceId}`;
    await sql`delete from public.phone_numbers where workspace_id = ${workspaceId}`;

    // 3. Phone Numbers: USA 🇺🇸, Canada 🇨🇦, France 🇫🇷
    const phoneData = [
      { phone_e164: '+12025550199', country_code: 'US', status: 'ready' },
      { phone_e164: '+15145550187', country_code: 'CA', status: 'ready' },
      { phone_e164: '+33612345678', country_code: 'FR', status: 'ready' },
    ];

    const insertedPhones = [];
    for (const p of phoneData) {
      const inserted = await sql`
        insert into public.phone_numbers (workspace_id, phone_e164, country_code, status)
        values (${workspaceId}, ${p.phone_e164}, ${p.country_code}, ${p.status})
        returning id, phone_e164, country_code
      `;
      insertedPhones.push(inserted[0]);
    }
    console.log(`Inserted ${insertedPhones.length} phone numbers across US 🇺🇸, CA 🇨🇦, FR 🇫🇷.`);

    // 4. Pipeline Stages
    let stages = await sql`select id from public.pipeline_stages where workspace_id = ${workspaceId}`;
    if (stages.length === 0) {
      await sql`
        insert into public.pipeline_stages (workspace_id, name, position, is_default) values 
          (${workspaceId}, 'Nouveau', 1000, true),
          (${workspaceId}, 'Suivi', 2000, false),
          (${workspaceId}, 'Converti', 3000, false)
      `;
      stages = await sql`select id from public.pipeline_stages where workspace_id = ${workspaceId}`;
    }
    const firstStageId = stages[0].id;

    // 5. Contacts
    const contactList = [
      { first_name: 'Sarah', last_name: 'Mitchell', company: 'Acme Corp', phone_e164: '+12025550101', country_code: 'US' },
      { first_name: 'Daniel', last_name: 'Foster', company: 'Beta Solutions', phone_e164: '+12025550102', country_code: 'US' },
      { first_name: 'Melissa', last_name: 'Clark', company: 'Brightstone Inc.', phone_e164: '+12025550103', country_code: 'US' },
      { first_name: 'James', last_name: 'Lee', company: 'NorthEdge', phone_e164: '+12025550104', country_code: 'US' },
      { first_name: 'Rachel', last_name: 'Lopez', company: 'Summit Partners', phone_e164: '+12025550105', country_code: 'US' },
      { first_name: 'Jean', last_name: 'Dupont', company: 'TechFR', phone_e164: '+33612345679', country_code: 'FR' },
      { first_name: 'Marie', last_name: 'Curie', company: 'Institut Curie', phone_e164: '+33612345680', country_code: 'FR' },
      { first_name: 'Albert', last_name: 'Einstein', company: 'Princeton', phone_e164: '+12025550106', country_code: 'US' },
      { first_name: 'Nikola', last_name: 'Tesla', company: 'Wardenclyffe', phone_e164: '+12025550107', country_code: 'US' },
      { first_name: 'Ada', last_name: 'Lovelace', company: 'Analytical Co', phone_e164: '+12025550108', country_code: 'US' },
    ];

    const insertedContacts = [];
    for (const c of contactList) {
      const inserted = await sql`
        insert into public.contacts (workspace_id, first_name, last_name, company, phone_e164, country_code, pipeline_stage_id)
        values (${workspaceId}, ${c.first_name}, ${c.last_name}, ${c.company}, ${c.phone_e164}, ${c.country_code}, ${firstStageId})
        returning id, first_name, last_name, phone_e164
      `;
      insertedContacts.push(inserted[0]);
    }
    console.log(`Inserted ${insertedContacts.length} contacts.`);

    // 6. Suppressions (Opted-out contact)
    await sql`
      insert into public.suppressions (workspace_id, phone_e164)
      values (${workspaceId}, ${insertedContacts[4].phone_e164})
    `;

    // 7. Campaigns
    const usPhoneId = insertedPhones[0].id;
    const caPhoneId = insertedPhones[1].id;
    const frPhoneId = insertedPhones[2].id;

    const campaignList = [
      { name: 'Promotion Été 2026', status: 'active', phone_number_id: frPhoneId },
      { name: 'Rappel de Rendez-vous', status: 'active', phone_number_id: usPhoneId },
      { name: 'US Staffing Outreach', status: 'draft', phone_number_id: usPhoneId },
      { name: 'Founder Outreach Canada', status: 'draft', phone_number_id: caPhoneId },
      { name: 'Relance Inactifs Q3', status: 'paused', phone_number_id: frPhoneId },
    ];

    const insertedCampaigns = [];
    for (const camp of campaignList) {
      const inserted = await sql`
        insert into public.campaigns (workspace_id, name, status, phone_number_id, timezone, send_window_start, send_window_end, drip_interval_minutes)
        values (${workspaceId}, ${camp.name}, ${camp.status}, ${camp.phone_number_id}, 'UTC', '09:00:00', '18:00:00', 2)
        returning id, name, status
      `;
      insertedCampaigns.push(inserted[0]);
    }
    console.log(`Inserted ${insertedCampaigns.length} campaigns.`);

    // 8. Campaign Steps
    for (const camp of insertedCampaigns) {
      await sql`
        insert into public.campaign_steps (campaign_id, step_order, body, wait_days_after_previous)
        values
          (${camp.id}, 1, 'Bonjour {{first_name}} ! Profitez de notre offre spéciale.', 0),
          (${camp.id}, 2, 'Dernière chance {{first_name}} ! Offre expire bientôt.', 2)
      `;
    }

    // 9. Recipients & Messages for active campaign 1 ("Promotion Été 2026")
    const activeCamp1 = insertedCampaigns[0];
    const activeCamp2 = insertedCampaigns[1];

    for (let i = 0; i < 5; i++) {
      const contact = insertedContacts[i];
      const isReplied = i === 0 || i === 1;

      const rec = await sql`
        insert into public.campaign_recipients (workspace_id, campaign_id, contact_id, state, next_send_at, replied_at, stop_reason, stopped_at)
        values (
          ${workspaceId},
          ${activeCamp1.id},
          ${contact.id},
          ${isReplied ? 'stopped' : 'active'},
          ${isReplied ? null : '2026-08-12 10:00:00+00'},
          ${isReplied ? '2026-08-11 11:21:00+00' : null},
          ${isReplied ? 'reply' : null},
          ${isReplied ? '2026-08-11 11:21:00+00' : null}
        )
        returning id
      `;

      const recipientId = rec[0].id;

      // Outbound Message
      await sql`
        insert into public.messages (
          workspace_id, campaign_id, campaign_recipient_id, step_order, contact_id, phone_number_id, direction, body, dispatch_state, delivery_state, created_at
        ) values (
          ${workspaceId},
          ${activeCamp1.id},
          ${recipientId},
          1,
          ${contact.id},
          ${frPhoneId},
          'outbound',
          'Bonjour ' || ${contact.first_name} || ', c''est le moment de profiter de nos offres !',
          'accepted',
          'delivered',
          now() - interval '4 hours'
        )
      `;

      // Inbound Messages if replied
      if (i === 0) {
        // Sarah Mitchell replied
        await sql`
          insert into public.messages (
            workspace_id, contact_id, phone_number_id, direction, body, dispatch_state, delivery_state, created_at, received_at
          ) values (
            ${workspaceId},
            ${contact.id},
            ${frPhoneId},
            'inbound',
            'Sounds interesting! We are definitely exploring new staffing partners. Can you share more details about your process and pricing?',
            'accepted',
            'delivered',
            now() - interval '2 hours',
            now() - interval '2 hours'
          )
        `;
      } else if (i === 1) {
        // Daniel Foster replied
        await sql`
          insert into public.messages (
            workspace_id, contact_id, phone_number_id, direction, body, dispatch_state, delivery_state, created_at, received_at
          ) values (
            ${workspaceId},
            ${contact.id},
            ${frPhoneId},
            'inbound',
            'Do you have availability for a quick call next week?',
            'accepted',
            'delivered',
            now() - interval '3 hours',
            now() - interval '3 hours'
          )
        `;
      } else if (i === 3) {
        // James Lee auto reply
        await sql`
          insert into public.messages (
            workspace_id, contact_id, phone_number_id, direction, body, dispatch_state, delivery_state, created_at, received_at
          ) values (
            ${workspaceId},
            ${contact.id},
            ${frPhoneId},
            'inbound',
            'Auto-reply: Out of office until Monday.',
            'accepted',
            'delivered',
            now() - interval '1 day',
            now() - interval '1 day'
          )
        `;
      }
    }

    // Also populate activeCamp2 recipients
    for (let i = 5; i < 9; i++) {
      const contact = insertedContacts[i];
      const rec = await sql`
        insert into public.campaign_recipients (workspace_id, campaign_id, contact_id, state, next_send_at, replied_at)
        values (
          ${workspaceId},
          ${activeCamp2.id},
          ${contact.id},
          'active',
          '2026-08-12 11:00:00+00',
          null
        )
        returning id
      `;

      await sql`
        insert into public.messages (
          workspace_id, campaign_id, campaign_recipient_id, step_order, contact_id, phone_number_id, direction, body, dispatch_state, delivery_state, created_at
        ) values (
          ${workspaceId},
          ${activeCamp2.id},
          ${rec[0].id},
          1,
          ${contact.id},
          ${usPhoneId},
          'outbound',
          'Bonjour ' || ${contact.first_name} || ', n''oubliez pas votre rendez-vous demain.',
          'accepted',
          'delivered',
          now() - interval '5 hours'
        )
      `;
    }

    console.log("\n==============================================");
    console.log("DEMO SEEDING COMPLETED SUCCESSFULLY!");
    console.log("Mock data created:");
    console.log(" - 3 Phone Numbers (USA 🇺🇸, Canada 🇨🇦, France 🇫🇷 flags)");
    console.log(" - 10 Contacts");
    console.log(" - 5 Campaigns");
    console.log(" - Live Inbound & Outbound SMS Conversations with replies");
    console.log("==============================================");

  } catch (err) {
    console.error("Seeding error:", err);
  } finally {
    await sql.end();
  }
}

main();
