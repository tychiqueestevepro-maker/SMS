import "server-only";

import { toTwilioProviderError } from "./errors";
import { createTwilioSdkClient, createTwilioSubaccountClient } from "./client";
import type { ResolveTwilioWorkspaceCredentials } from "./types";

type MasterClient = {
  numbers: {
    v2: {
      bundleClone(bundleSid: string): {
        create(input: {
          friendlyName: string;
          targetAccountSid: string;
        }): Promise<{ bundleSid: string; status: string }>;
      };
    };
  };
  api: {
    v2010: {
      accounts(accountSid: string): {
        incomingPhoneNumbers(providerNumberId: string): {
          update(input: {
            accountSid: string;
            addressSid: string;
            bundleSid: string;
            smsMethod: "POST";
            smsUrl: string;
            statusCallback: string;
            statusCallbackMethod: "POST";
          }): Promise<{ accountSid: string; phoneNumber: string; sid: string }>;
        };
      };
    };
  };
};

type RegulatoryBundleCollection = {
  (bundleSid: string): {
    itemAssignments: {
      list(input: { limit: number }): Promise<Array<{ objectSid: string }>>;
    };
  };
  list(input: {
    friendlyName: string;
    limit: number;
  }): Promise<Array<{ sid: string; status: string }>>;
};

type WorkspaceClient = {
  numbers: {
    v2: {
      regulatoryCompliance: {
        bundles: RegulatoryBundleCollection;
        supportingDocuments(supportingDocumentSid: string): {
          fetch(): Promise<{ attributes: unknown }>;
        };
      };
    };
  };
};

const APPROVED_BUNDLE_STATUSES = new Set([
  "twilio-approved",
  "provisionally-approved",
]);

function regulatoryAddressSids(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) {
    return [];
  }
  const addressSids = (attributes as { address_sids?: unknown }).address_sids;
  if (!Array.isArray(addressSids)) return [];
  return addressSids.filter(
    (addressSid): addressSid is string =>
      typeof addressSid === "string" && /^AD[0-9a-fA-F]{32}$/.test(addressSid),
  );
}

export class TwilioConfiguredNumberConnector {
  constructor(
    private readonly input: {
      masterAccountSid: string;
      masterAuthToken: string;
      resolveCredentials: ResolveTwilioWorkspaceCredentials;
    },
  ) {}

  async connect(input: {
    addressSid: string;
    bundleSid: string;
    inboundWebhookUrl: string;
    phoneNumber: string;
    providerNumberId: string;
    statusCallbackUrl: string;
    workspaceId: string;
  }): Promise<{ phoneNumber: string; providerNumberId: string; status: "active" }> {
    const workspaceCredentials = await this.input.resolveCredentials(input.workspaceId);
    try {
      const master = createTwilioSdkClient({
        accountSid: this.input.masterAccountSid,
        authToken: this.input.masterAuthToken,
      }) as MasterClient;
      const workspaceApi = createTwilioSdkClient(workspaceCredentials) as WorkspaceClient;
      const friendlyName = `Riink workspace ${input.workspaceId}`;
      const existingBundles = await workspaceApi.numbers.v2.regulatoryCompliance.bundles.list({
        friendlyName,
        limit: 20,
      });
      const existingBundle = existingBundles.find(
        (bundle) =>
          /^BU[0-9a-fA-F]{32}$/.test(bundle.sid) &&
          APPROVED_BUNDLE_STATUSES.has(bundle.status),
      );
      const bundle = existingBundle
        ? { bundleSid: existingBundle.sid, status: existingBundle.status }
        : await master.numbers.v2.bundleClone(input.bundleSid).create({
            friendlyName,
            targetAccountSid: workspaceCredentials.accountSid,
          });
      if (
        !/^BU[0-9a-fA-F]{32}$/.test(bundle.bundleSid) ||
        !APPROVED_BUNDLE_STATUSES.has(bundle.status)
      ) {
        throw new Error("The regulatory bundle could not be cloned for this workspace.");
      }

      const assignments = await workspaceApi.numbers.v2.regulatoryCompliance
        .bundles(bundle.bundleSid)
        .itemAssignments.list({ limit: 100 });
      const supportingDocuments = await Promise.all(
        assignments
          .filter((assignment) => /^RD[0-9a-fA-F]{32}$/.test(assignment.objectSid))
          .map((assignment) =>
            workspaceApi.numbers.v2.regulatoryCompliance
              .supportingDocuments(assignment.objectSid)
              .fetch(),
          ),
      );
      const addressSids = [
        ...new Set(
          supportingDocuments.flatMap((document) =>
            regulatoryAddressSids(document.attributes),
          ),
        ),
      ];
      if (addressSids.length !== 1) {
        throw new Error("The cloned regulatory bundle has no unique address.");
      }

      const moved = await master.api.v2010
        .accounts(this.input.masterAccountSid)
        .incomingPhoneNumbers(input.providerNumberId)
        .update({
          accountSid: workspaceCredentials.accountSid,
          addressSid: addressSids[0]!,
          bundleSid: bundle.bundleSid,
          smsMethod: "POST",
          smsUrl: input.inboundWebhookUrl,
          statusCallback: input.statusCallbackUrl,
          statusCallbackMethod: "POST",
        });

      if (
        moved.sid !== input.providerNumberId ||
        moved.phoneNumber !== input.phoneNumber ||
        moved.accountSid !== workspaceCredentials.accountSid
      ) {
        throw new Error("The connected number did not match the configured resource.");
      }

      const workspaceClient = createTwilioSubaccountClient(workspaceCredentials);
      await workspaceClient.messaging.v1
        .services(workspaceCredentials.messagingServiceSid)
        .phoneNumbers.create({ phoneNumberSid: input.providerNumberId });

      return {
        phoneNumber: moved.phoneNumber,
        providerNumberId: moved.sid,
        status: "active",
      };
    } catch (error) {
      throw toTwilioProviderError(error, {
        operation: "purchaseNumber",
        ambiguousWithoutResponse: true,
        providerResourceId: input.providerNumberId,
      });
    }
  }
}
