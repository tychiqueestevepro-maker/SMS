import "server-only";

import { ProviderOperationError } from "../../messaging/errors";
import type { WorkspaceMessagingSetupProvider } from "../../messaging/provider";
import type {
  CreateWorkspaceMessagingAccountInput,
  CreateWorkspaceMessagingAccountResult,
  CreateWorkspaceMessagingServiceInput,
  CreateWorkspaceMessagingServiceResult,
} from "../../messaging/types";
import { toTwilioProviderError } from "./errors";
import type {
  TwilioClientFactory,
  TwilioMasterClientFactory,
} from "./types";

export interface TwilioWorkspaceSetupProviderOptions {
  masterClientFactory: TwilioMasterClientFactory;
  masterCredentials: {
    accountSid: string;
    authToken: string;
  };
  subaccountClientFactory: TwilioClientFactory;
  now?: () => Date;
}

function timestamp(value: Date | null | undefined, fallback: Date): string {
  return value && Number.isFinite(value.getTime())
    ? value.toISOString()
    : fallback.toISOString();
}

function requireValue(
  value: string,
  operation: "createWorkspaceAccount" | "createMessagingService",
  code: string,
): string {
  if (value.trim()) return value;
  throw new ProviderOperationError({
    operation,
    kind: "authentication",
    providerCode: code,
    providerMessage: "Messaging setup credentials are unavailable",
    providerResourceId: null,
    retryable: false,
  });
}

/** The only adapter that knows how the real provider provisions a workspace. */
export class TwilioWorkspaceSetupProvider
  implements WorkspaceMessagingSetupProvider
{
  private readonly now: () => Date;

  constructor(private readonly options: TwilioWorkspaceSetupProviderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async createWorkspaceAccount(
    input: CreateWorkspaceMessagingAccountInput,
  ): Promise<CreateWorkspaceMessagingAccountResult> {
    const operation = "createWorkspaceAccount" as const;
    const credentials = {
      accountSid: requireValue(
        this.options.masterCredentials.accountSid,
        operation,
        "MASTER_ACCOUNT_UNAVAILABLE",
      ),
      authToken: requireValue(
        this.options.masterCredentials.authToken,
        operation,
        "MASTER_CREDENTIAL_UNAVAILABLE",
      ),
    };

    try {
      const account = await this.options
        .masterClientFactory(credentials)
        .api.v2010.accounts.create({ friendlyName: input.displayName });
      return {
        accountId: account.sid,
        credential: account.authToken,
        createdAt: timestamp(account.dateCreated, this.now()),
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        ambiguousWithoutResponse: true,
      });
    }
  }

  async createMessagingService(
    input: CreateWorkspaceMessagingServiceInput,
  ): Promise<CreateWorkspaceMessagingServiceResult> {
    const operation = "createMessagingService" as const;
    const accountId = requireValue(
      input.account.accountId,
      operation,
      "WORKSPACE_ACCOUNT_UNAVAILABLE",
    );
    const credential = requireValue(
      input.account.credential,
      operation,
      "WORKSPACE_CREDENTIAL_UNAVAILABLE",
    );

    try {
      const service = await this.options
        .subaccountClientFactory({ accountSid: accountId, authToken: credential })
        .messaging.v1.services.create({
          friendlyName: input.displayName,
          inboundMethod: "POST",
          inboundRequestUrl: input.inboundWebhookUrl,
        });
      return {
        serviceId: service.sid,
        createdAt: timestamp(service.dateCreated, this.now()),
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation,
        ambiguousWithoutResponse: true,
        providerResourceId: accountId,
      });
    }
  }
}
