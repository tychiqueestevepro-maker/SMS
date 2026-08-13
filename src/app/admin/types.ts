export type AdminSourceError = {
  code: string | null;
  message: string;
};

export type AdminDataSection<T> =
  | { rows: T[]; status: "ready" }
  | { error: AdminSourceError; status: "error" };

export type AdminCustomerRow = {
  actualCredits: number;
  createdAt: string;
  includedCredits: number;
  messagingEnabled: boolean;
  ownerEmail: string | null;
  ownerName: string | null;
  paymentMethodStatus: string | null;
  pendingPhoneCount: number;
  phoneCount: number;
  reservedCredits: number;
  safetyCapCredits: number;
  subscriptionStatus: string | null;
  suspensionReason: string | null;
  workspaceId: string;
  workspaceName: string;
};

export type AdminNumberRow = {
  activationEligible: boolean;
  advancedOptOutConfirmed: boolean;
  a2pState: string | null;
  accountSid: string | null;
  messagingServiceSid: string | null;
  numberId: string;
  phoneNumber: string;
  productStatus: string;
  provider: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  providerNumberId: string | null;
  providerStatus: string | null;
  setupState: string | null;
  updatedAt: string;
  workspaceId: string;
  workspaceName: string;
};

export type AdminMessageOperationRow = {
  acceptedAt: string | null;
  createdAt: string;
  deliveryState: string | null;
  direction: string;
  dispatchState: string;
  messageId: string;
  numSegments: number | null;
  provider: string | null;
  providerCostMicroUsd: number | null;
  providerCurrency: string | null;
  providerErrorCode: string | null;
  providerErrorMessage: string | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  reconciliationReason: string | null;
  workspaceId: string;
  workspaceName: string;
};

export type AdminBillingOperationRow = {
  actualOutboundSegments: number;
  billedAmountMicroUsd: number;
  includedSegments: number;
  invoiceId: string | null;
  invoiceRunId: string | null;
  invoiceStatus: string | null;
  overageAmountMicroUsd: number;
  overageSegments: number;
  periodEnd: string;
  periodId: string;
  periodStart: string;
  periodStatus: string;
  providerCostMicroUsd: number;
  providerFixedCostMicroUsd: number;
  providerMessageCostMicroUsd: number;
  reconciliationStatus: string | null;
  reservedOutboundSegments: number;
  safetyCapSegments: number;
  subscriptionId: string | null;
  workspaceId: string;
  workspaceName: string;
};

export type AdminDashboardData = {
  billing: AdminDataSection<AdminBillingOperationRow>;
  customers: AdminDataSection<AdminCustomerRow>;
  generatedAt: string;
  messages: AdminDataSection<AdminMessageOperationRow>;
  numbers: AdminDataSection<AdminNumberRow>;
};

export type AdminActionResult = {
  code?: string;
  message: string;
  ok: boolean;
};
