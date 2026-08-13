import "server-only";

import twilio from "twilio";

import type {
  TwilioAccountCredentials,
  TwilioClientFactory,
  TwilioClientLike,
  TwilioMasterClientFactory,
  TwilioMasterClientLike,
  TwilioWebhookValidator,
} from "./types";

/** Raw SDK client for provider adapters that use resources outside the narrow messaging surface. */
export const createTwilioSdkClient = (credentials: TwilioAccountCredentials): unknown =>
  twilio(credentials.accountSid, credentials.authToken);

/** Creates a client scoped to the workspace's isolated account. */
export const createTwilioSubaccountClient: TwilioClientFactory = (
  credentials,
) =>
  twilio(credentials.accountSid, credentials.authToken) as unknown as TwilioClientLike;

/** Creates the privileged client used only to create isolated workspaces. */
export const createTwilioMasterClient: TwilioMasterClientFactory = (
  credentials,
) =>
  twilio(
    credentials.accountSid,
    credentials.authToken,
  ) as unknown as TwilioMasterClientLike;

export const validateTwilioWebhook: TwilioWebhookValidator = (
  authToken,
  signature,
  url,
  parameters,
) => twilio.validateRequest(authToken, signature, url, parameters);
