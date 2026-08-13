const postgres = require('postgres');
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });

async function check() {
  const plans = await sql`select id, name, max_phone_numbers from public.billing_plans`;
  console.log('Plans:', plans);
  
  const periods = await sql`select workspace_id, status, max_phone_numbers_snapshot from public.billing_periods`;
  console.log('Billing Periods:', periods);
  
  const count = await sql`select count(*) as n from public.phone_numbers where deleted_at is null`;
  console.log('Active Phone Numbers count:', count[0].n);
  
  // Check if user can add more numbers
  const workspaceId = '77840640-0bf9-472a-81cf-1e5cb56a5b9e';
  const limit = await sql`
    select coalesce(period.max_phone_numbers_snapshot, plan.max_phone_numbers) as effective_limit
    from public.workspaces as workspace
    join public.billing_plans as plan on plan.id = workspace.billing_plan_id
    left join public.billing_periods as period
      on period.workspace_id = workspace.id and period.status = 'open'
    where workspace.id = ${workspaceId}
  `;
  console.log('Effective limit for workspace:', limit[0]);
  
  await sql.end();
}

check().catch(async (e) => { console.error(e); await sql.end(); });
