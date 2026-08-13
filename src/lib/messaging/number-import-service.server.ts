import "server-only";

import { randomUUID } from "node:crypto";

import type { ExistingNumberOnboardingProvider } from "./provider";
import type {
  ExistingNumberCountryCode,
  ExistingNumberImportStatus,
  ExistingNumberImportStatusResult,
  StartExistingNumberImportResult,
} from "./types";
import {
  getProviderFailureDetails,
  toProductMessagingError,
  type ProviderFailureDetails,
  type ProviderOperation,
} from "./errors";
import { NumberProductError } from "../numbers/errors";
import {
  normalizeNumberImportPhone,
  type NumberImportCountryCode,
  type NumberImportEligibilityTokenSigner,
} from "../numbers/import-eligibility-token.server";
import type {
  NumberImportPersistenceFailure,
  NumberImportProductStatus,
  NumberImportRepository,
} from "../numbers/import-repository";

type ProviderImportResultWithVerification =
  | (StartExistingNumberImportResult & { verificationCode?: string | null })
  | (ExistingNumberImportStatusResult & { verificationCode?: string | null });

export interface NumberImportServiceOptions {
  applicationOrigin: string;
  ensureWorkspaceReady(workspaceId: string): Promise<void>;
  now?: () => Date;
  operationId?: () => string;
  providerName: string;
  reportInternalEvent?: (event: {
    event:
      | "number_import_started"
      | "number_import_status_updated"
      | "number_import_reconciliation_required"
      | "number_import_disconnected";
    failure: ProviderFailureDetails | null;
    occurredAt: string;
    operationId: string;
    phoneNumberId: string | null;
    workspaceId: string;
  }) => void | Promise<void>;
}

export type NumberImportEligibilityDecision =
  | {
      countryCode: NumberImportCountryCode;
      eligibilityToken: string;
      eligible: true;
      phoneNumber: string;
    }
  | {
      countryCode: NumberImportCountryCode;
      eligibilityToken: null;
      eligible: false;
      phoneNumber: string;
    };

export interface StartNumberImportResult {
  phoneNumberId: string;
  status: Exclude<NumberImportProductStatus, "active">;
}

function storedFailure(
  error: unknown,
  operation: ProviderOperation,
  providerResourceId: string | null = null,
): {
  details: ProviderFailureDetails;
  stored: NumberImportPersistenceFailure;
} {
  const source = getProviderFailureDetails(error, operation);
  const details = {
    ...source,
    providerResourceId: source.providerResourceId ?? providerResourceId,
  };
  return {
    details,
    stored: {
      providerCode: details.providerCode,
      providerMessage: details.providerMessage.slice(0, 1_000),
      providerResourceId: details.providerResourceId,
    },
  };
}

function productStatus(
  status: ExistingNumberImportStatus,
): Exclude<NumberImportProductStatus, "active"> {
  // External completion is deliberately still non-active. Activation happens
  // only after finalizeImport confirms the number is usable in Riink.
  return status === "completed" ? "importing" : status;
}

function verificationCode(result: ProviderImportResultWithVerification): string | null {
  const value = result.verificationCode;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 64) : null;
}

function assertProviderCorrelation(input: {
  actualImportId: string;
  actualPhoneNumber: string;
  expectedImportId?: string;
  expectedPhoneNumber?: string;
}): void {
  if (
    !input.actualImportId.trim() ||
    !input.actualPhoneNumber.trim() ||
    (input.expectedImportId && input.actualImportId !== input.expectedImportId) ||
    (input.expectedPhoneNumber && input.actualPhoneNumber !== input.expectedPhoneNumber)
  ) {
    throw new Error("Number import provider correlation failed.");
  }
}

export class NumberImportService {
  private readonly now: () => Date;
  private readonly operationId: () => string;
  private readonly origin: string;

  constructor(
    private readonly repository: NumberImportRepository,
    private readonly provider: ExistingNumberOnboardingProvider,
    private readonly eligibilitySigner: NumberImportEligibilityTokenSigner,
    private readonly options: NumberImportServiceOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.operationId = options.operationId ?? randomUUID;
    this.origin = new URL(options.applicationOrigin).origin;
    if (!options.providerName.trim()) {
      throw new RangeError("Number import provider name is required.");
    }
  }

