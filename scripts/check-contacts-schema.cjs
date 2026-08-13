const postgres = require('postgres');
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function check() {
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'contacts'
  `;
  console.log('Contacts Columns:', cols.map(c => c.column_name).join(', '));
  
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(c.oid)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE conname = 'contacts_phone_e164_us_format' OR conrelid = 'public.contacts'::regclass
  `;
  console.log('Contacts Constraints:', constraints);
  await sql.end();
}

check().catch(e => { console.error(e); sql.end(); });
