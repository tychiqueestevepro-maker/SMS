import nextEnv from "@next/env";

import { provisionFixtures } from "./support/fixtures";

export default async function globalSetup(): Promise<void> {
  const { loadEnvConfig } = nextEnv;
  loadEnvConfig(process.cwd());
  await provisionFixtures();
}
