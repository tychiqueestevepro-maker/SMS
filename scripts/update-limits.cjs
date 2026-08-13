const postgres = require('postgres');
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function update() {
  await sql`update public.billing_plans set max_phone_numbers = 6`;
  await sql`update public.billing_periods set max_phone_numbers_snapshot = 6`;
  const plans = await sql`select id, name, max_phone_numbers from public.billing_plans`;
  console.log('Updated Plans:', plans);
  
  // also delete 2 phone numbers so we only have 3 seeded
  // keep 1 US, 1 CA, 1 FR
  const phones = await sql`select id, country_code from public.phone_numbers where deleted_at is null order by created_at desc`;
  
  let usCount = 0;
  let caCount = 0;
  let frCount = 0;
  const toDelete = [];
  
  for (const phone of phones) {
    if (phone.country_code === 'US' && usCount < 1) usCount++;
    else if (phone.country_code === 'US') toDelete.push(phone.id);
    
    if (phone.country_code === 'CA' && caCount < 1) caCount++;
    else if (phone.country_code === 'CA') toDelete.push(phone.id);
    
    if (phone.country_code === 'FR' && frCount < 1) frCount++;
    else if (phone.country_code === 'FR') toDelete.push(phone.id);
  }
  
  if (toDelete.length > 0) {
    await sql`update public.phone_numbers set deleted_at = now() where id = any(${toDelete})`;
    console.log('Deleted extra phone numbers, keeping 3.');
  }

  const count = await sql`select count(*) as n from public.phone_numbers where deleted_at is null`;
  console.log('Active Phone Numbers:', count[0].n);
  
  await sql.end();
}

update().catch(e => { console.error(e); sql.end(); });
