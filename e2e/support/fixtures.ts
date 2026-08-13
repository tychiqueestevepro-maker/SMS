import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

export const E2E_USERS = {
  standard: {
    email: "playwright.standard@riink.test",
    password: "Riink-E2E-Standard-2026!",
  },
  largeCampaign: {
    email: "playwright.large-campaign@riink.test",
    password: "Riink-E2E-Large-2026!",
  },
} as const;

type FixtureUser = (typeof E2E_USERS)[keyof typeof E2E_USERS];

function requiredEnvironment(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value?.trim()) throw new Error(`${name} is required for Riink E2E fixtures.`);
  return value.trim();
}

function fixtureConfiguration() {
  const url = requiredEnvironment("E2E_SUPABASE_URL", "SUPABASE_URL");
  const databaseUrl = requiredEnvironment("E2E_DATABASE_URL");
  const serviceRoleKey = requiredEnvironment(
    "E2E_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const hostname = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
    throw new Error("Riink E2E fixtures refuse to run against a non-loopback Supabase URL.");
  }
  const databaseHostname = new URL(databaseUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(databaseHostname)) {
    throw new Error("Riink E2E fixtures refuse to run against a non-loopback database URL.");
  }
  return { databaseUrl, serviceRoleKey, url };
}

export function fixtureAdminClient(): SupabaseClient {
  const { serviceRoleKey, url } = fixtureConfiguration();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function fixtureDatabase() {
  const { databaseUrl } = fixtureConfiguration();
  // Product tables intentionally do not grant direct access to service_role.
  // E2E therefore seeds through PostgreSQL, but only after both URLs pass the
  // loopback guards above. This never changes production grants or RLS.
  return postgres(databaseUrl, { max: 1 });
}

export async function removeFixtureUsers(): Promise<void> {
  const database = fixtureDatabase();
  try {
    await database`
      delete from public.campaign_draft_contacts
      where campaign_id in (
        select campaign.id
        from public.campaigns as campaign
        join public.workspaces as workspace on workspace.id = campaign.workspace_id
        join auth.users as fixture_user on fixture_user.id = workspace.owner_id
        where fixture_user.email in (${E2E_USERS.standard.email}, ${E2E_USERS.largeCampaign.email})
      )
    `;
    await database`
      delete from auth.users
      where email in (${E2E_USERS.standard.email}, ${E2E_USERS.largeCampaign.email})
    `;
  } finally {
    await database.end();
  }
}

async function createFixtureUser(
  client: SupabaseClient,
  database: ReturnType<typeof postgres>,
  fixture: FixtureUser,
  workspaceName: string,
): Promise<{ userId: string; workspaceId: string; stageId: string }> {
  const { data, error } = await client.auth.admin.createUser({
    email: fixture.email,
    email_confirm: true,
    password: fixture.password,
    user_metadata: { full_name: "Riink Playwright", workspace_name: workspaceName },
  });
  if (error || !data.user) throw error ?? new Error("Fixture user was not created.");

  const [workspace] = await database<{ id: string }[]>`
    select id
    from public.workspaces
    where owner_id = ${data.user.id}::uuid
  `;
  if (!workspace) throw new Error("Fixture workspace was not provisioned.");

  const [stage] = await database<{ id: string }[]>`
    select id
    from public.pipeline_stages
    where workspace_id = ${workspace.id}::uuid
      and is_default
  `;
  if (!stage) throw new Error("Fixture default stage was not provisioned.");

  return { stageId: stage.id as string, userId: data.user.id, workspaceId: workspace.id as string };
}

async function insertContacts(
  database: ReturnType<typeof postgres>,
  workspaceId: string,
  stageId: string,
  contacts: Array<{ company: string; first_name: string; last_name: string; phone_e164: string }>,
): Promise<void> {
  for (let index = 0; index < contacts.length; index += 250) {
    const rows = contacts.slice(index, index + 250).map((contact) => ({
      ...contact,
      pipeline_stage_id: stageId,
      workspace_id: workspaceId,
    }));
    await database`
      insert into public.contacts ${database(
        rows,
        "company",
        "first_name",
        "last_name",
        "phone_e164",
        "pipeline_stage_id",
        "workspace_id",
      )}
    `;
  }
}

async function activateFixtureBilling(
  database: ReturnType<typeof postgres>,
  workspaceId: string,
  fixtureKey: string,
): Promise<void> {
  await database`
    update public.billing_periods
    set is_provisional = false
    where workspace_id = ${workspaceId}::uuid
      and status = 'open'
  `;
  await database`
    insert into private.billing_period_provider_details (
      billing_period_id,
      workspace_id,
      subscription_id,
      activated_at
    )
    select period.id, period.workspace_id, ${`subscription-${fixtureKey}`}, now()
    from public.billing_periods as period
    where period.workspace_id = ${workspaceId}::uuid
      and period.status = 'open'
    on conflict (billing_period_id) do update
    set subscription_id = excluded.subscription_id,
        activated_at = excluded.activated_at
  `;
  await database`
    update private.workspace_billing_accounts as account
    set stripe_customer_id = ${`customer-${fixtureKey}`},
        default_payment_method_id = ${`payment-${fixtureKey}`},
        payment_method_status = 'saved',
        stripe_subscription_id = ${`subscription-${fixtureKey}`},
        subscription_price_id = ${`price-${fixtureKey}`},
        subscription_status = 'active',
        current_period_start = period.period_start,
        current_period_end = period.period_end
    from public.billing_periods as period
    where account.workspace_id = ${workspaceId}::uuid
      and period.workspace_id = account.workspace_id
      and period.status = 'open'
  `;
}

export async function provisionFixtures(): Promise<void> {
  await removeFixtureUsers();
  const client = fixtureAdminClient();
  const database = fixtureDatabase();
  try {
    const standard = await createFixtureUser(
      client,
      database,
      E2E_USERS.standard,
      "Playwright standard workspace",
    );
    await insertContacts(database, standard.workspaceId, standard.stageId, [
      {
        company: "Riink QA",
        first_name: "E2E",
        last_name: "Contact",
        phone_e164: "+15125550101",
      },
    ]);
    await database`
      insert into public.phone_numbers (workspace_id, phone_e164, status)
      values (${standard.workspaceId}::uuid, '+15125550199', 'pending')
    `;

    const large = await createFixtureUser(
      client,
      database,
      E2E_USERS.largeCampaign,
      "Playwright large campaign workspace",
    );
    await activateFixtureBilling(database, large.workspaceId, "e2e-large-campaign");
    const largeContacts = Array.from({ length: 1_000 }, (_, index) => ({
      company: "Riink QA",
      first_name: `Load ${String(index + 1).padStart(4, "0")}`,
      last_name: "Contact",
      phone_e164: `+1512${String(2_000_000 + index)}`,
    }));
    await insertContacts(database, large.workspaceId, large.stageId, largeContacts);

    await database`
      insert into public.phone_numbers (workspace_id, phone_e164, status)
      values (${large.workspaceId}::uuid, '+15125550999', 'ready')
    `;
  } finally {
    await database.end();
  }
}
