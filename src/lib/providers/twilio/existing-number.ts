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
        addresses(addressSid: string): {
          fetch(): Promise<{
            city: string;
            customerName: string;
            friendlyName: string;
            isoCountry: string;
            postalCode: string;
            region: string;
            street: string;
            streetSecondary: string;
          }>;
        };
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

type WorkspaceClient = {
  addresses: {
    create(input: {
      city: string;
      customerName: string;
      friendlyName: string;
      isoCountry: string;
      postalCode: string;
      region: string;
      street: string;
      streetSecondary?: string;
    }): Promise<{ sid: string }>;
  };
};

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
      const clonedBundle = await master.numbers.v2
        .bundleClone(input.bundleSid)
        .create({
          friendlyName: `Riink workspace ${input.workspaceId}`,
          targetAccountSid: workspaceCredentials.accountSid,
        });
      if (
        !/^BU[0-9a-fA-F]{32}$/.test(clonedBundle.bundleSid) ||
        !["twilio-approved", "provisionally-approved"].includes(clonedBundle.status)
      ) {
        throw new Error("The regulatory bundle could not be cloned for this workspace.");
      }

      const sourceAddress = await master.api.v2010
        .accounts(this.input.masterAccountSid)
        .addresses(input.addressSid)
        .fetch();
      const workspaceApi = createTwilioSdkClient(workspaceCredentials) as WorkspaceClient;
      const clonedAddress = await workspaceApi.addresses.create({
        city: sourceAddress.city,
        customerName: sourceAddress.customerName,
        friendlyName: `Riink workspace ${input.workspaceId}`,
        isoCountry: sourceAddress.isoCountry,
        postalCode: sourceAddress.postalCode,
        region: sourceAddress.region,
        street: sourceAddress.street,
        ...(sourceAddress.streetSecondary
          ? { streetSecondary: sourceAddress.streetSecondary }
          : {}),
      });
      if (!/^AD[0-9a-fA-F]{32}$/.test(clonedAddress.sid)) {
        throw new Error("The regulatory address could not be copied for this workspace.");
      }

      const moved = await master.api.v2010
        .accounts(this.input.masterAccountSid)
        .incomingPhoneNumbers(input.providerNumberId)
        .update({
          accountSid: workspaceCredentials.accountSid,
          addressSid: clonedAddress.sid,
          bundleSid: clonedBundle.bundleSid,
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
