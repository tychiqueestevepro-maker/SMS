/* eslint-disable @typescript-eslint/no-require-imports */
const postgres = require('postgres');

const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function main() {
  const email = 'test@riink.app';

  try {
    console.log("Connecting via PostgreSQL to seed local DB...");

    // 1. Get or create auth user
    let users = await sql`select id from auth.users where email = ${email}`;
    let userId;

    if (users.length === 0) {
      console.log("User not found in auth.users via postgres. Creating user...");
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
      // Update password to password123 and confirm email
      await sql`
        update auth.users 
        set encrypted_password = crypt('password123', gen_salt('bf')), email_confirmed_at = now()
        where id = ${userId}
      `;
    }
    console.log("User ID:", userId);

    // 2. Get or create workspace
    let workspaces = await sql`select id from public.workspaces where owner_id = ${userId}`;
    let workspaceId;

    if (workspaces.length === 0) {
      console.log("Creating workspace...");
      const newWs = await sql`insert into public.workspaces (owner_id) values (${userId}) returning id`;
      workspaceId = newWs[0].id;
    } else {
      workspaceId = workspaces[0].id;
    }
    console.log("Workspace ID:", workspaceId);

    // 3. Ensure pipeline stages
    let stages = await sql`select id from public.pipeline_stages where workspace_id = ${workspaceId}`;
    if (stages.length === 0) {
      console.log("Creating default pipeline stages...");
      await sql`
        insert into public.pipeline_stages (workspace_id, name, position, is_default) values 
          (${workspaceId}, 'Nouveau', 1000, true),
          (${workspaceId}, 'Suivi', 2000, false),
          (${workspaceId}, 'Converti', 3000, false)
      `;
      stages = await sql`select id from public.pipeline_stages where workspace_id = ${workspaceId}`;
    }
    const firstStageId = stages[0].id;

    // 4. Ensure contacts
    let contacts = await sql`select id from public.contacts where workspace_id = ${workspaceId}`;
    if (contacts.length === 0) {
      console.log("Creating 15 mock contacts...");
      const names = [
        "Jean Dupont", "Marie Curie", "Albert Einstein", "Isaac Newton", 
        "Galileo Galilei", "Nikola Tesla", "Ada Lovelace", "Charles Darwin",
        "Louis Pasteur", "Sigmund Freud", "Grace Hopper", "Alan Turing",
        "Stephen Hawking", "Jane Goodall", "Neil Armstrong"
      ];
      for (const name of names) {
        const parts = name.split(" ");
        const phone = `+336${Math.floor(10000000 + Math.random() * 90000000)}`;
        await sql`
          insert into public.contacts (workspace_id, first_name, last_name, phone_e164, country_code, pipeline_stage_id)
          values (${workspaceId}, ${parts[0]}, ${parts[1]}, ${phone}, 'FR', ${firstStageId})
        `;
      }
      contacts = await sql`select id from public.contacts where workspace_id = ${workspaceId}`;
    }
    console.log("Contacts count:", contacts.length);

    // 5. Ensure campaigns
    let campaigns = await sql`select id from public.campaigns where workspace_id = ${workspaceId}`;
    if (campaigns.length === 0) {
      console.log("Creating mock campaigns...");
      await sql`
        insert into public.campaigns (workspace_id, name, status) values
          (${workspaceId}, 'Promotion Été 2026', 'draft'),
          (${workspaceId}, 'Rappel de Rendez-vous', 'draft')
      `;
      campaigns = await sql`select id from public.campaigns where workspace_id = ${workspaceId}`;
    }
    console.log("Campaigns count:", campaigns.length);

    console.log("\n==============================================");
    console.log("SUCCESS! Local test account & mock data ready:");
    console.log("Email: test@riink.app");
    console.log("Password: password123");
    console.log("==============================================");

  } catch (err) {
    console.error("Postgres error:", err);
  } finally {
    await sql.end();
  }
}

main();
