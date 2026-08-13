const postgres = require('postgres');
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function check() {
  const plans = await sql`select id, name, max_phone_numbers from public.billing_plans`;
  console.log('Plans:', plans);
  await sql.end();
}

check().catch(e => { console.error(e); sql.end(); });
