import "server-only";

import type {
  ActualSegmentsResult,
  AvailablePhoneNumber,
  MessageCostResult,
  MessageStatusResult,
  ProviderMessageLookupInput,
  PurchaseNumberInput,
  PurchaseNumberResult,
  ReleaseNumberInput,
  ReleaseNumberResult,
  SearchNumbersInput,
  SendMessageInput,
  SendMessageResult,
  VerifyWebhookInput,
  VerifyWebhookResult,
  CreateWorkspaceMessagingAccountInput,
  CreateWorkspaceMessagingAccountResult,
  CreateWorkspaceMessagingServiceInput,
  CreateWorkspaceMessagingServiceResult,
  CancelExistingNumberImportInput,
  CancelExistingNumberImportResult,
  CheckExistingNumberEligibilityInput,
  ExistingNumberEligibilityResult,
  ExistingNumberImportStatusResult,
  FinalizeExistingNumberImportInput,
  FinalizeExistingNumberImportResult,
  GetExistingNumberImportStatusInput,
  StartExistingNumberImportInput,
  StartExistingNumberImportResult,
} from "./types";

/**
 * The single provider seam used by the messaging domain. Implementations may
 * know an external SDK; callers outside the adapter must not.
 */
export interface SmsProvider {
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  searchNumbers(input: SearchNumbersInput): Promise<AvailablePhoneNumber[]>;
  purchaseNumber(input: PurchaseNumberInput): Promise<PurchaseNumberResult>;
  releaseNumber(input: ReleaseNumberInput): Promise<ReleaseNumberResult>;
  getMessageStatus(
    input: ProviderMessageLookupInput,
  ): Promise<MessageStatusResult>;
  getMessageCost(input: ProviderMessageLookupInput): Promise<MessageCostResult>;
  getActualSegments(
    input: ProviderMessageLookupInput,
  ): Promise<ActualSegmentsResult>;
  verifyWebhook(input: VerifyWebhookInput): Promise<VerifyWebhookResult>;
}

/**
 * Server-only provisioning seam. It is intentionally separate from
 * `SmsProvider`: a workspace does not have credentials until these two steps
 * complete, and the one-time credential must never reach product code.
 */
export interface WorkspaceMessagingSetupProvider {
  createWorkspaceAccount(
    input: CreateWorkspaceMessagingAccountInput,
  ): Promise<CreateWorkspaceMessagingAccountResult>;
  createMessagingService(
    input: CreateWorkspaceMessagingServiceInput,
  ): Promise<CreateWorkspaceMessagingServiceResult>;
}

/**
 * Server-only seam for onboarding a number the workspace already owns.
 * External completion and product usability are deliberately separate.
 */
export interface ExistingNumberOnboardingProvider {
  checkEligibility(
    input: CheckExistingNumberEligibilityInput,
  ): Promise<ExistingNumberEligibilityResult>;
  startImport(
    input: StartExistingNumberImportInput,
  ): Promise<StartExistingNumberImportResult>;
  getImportStatus(
    input: GetExistingNumberImportStatusInput,
  ): Promise<ExistingNumberImportStatusResult>;
  finalizeImport(
    input: FinalizeExistingNumberImportInput,
  ): Promise<FinalizeExistingNumberImportResult>;
  cancelImport(
    input: CancelExistingNumberImportInput,
  ): Promise<CancelExistingNumberImportResult>;
}
