export type MessageDirection = "inbound" | "outbound";

export type DispatchState =
  | "pending"
  | "reserved"
  | "accepted"
  | "failed"
  | "dispatch_unknown";

export type DeliveryState = "sent" | "delivered" | "failed" | null;

export type ProductDeliveryStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed";

export type PhoneNumberStatus = "pending" | "ready";

export type ExistingNumberCountryCode = "US" | "CA";
export type PurchasableNumberCountryCode = "US" | "CA" | "FR";

/**
 * Provider-neutral progress for an existing-number onboarding operation.
 * `completed` means the external order completed; the number is not usable
 * until `finalizeImport` separately succeeds.
 */
export type ExistingNumberImportStatus =
  | "verification"
  | "pending"
  | "importing"
  | "action_required"
  | "completed"
  | "failed";

export interface CheckExistingNumberEligibilityInput {
  workspaceId: string;
  countryCode: ExistingNumberCountryCode;
  phoneNumber: string;
}

export interface ExistingNumberEligibilityResult {
  countryCode: ExistingNumberCountryCode;
  phoneNumber: string;
  eligible: boolean;
  checkedAt: string;
  ownershipVerificationRequired: boolean;
}

export interface StartExistingNumberImportInput {
  workspaceId: string;
  countryCode: ExistingNumberCountryCode;
  phoneNumber: string;
  idempotencyKey: string;
  inboundWebhookUrl: string;
  statusCallbackUrl: string;
  ownerEmail?: string;
}

export interface StartExistingNumberImportResult {
  providerImportId: string;
  providerNumberId: string | null;
  phoneNumber: string;
  status: ExistingNumberImportStatus;
  verificationCode: string | null;
  createdAt: string;
}

export interface GetExistingNumberImportStatusInput {
  workspaceId: string;
  providerImportId: string;
}

export interface ExistingNumberImportStatusResult {
  providerImportId: string;
  providerNumberId: string | null;
  phoneNumber: string;
  status: ExistingNumberImportStatus;
  verificationCode: string | null;
  updatedAt: string;
}

export interface FinalizeExistingNumberImportInput {
  workspaceId: string;
  providerImportId: string;
  providerNumberId: string;
  phoneNumber: string;
  inboundWebhookUrl: string;
  statusCallbackUrl: string;
}

export interface FinalizeExistingNumberImportResult {
  providerImportId: string;
  providerNumberId: string;
  phoneNumber: string;
  usable: true;
  activatedAt: string;
}

export interface CancelExistingNumberImportInput {
  workspaceId: string;
  providerImportId: string;
  providerNumberId: string | null;
}

export interface CancelExistingNumberImportResult {
  providerImportId: string;
  providerNumberId: string | null;
  cancelled: true;
  cancelledAt: string;
}

export interface SendMessageInput {
  workspaceId: string;
  messageId: string;
  from: string;
  to: string;
  body: string;
  idempotencyKey: string;
  statusCallbackUrl?: string;
}

export interface SendMessageResult {
  providerMessageId: string;
  acceptedAt: string;
  status: "accepted";
}

export interface SearchNumbersInput {
  workspaceId: string;
  countryCode: PurchasableNumberCountryCode;
  areaCode?: string;
  limit?: number;
}

export interface AvailablePhoneNumber {
  providerNumberId: string;
  phoneNumber: string;
  locality: string | null;
  region: string | null;
  supportsSms: boolean;
}

export interface PurchaseNumberInput {
  workspaceId: string;
  providerNumberId: string;
  phoneNumber: string;
  idempotencyKey: string;
  inboundWebhookUrl: string;
  statusCallbackUrl: string;
}

export interface PurchaseNumberResult {
  providerNumberId: string;
  phoneNumber: string;
  purchasedAt: string;
  state: "provisioning" | "active";
}

export interface ReleaseNumberInput {
  workspaceId: string;
  providerNumberId: string;
  idempotencyKey: string;
}

export interface ReleaseNumberResult {
  providerNumberId: string;
  releasedAt: string;
}

export interface ProviderMessageLookupInput {
  workspaceId: string;
  providerMessageId: string;
}

export type ProviderMessageStatus =
  | "queued"
  | "accepted"
  | "sent"
  | "delivered"
  | "failed"
  | "unknown";

export interface MessageStatusResult {
  providerMessageId: string;
  status: ProviderMessageStatus;
  updatedAt: string;
}

export interface MessageCostResult {
  providerMessageId: string;
  amountMicroUsd: number | null;
  currency: "USD";
}

export interface ActualSegmentsResult {
  providerMessageId: string;
  numSegments: number | null;
}

export interface VerifyWebhookInput {
  workspaceId: string;
  url: string;
  signature: string;
  parameters: Readonly<Record<string, string>>;
}

export interface VerifyWebhookResult {
  valid: boolean;
}

/** Internal credentials returned once while creating an isolated workspace. */
export interface WorkspaceMessagingAccountCredentials {
  accountId: string;
  credential: string;
}

export interface CreateWorkspaceMessagingAccountInput {
  workspaceId: string;
  displayName: string;
}

export interface CreateWorkspaceMessagingAccountResult {
  accountId: string;
  credential: string;
  createdAt: string;
}

export interface CreateWorkspaceMessagingServiceInput {
  workspaceId: string;
  account: WorkspaceMessagingAccountCredentials;
  displayName: string;
  inboundWebhookUrl: string;
}

export interface CreateWorkspaceMessagingServiceResult {
  serviceId: string;
  createdAt: string;
}

/**
 * Internal record used to build a client-safe message DTO. Provider fields are
 * accepted here deliberately so the mapper has one explicit sanitization edge.
 */
export interface MessageProductSource {
  id: string;
  direction: MessageDirection;
  body: string;
  createdAt: string;
  sentAt: string | null;
  dispatchState: DispatchState;
  deliveryState: DeliveryState;
  estimatedSegments: number | null;
  actualSegments: number | null;
  providerMessageId?: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  providerCostMicroUsd?: number | null;
}

export interface MessageDto {
  id: string;
  direction: MessageDirection;
  body: string;
  createdAt: string;
  sentAt: string | null;
  deliveryStatus: ProductDeliveryStatus;
  smsCredits: number | null;
}

export interface PhoneNumberProductSource {
  id: string;
  phoneNumber: string;
  status: PhoneNumberStatus;
  createdAt: string;
  providerNumberId?: string | null;
  providerAccountId?: string | null;
  providerStatus?: string | null;
}

export interface PhoneNumberDto {
  id: string;
  phoneNumber: string;
  status: PhoneNumberStatus;
  createdAt: string;
}
