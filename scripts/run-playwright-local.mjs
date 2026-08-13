import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const supabaseCli = require.resolve("supabase/dist/supabase.js");
const status = spawnSync(process.execPath, [supabaseCli, "status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

if (status.error || status.status !== 0) {
  console.error("Riink E2E requires the local Supabase stack to be running.");
  process.exit(status.status ?? 1);
}

const localEnvironment = new Map();
for (const line of status.stdout.split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) continue;
  const [, name, rawValue] = match;
  let value = rawValue;
  if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
    try {
      value = JSON.parse(rawValue);
    } catch {
      value = rawValue.slice(1, -1);
    }
  }
  localEnvironment.set(name, value);
}

const apiUrl = localEnvironment.get("API_URL");
const anonKey = localEnvironment.get("ANON_KEY");
const databaseUrl = localEnvironment.get("DB_URL");
const publishableKey = localEnvironment.get("PUBLISHABLE_KEY") ?? anonKey;
const serviceRoleKey = localEnvironment.get("SERVICE_ROLE_KEY");

if (!apiUrl || !anonKey || !databaseUrl || !publishableKey || !serviceRoleKey) {
  console.error("The local Supabase environment is incomplete.");
  process.exit(1);
}

const hostname = new URL(apiUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) {
  console.error("Riink E2E fixtures can only run against a loopback Supabase URL.");
  process.exit(1);
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100";
const environment = {
  ...process.env,
  APP_URL: baseURL,
  E2E_DATABASE_URL: databaseUrl,
  E2E_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  E2E_SUPABASE_URL: apiUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  PLAYWRIGHT_BASE_URL: baseURL,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  SUPABASE_URL: apiUrl,
};

const playwrightCli = require.resolve("@playwright/test/cli");
const playwrightArguments = process.argv.slice(2);
if (
  playwrightArguments.includes("--list") &&
  !playwrightArguments.some((argument) => argument.startsWith("--reporter"))
) {
  playwrightArguments.push("--reporter=line");
}
const result = spawnSync(
  process.execPath,
  [playwrightCli, "test", ...playwrightArguments],
  { cwd: process.cwd(), env: environment, stdio: "inherit" },
);

process.exit(result.status ?? 1);
