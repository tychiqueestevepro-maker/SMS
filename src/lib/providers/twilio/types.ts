import type { ProviderOperation } from "../../messaging/errors";

export interface TwilioAccountCredentials {
  accountSid: string;
  authToken: string;
}

export interface TwilioWorkspaceCredentials extends TwilioAccountCredentials {
  messagingServiceSid: string;
}

export type ResolveTwilioWorkspaceCredentials = (
  workspaceId: string,
) =>
  | TwilioWorkspaceCredentials
  | Promise<TwilioWorkspaceCredentials>;

export interface TwilioMessageCreateParams {
  to: string;
  from: string;
  body: string;
  messagingServiceSid: string;
  statusCallback?: string;
}

export interface TwilioMessageResource {
  sid: string;
  status: string;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  price: string | null;
  priceUnit: string | null;
  numSegments: string | null;
}

export interface TwilioMessageList {
  (sid: string): { fetch(): Promise<TwilioMessageResource> };
  create(params: TwilioMessageCreateParams): Promise<TwilioMessageResource>;
}

export interface TwilioAvailableNumberResource {
  phoneNumber: string;
  locality: string | null;
  region: string | null;
  capabilities: { sms: boolean };
}

export interface TwilioIncomingPhoneNumberResource {
  sid: string;
  phoneNumber: string;
  dateCreated?: Date | null;
  accountSid?: string;
  capabilities?: { sms?: boolean };
  origin?: string;
  smsUrl?: string;
  statusCallback?: string;
}

export interface TwilioIncomingPhoneNumberList {
  (sid: string): {
    fetch(): Promise<TwilioIncomingPhoneNumberResource>;
    update(params: {
      smsUrl: string;
      smsMethod: "POST";
      statusCallback: string;
      statusCallbackMethod: "POST";
    }): Promise<TwilioIncomingPhoneNumberResource>;
    remove(): Promise<boolean>;
  };
  create(params: {
    phoneNumber: string;
    smsUrl: string;
    smsMethod: "POST";
    statusCallback: string;
    statusCallbackMethod: "POST";
  }): Promise<TwilioIncomingPhoneNumberResource>;
}

export interface TwilioMessagingServicePhoneNumberResource {
  sid: string;
  serviceSid?: string;
  phoneNumber?: string;
  capabilities?: string[];
}

export interface TwilioMessagingServicePhoneNumberList {
  (phoneNumberSid: string): {
    fetch(): Promise<TwilioMessagingServicePhoneNumberResource>;
    remove(): Promise<boolean>;
  };
  create(params: {
    phoneNumberSid: string;
  }): Promise<TwilioMessagingServicePhoneNumberResource>;
}

export interface TwilioMessagingServiceResource {
  sid: string;
  dateCreated?: Date | null;
}

export interface TwilioMessagingServiceList {
  (serviceSid: string): {
    phoneNumbers: TwilioMessagingServicePhoneNumberList;
  };
  create(params: {
    friendlyName: string;
    inboundMethod: "POST";
    inboundRequestUrl: string;
  }): Promise<TwilioMessagingServiceResource>;
}

export interface TwilioAccountResource {
  sid: string;
  authToken: string;
  dateCreated?: Date | null;
}

export interface TwilioHostedEligibilityList {
  create(params: {
    friendly_name: string;
    phone_numbers: Array<{
      phone_number: string;
      hosting_account_sid: string;
    }>;
  }): Promise<{ results: unknown }>;
}

export type TwilioHostedNumberOrderStatus =
  | "twilio-processing"
  | "received"
  | "pending-verification"
  | "verified"
  | "pending-loa"
  | "carrier-processing"
  | "testing"
  | "completed"
  | "failed"
  | "action-required";

export interface TwilioHostedNumberOrderResource {
  sid: string;
  accountSid: string;
  incomingPhoneNumberSid: string;
  phoneNumber: string;
  status: TwilioHostedNumberOrderStatus | string;
  verificationCode?: string | null;
  dateCreated?: Date | null;
  dateUpdated?: Date | null;
}

export interface TwilioHostedNumberOrderList {
  (sid: string): {
    fetch(): Promise<TwilioHostedNumberOrderResource>;
    remove(): Promise<boolean>;
  };
  create(params: {
    phoneNumber: string;
    smsCapability: true;
    accountSid: string;
    friendlyName: string;
    uniqueName: string;
    smsUrl: string;
    smsMethod: "POST";
    statusCallbackUrl: string;
    statusCallbackMethod: "POST";
    email?: string;
    verificationType: "phone-call";
  }): Promise<TwilioHostedNumberOrderResource>;
}

export interface TwilioMasterClientLike {
  api: {
    v2010: {
      accounts: {
        create(params: { friendlyName: string }): Promise<TwilioAccountResource>;
      };
    };
  };
}

export interface TwilioClientLike {
  messages: TwilioMessageList;
  availablePhoneNumbers(countryCode: string): {
    local: {
      list(params: {
        areaCode?: number;
        smsEnabled: true;
        limit: number;
      }): Promise<TwilioAvailableNumberResource[]>;
    };
  };
  incomingPhoneNumbers: TwilioIncomingPhoneNumberList;
  messaging: {
    v1: {
      services: TwilioMessagingServiceList;
    };
  };
  /** Preview/Beta surfaces are optional so missing account/SDK access fails closed. */
  numbers?: {
    v1: {
      eligibilities: TwilioHostedEligibilityList;
    };
  };
  preview?: {
    hosted_numbers: {
      hostedNumberOrders: TwilioHostedNumberOrderList;
    };
  };
}

export type TwilioClientFactory = (
  credentials: TwilioAccountCredentials,
) => TwilioClientLike;

export type TwilioMasterClientFactory = (
  credentials: TwilioAccountCredentials,
) => TwilioMasterClientLike;

export type TwilioWebhookValidator = (
  authToken: string,
  signature: string,
  url: string,
  parameters: Record<string, string>,
) => boolean;

export interface TwilioRestErrorShape {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
}

export interface TwilioProviderFailureContext {
  operation: ProviderOperation;
  providerResourceId?: string | null;
  /** Set only after an outbound request may have reached the provider. */
  ambiguousWithoutResponse?: boolean;
}
