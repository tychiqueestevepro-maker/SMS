import "server-only";

import { randomUUID } from "node:crypto";

import {
  getProviderFailureDetails,
  ProductMessagingError,
} from "./errors";
import { CONFIGURED_EXISTING_NUMBER } from "../numbers/configured-existing-number.server";
import { ConfiguredNumberRepository } from "../numbers/configured-number-repository.server";
import { TwilioConfiguredNumberConnector } from "../providers/twilio/existing-number";

export class ConfiguredNumberService {
  constructor(
    private readonly repository: ConfiguredNumberRepository,
    private readonly connector: TwilioConfiguredNumberConnector,
    private readonly options: {
      applicationOrigin: string;
      ensureWorkspaceReady(workspaceId: string): Promise<void>;
      now?: () => Date;
      operationId?: () => string;
      providerName: string;
    },
  ) {}

  async connect(workspaceId: string): Promise<{ phoneNumberId: string }> {
    await this.options.ensureWorkspaceReady(workspaceId);
    const requestedOperationId = (this.options.operationId ?? randomUUID)();
    const claim = await this.repository.claim({
      operationId: requestedOperationId,
      phoneNumber: CONFIGURED_EXISTING_NUMBER.phoneNumber,
      providerNumberId: CONFIGURED_EXISTING_NUMBER.providerNumberId,
      workspaceId,
    });
    if (claim.disposition === "completed") {
      return { phoneNumberId: claim.phoneNumberId };
    }
    if (
      claim.disposition !== "claimed" ||
      claim.operationId !== requestedOperationId
    ) {
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }

    try {
      const origin = new URL(this.options.applicationOrigin).origin;
      const connected = await this.connector.connect({
        addressSid: CONFIGURED_EXISTING_NUMBER.addressSid,
        bundleSid: CONFIGURED_EXISTING_NUMBER.bundleSid,
        inboundWebhookUrl: `${origin}/api/webhooks/sms`,
        phoneNumber: CONFIGURED_EXISTING_NUMBER.phoneNumber,
        providerNumberId: CONFIGURED_EXISTING_NUMBER.providerNumberId,
        statusCallbackUrl: `${origin}/api/webhooks/sms`,
        workspaceId,
      });
      const completion = await this.repository.complete({
        completedAt: (this.options.now ?? (() => new Date()))().toISOString(),
        operationId: claim.operationId,
        providerName: this.options.providerName,
        providerNumberId: connected.providerNumberId,
        providerStatus: connected.status,
        workspaceId,
      });
      if (!completion.completed || completion.phoneNumberId !== claim.phoneNumberId) {
        throw new Error("Connected number completion could not be persisted.");
      }
      return { phoneNumberId: completion.phoneNumberId };
    } catch (error) {
      const failure = getProviderFailureDetails(error, "purchaseNumber");
      await this.repository
        .markUnknown({
          operationId: claim.operationId,
          providerCode: failure.providerCode,
          providerMessage: failure.providerMessage,
          workspaceId,
        })
        .catch(() => undefined);
      throw new ProductMessagingError("PHONE_NUMBER_OPERATION_FAILED");
    }
  }
}