  async checkEligibility(input: {
    countryCode: NumberImportCountryCode;
    phoneNumber: string;
    requestId: string;
    workspaceId: string;
  }): Promise<NumberImportEligibilityDecision> {
    // requestId is validated at the Server Action boundary. It exists so the
    // persistence layer can add throttling/idempotency without changing the UI.
    if (!input.requestId.trim()) throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    const phoneNumber = normalizeNumberImportPhone(input.countryCode, input.phoneNumber);
    await this.options.ensureWorkspaceReady(input.workspaceId);

    let eligibility;
    try {
      eligibility = await this.provider.checkEligibility({
        countryCode: input.countryCode as ExistingNumberCountryCode,
        phoneNumber,
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      throw toProductMessagingError(error, "checkNumberImportEligibility");
    }
    if (
      eligibility.countryCode !== input.countryCode ||
      eligibility.phoneNumber !== phoneNumber
    ) {
      throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    }
    if (!eligibility.eligible) {
      return {
        countryCode: input.countryCode,
        eligibilityToken: null,
        eligible: false,
        phoneNumber,
      };
    }

    return {
      countryCode: input.countryCode,
      eligibilityToken: this.eligibilitySigner.issue({
        countryCode: input.countryCode,
        phoneNumber,
        workspaceId: input.workspaceId,
      }, { now: this.now() }),
      eligible: true,
      phoneNumber,
    };
  }

  async startImport(input: {
    eligibilityToken: string;
    ownerEmail: string;
    workspaceId: string;
  }): Promise<StartNumberImportResult> {
    const eligibility = this.eligibilitySigner.verify(
      input.eligibilityToken,
      input.workspaceId,
      this.now(),
    );
    if (!input.ownerEmail.trim()) {
      throw new NumberProductError("NUMBER_IMPORT_EMAIL_REQUIRED");
    }
    await this.options.ensureWorkspaceReady(input.workspaceId);

    const requestedOperationId = this.operationId();
    const claim = await this.repository.claimImport({
      countryCode: eligibility.countryCode,
      operationId: requestedOperationId,
      phoneNumber: eligibility.phoneNumber,
      workspaceId: input.workspaceId,
    });
    if (claim.disposition === "already_started") {
      const existing = await this.repository.getImportContext({
        phoneNumberId: claim.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      if (!existing || existing.importStatus === "active") {
        throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
      }
      return { phoneNumberId: claim.phoneNumberId, status: existing.importStatus };
    }
    if (claim.disposition !== "claimed" || claim.operationId !== requestedOperationId) {
      throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    }

    let providerImportId: string | null = null;
    try {
      const started = await this.provider.startImport({
        countryCode: eligibility.countryCode as ExistingNumberCountryCode,
        idempotencyKey: claim.operationId,
        inboundWebhookUrl: `${this.origin}/api/webhooks/sms`,
        ownerEmail: input.ownerEmail.trim(),
        phoneNumber: eligibility.phoneNumber,
        statusCallbackUrl: `${this.origin}/api/webhooks/number-imports`,
        workspaceId: input.workspaceId,
      });
      providerImportId = started.providerImportId;
      assertProviderCorrelation({
        actualImportId: started.providerImportId,
        actualPhoneNumber: started.phoneNumber,
        expectedPhoneNumber: eligibility.phoneNumber,
      });
      const status = productStatus(started.status);
      const recorded = await this.repository.recordImportStarted({
        importStatus: status,
        operationId: claim.operationId,
        providerImportId: started.providerImportId,
        providerName: this.options.providerName,
        providerStatus: started.status,
        verificationCode: verificationCode(started),
        workspaceId: input.workspaceId,
      });
      if (!recorded.recorded || recorded.phoneNumberId !== claim.phoneNumberId) {
        throw new Error("Number import start could not be persisted.");
      }
      await this.report({
        event: "number_import_started",
        failure: null,
        operationId: claim.operationId,
        phoneNumberId: claim.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      return { phoneNumberId: claim.phoneNumberId, status };
    } catch (error) {
      const failure = storedFailure(
        error,
        "startNumberImport",
        providerImportId,
      );
      await this.markUnknown(() => this.repository.markImportUnknown({
        failure: failure.stored,
        operationId: claim.operationId,
        workspaceId: input.workspaceId,
      }));
      await this.report({
        event: "number_import_reconciliation_required",
        failure: failure.details,
        operationId: claim.operationId,
        phoneNumberId: claim.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      throw toProductMessagingError(error, "startNumberImport");
    }
  }

  async refreshImport(input: {
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<NumberImportProductStatus> {
    const context = await this.repository.getImportContext(input);
    if (!context) throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    if (context.importStatus === "active" || context.importStatus === "failed") {
      return context.importStatus;
    }

    try {
      const observed = await this.provider.getImportStatus({
        providerImportId: context.providerImportId,
        workspaceId: input.workspaceId,
      });
      assertProviderCorrelation({
        actualImportId: observed.providerImportId,
        actualPhoneNumber: observed.phoneNumber,
        expectedImportId: context.providerImportId,
      });

      let status: NumberImportProductStatus = productStatus(observed.status);
      let providerNumberId = observed.providerNumberId;
      let usable = false;
      if (observed.status === "completed") {
        if (!providerNumberId) {
          throw new Error("Completed number import has no usable number resource.");
        }
        const finalized = await this.provider.finalizeImport({
          inboundWebhookUrl: `${this.origin}/api/webhooks/sms`,
          phoneNumber: observed.phoneNumber,
          providerImportId: observed.providerImportId,
          providerNumberId,
          statusCallbackUrl: `${this.origin}/api/webhooks/sms`,
          workspaceId: input.workspaceId,
        });
        if (!finalized.usable || finalized.providerNumberId !== providerNumberId) {
          throw new Error("Completed number import is not usable.");
        }
        usable = true;
        status = "active";
        providerNumberId = finalized.providerNumberId;
      }

      const updated = await this.repository.updateImportStatus({
        importStatus: status,
        observedAt: this.now().toISOString(),
        phoneNumberId: input.phoneNumberId,
        providerNumberId,
        providerStatus: observed.status,
        usable,
        verificationCode: verificationCode(observed),
        workspaceId: input.workspaceId,
      });
      if (!updated) throw new Error("Number import status could not be persisted.");
      await this.report({
        event: "number_import_status_updated",
        failure: null,
        operationId: context.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      return status;
    } catch (error) {
      const failure = storedFailure(
        error,
        "getNumberImportStatus",
        context.providerImportId,
      );
      await this.markUnknown(() => this.repository.markImportUnknown({
        failure: failure.stored,
        operationId: context.operationId,
        workspaceId: input.workspaceId,
      }));
      await this.report({
        event: "number_import_reconciliation_required",
        failure: failure.details,
        operationId: context.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      throw toProductMessagingError(error, "getNumberImportStatus");
    }
  }

  async disconnectImport(input: {
    phoneNumberId: string;
    workspaceId: string;
  }): Promise<void> {
    const requestedOperationId = this.operationId();
    const claim = await this.repository.claimDisconnect({
      operationId: requestedOperationId,
      phoneNumberId: input.phoneNumberId,
      workspaceId: input.workspaceId,
    });
    if (claim.disposition === "already_disconnected") return;
    if (
      claim.disposition !== "claimed" ||
      claim.operationId !== requestedOperationId ||
      !claim.providerImportId
    ) {
      throw new NumberProductError("NUMBER_IMPORT_UNAVAILABLE");
    }

    try {
      await this.provider.cancelImport({
        providerImportId: claim.providerImportId,
        providerNumberId: claim.providerNumberId,
        workspaceId: input.workspaceId,
      });
      const completed = await this.repository.completeDisconnect({
        operationId: claim.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      if (!completed) throw new Error("Number import disconnect could not be persisted.");
      await this.report({
        event: "number_import_disconnected",
        failure: null,
        operationId: claim.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
    } catch (error) {
      const failure = storedFailure(
        error,
        "cancelNumberImport",
        claim.providerNumberId ?? claim.providerImportId,
      );
      await this.markUnknown(() => this.repository.markDisconnectUnknown({
        failure: failure.stored,
        operationId: claim.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      }));
      await this.report({
        event: "number_import_reconciliation_required",
        failure: failure.details,
        operationId: claim.operationId,
        phoneNumberId: input.phoneNumberId,
        workspaceId: input.workspaceId,
      });
      throw toProductMessagingError(error, "cancelNumberImport");
    }
  }

  getCallbackContext(providerImportId: string) {
    return this.repository.getCallbackContext(providerImportId);
  }

  private async markUnknown(action: () => Promise<boolean>): Promise<void> {
    try {
      await action();
    } catch {
      // The original durable claim remains fail-closed.
    }
  }

  private async report(input: Omit<
    Parameters<NonNullable<NumberImportServiceOptions["reportInternalEvent"]>>[0],
    "occurredAt"
  >): Promise<void> {
    if (!this.options.reportInternalEvent) return;
    try {
      await this.options.reportInternalEvent({
        ...input,
        occurredAt: this.now().toISOString(),
      });
    } catch {
      // Observability cannot change product state.
    }
  }
}
