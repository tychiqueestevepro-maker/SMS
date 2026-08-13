/* eslint-disable @typescript-eslint/no-require-imports */
const postgres = require('postgres');

const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function main() {
  const users = await sql`select id, email from auth.users`;
  console.log("AUTH USERS:", users);
  const workspaces = await sql`select id, owner_id from public.workspaces`;
  console.log("WORKSPACES:", workspaces);
  const phones = await sql`select id, workspace_id, phone_e164, status, country_code from public.phone_numbers`;
  console.log("PHONE NUMBERS:", phones);
  await sql.end();
}

main();
