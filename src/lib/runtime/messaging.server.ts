import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SmsProvider } from "@/lib/messaging/provider";
import { NumberProvisioningService } from "@/lib/messaging/number-service.server";
import { NumberImportService } from "@/lib/messaging/number-import-service.server";
import { ConfiguredNumberService } from "@/lib/messaging/configured-number-service.server";
import { getApplicationOrigin } from "@/lib/application-url";
import { logServerEvent } from "@/lib/observability/logger";
import { ManualMessageSender } from "@/lib/inbox/manual-dispatch";
import { SupabaseManualDispatchRepository } from "@/lib/inbox/supabase-manual-dispatch.server";
import { numberSelectionSignerFromEnvironment } from "@/lib/numbers/selection-token.server";
import { numberImportEligibilitySignerFromEnvironment } from "@/lib/numbers/import-eligibility-token.server";
import { SupabaseNumberProvisioningRepository } from "@/lib/numbers/supabase-provisioning-repository.server";
import { SupabaseNumberImportRepository } from "@/lib/numbers/supabase-import-repository.server";
import { ConfiguredNumberRepository } from "@/lib/numbers/configured-number-repository.server";
import {
  createTwilioSmsProvider,
  createTwilioWorkspaceSetupProvider,
  type TwilioWorkspaceCredentials,
} from "@/lib/providers/twilio";
import { createTwilioSubaccountClient } from "@/lib/providers/twilio/client";
import { TwilioExistingNumberOnboardingProvider } from "@/lib/providers/twilio/number-import";
import { TwilioConfiguredNumberConnector } from "@/lib/providers/twilio/existing-number";
import {
  credentialVaultFromEnvironment,
  type CredentialVault,
} from "@/lib/security/credential-vault";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const ACTIVE_PROVIDER_NAME = "twilio";

type CredentialRow = {
  account_id?: unknown;
  encrypted_auth_token?: unknown;
  messaging_service_id?: unknown;
};

export class MessagingRuntimeConfigurationError extends Error {
  constructor() {
    super("Riink messaging infrastructure is not configured for this workspace.");
    this.name = "MessagingRuntimeConfigurationError";
  }
}

function firstRow(value: unknown): CredentialRow | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === "object"
    ? (candidate as CredentialRow)
    : null;
}

function requiredField(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MessagingRuntimeConfigurationError();
  }
  return value;
}

export function createWorkspaceMessagingCredentialsResolver(input: {
  client: SupabaseClient;
  vault: CredentialVault;
}) {
  return async (workspaceId: string): Promise<TwilioWorkspaceCredentials> => {
    const { data, error } = await input.client.rpc(
      "messaging_get_workspace_credentials",
      { p_workspace_id: workspaceId },
    );
    if (error) throw new MessagingRuntimeConfigurationError();
    const row = firstRow(data);
    if (!row) throw new MessagingRuntimeConfigurationError();

    const encryptedAuthToken = requiredField(row.encrypted_auth_token);
    let authToken: string;
    try {
      authToken = input.vault.decrypt(
        encryptedAuthToken,
        `workspace:${workspaceId}:messaging-auth-token`,
      );
    } catch {
      throw new MessagingRuntimeConfigurationError();
    }

    return {
      accountSid: requiredField(row.account_id),
      authToken,
      messagingServiceSid: requiredField(row.messaging_service_id),
    };
  };
}

export type MessagingRuntime = Readonly<{
  provider: SmsProvider;
  /** Internal persistence label. It must never be serialized to a workspace. */
  providerName: string;
}>;

let runtime: MessagingRuntime | undefined;

export function messagingRuntimeFromEnvironment(): MessagingRuntime {
  if (runtime) return runtime;
  const client = createServiceRoleClient();
  const resolveCredentials = createWorkspaceMessagingCredentialsResolver({
    client,
    vault: credentialVaultFromEnvironment(),
  });

  runtime = Object.freeze({
    provider: createTwilioSmsProvider({ resolveCredentials }),
    providerName: ACTIVE_PROVIDER_NAME,
  });
  return runtime;
}

let numberProvisioningService: NumberProvisioningService | undefined;

function requiredEnvironment(name: "TWILIO_ACCOUNT_SID" | "TWILIO_AUTH_TOKEN") {
  const value = process.env[name];
  if (!value?.trim()) throw new MessagingRuntimeConfigurationError();
  return value;
}

