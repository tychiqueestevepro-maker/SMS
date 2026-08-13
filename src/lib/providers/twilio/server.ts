import "server-only";

import {
  createTwilioMasterClient,
  createTwilioSubaccountClient,
  validateTwilioWebhook,
} from "./client";
import { TwilioSmsProvider } from "./provider";
import { TwilioWorkspaceSetupProvider } from "./provisioning";
import type { ResolveTwilioWorkspaceCredentials } from "./types";

export interface CreateTwilioSmsProviderOptions {
  resolveCredentials: ResolveTwilioWorkspaceCredentials;
  now?: () => Date;
}

export function createTwilioSmsProvider(
  options: CreateTwilioSmsProviderOptions,
): TwilioSmsProvider {
  return new TwilioSmsProvider({
    resolveCredentials: options.resolveCredentials,
    clientFactory: createTwilioSubaccountClient,
    validateWebhook: validateTwilioWebhook,
    now: options.now,
  });
}

export function createTwilioWorkspaceSetupProvider(input: {
  accountSid: string;
  authToken: string;
  now?: () => Date;
}): TwilioWorkspaceSetupProvider {
  return new TwilioWorkspaceSetupProvider({
    masterClientFactory: createTwilioMasterClient,
    masterCredentials: {
      accountSid: input.accountSid,
      authToken: input.authToken,
    },
    subaccountClientFactory: createTwilioSubaccountClient,
    now: input.now,
  });
}
