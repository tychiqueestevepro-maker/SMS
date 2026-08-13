import nextEnv from "@next/env";

import { removeFixtureUsers } from "./support/fixtures";

export default async function globalTeardown(): Promise<void> {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await removeFixtureUsers();
}