export function numberProvisioningServiceFromEnvironment(): NumberProvisioningService {
  if (numberProvisioningService) return numberProvisioningService;

  const client = createServiceRoleClient();
  const messaging = messagingRuntimeFromEnvironment();
  numberProvisioningService = new NumberProvisioningService(
    new SupabaseNumberProvisioningRepository(client),
    messaging.provider,
    createTwilioWorkspaceSetupProvider({
      accountSid: requiredEnvironment("TWILIO_ACCOUNT_SID"),
      authToken: requiredEnvironment("TWILIO_AUTH_TOKEN"),
    }),
    numberSelectionSignerFromEnvironment(),
    {
      applicationOrigin: getApplicationOrigin(),
      credentialVault: credentialVaultFromEnvironment(),
      providerName: messaging.providerName,
      reportInternalEvent(event) {
        logServerEvent(
          event.failure ? "warn" : "info",
          {
            event: event.event,
            workspace_id: event.workspaceId,
            ...(event.phoneNumberId
              ? { phone_number_id: event.phoneNumberId }
              : {}),
          },
          {
            operation_id: event.operationId,
            ...(event.failure
              ? {
                  failure_kind: event.failure.kind,
                  failure_code: event.failure.providerCode,
                }
              : {}),
          },
        );
      },
    },
  );
  return numberProvisioningService;
}

let manualMessageSender: ManualMessageSender | undefined;

export function numberImportsConfigured(): boolean {
  return Boolean(
    (process.env.NUMBER_IMPORT_SIGNING_KEY ?? process.env.NUMBER_SELECTION_SIGNING_KEY)?.trim(),
  );
}

let numberImportService: NumberImportService | undefined;

export function numberImportServiceFromEnvironment(): NumberImportService {
  if (numberImportService) return numberImportService;
  const client = createServiceRoleClient();
  const vault = credentialVaultFromEnvironment();
  const resolveCredentials = createWorkspaceMessagingCredentialsResolver({ client, vault });
  numberImportService = new NumberImportService(
    new SupabaseNumberImportRepository(client),
    new TwilioExistingNumberOnboardingProvider({
      resolveCredentials,
      clientFactory: createTwilioSubaccountClient,
    }),
    numberImportEligibilitySignerFromEnvironment(),
    {
      applicationOrigin: getApplicationOrigin(),
      ensureWorkspaceReady: async (workspaceId) => {
        await numberProvisioningServiceFromEnvironment().ensureWorkspaceReady(workspaceId);
      },
      providerName: ACTIVE_PROVIDER_NAME,
      reportInternalEvent(event) {
        logServerEvent(
          event.failure ? "warn" : "info",
          {
            event: event.event,
            workspace_id: event.workspaceId,
            ...(event.phoneNumberId ? { phone_number_id: event.phoneNumberId } : {}),
          },
          {
            operation_id: event.operationId,
            ...(event.failure
              ? { failure_kind: event.failure.kind, failure_code: event.failure.providerCode }
              : {}),
          },
        );
      },
    },
  );
  return numberImportService;
}

let configuredNumberService: ConfiguredNumberService | undefined;

export function configuredNumberServiceFromEnvironment(): ConfiguredNumberService {
  if (configuredNumberService) return configuredNumberService;
  const client = createServiceRoleClient();
  const vault = credentialVaultFromEnvironment();
  const resolveCredentials = createWorkspaceMessagingCredentialsResolver({ client, vault });
  configuredNumberService = new ConfiguredNumberService(
    new ConfiguredNumberRepository(client),
    new TwilioConfiguredNumberConnector({
      masterAccountSid: requiredEnvironment("TWILIO_ACCOUNT_SID"),
      masterAuthToken: requiredEnvironment("TWILIO_AUTH_TOKEN"),
      resolveCredentials,
    }),
    {
      applicationOrigin: getApplicationOrigin(),
      ensureWorkspaceReady: async (workspaceId) => {
        await numberProvisioningServiceFromEnvironment().ensureWorkspaceReady(workspaceId);
      },
      providerName: ACTIVE_PROVIDER_NAME,
    },
  );
  return configuredNumberService;
}

export function manualMessageSenderFromEnvironment(): ManualMessageSender {
  if (manualMessageSender) return manualMessageSender;
  const messaging = messagingRuntimeFromEnvironment();
  manualMessageSender = new ManualMessageSender(
    new SupabaseManualDispatchRepository(createServiceRoleClient(), {
      providerName: messaging.providerName,
      statusCallbackUrl: `${getApplicationOrigin()}/api/webhooks/sms`,
    }),
    messaging.provider,
    {
      logger(event) {
        const {
          event: eventName,
          workspace_id,
          campaign_id,
          campaign_recipient_id,
          contact_id,
          message_id,
          provider_message_id,
          dispatch_state,
          timestamp: sourceTimestamp,
          ...details
        } = event;
        logServerEvent(
          eventName.includes("failed") || eventName.includes("unknown")
            ? "warn"
            : "info",
          {
            event: eventName,
            ...(workspace_id ? { workspace_id } : {}),
            ...(campaign_id ? { campaign_id } : {}),
            ...(campaign_recipient_id
              ? { campaign_recipient_id }
              : {}),
            ...(contact_id ? { contact_id } : {}),
            ...(message_id ? { message_id } : {}),
            ...(provider_message_id ? { provider_message_id } : {}),
            ...(dispatch_state ? { dispatch_state } : {}),
          },
          { source_timestamp: sourceTimestamp, ...details },
        );
      },
    },
  );
  return manualMessageSender;
}
