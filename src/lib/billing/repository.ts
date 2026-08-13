export interface WorkspaceBillingAccount {
  workspaceId: string;
  monthlyPriceCents: number;
  customerId: string | null;
  defaultPaymentMethodId: string | null;
  subscriptionId: string | null;
  subscriptionPriceId: string | null;
  subscriptionStatus: string | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
}

export interface RecordBillingCustomerInput {
  workspaceId: string;
  customerId: string;
  recordedAt: string;
}

export interface RecordBillingSetupIntentInput {
  workspaceId: string;
  customerId: string;
  setupIntentId: string;
  recordedAt: string;
}

export interface RecordBillingSubscriptionInput {
  workspaceId: string;
  customerId: string;
  subscriptionId: string;
  latestInvoiceId: string | null;
  periodStartsAt: string;
  periodEndsAt: string;
  priceId: string;
  status: string;
  recordedAt: string;
}

/** Internal persistence seam; implementations expose no provider fields to clients. */
export interface BillingRepository {
  claimPaymentSetupAttempt(input: {
    requestedAt: string;
    requestId: string;
    workspaceId: string;
  }): Promise<{
    allowed: boolean;
    replayed: boolean;
    retryAfterSeconds: number;
  }>;
  getWorkspaceAccount(workspaceId: string): Promise<WorkspaceBillingAccount>;
  recordCustomer(input: RecordBillingCustomerInput): Promise<void>;
  recordSetupIntent(input: RecordBillingSetupIntentInput): Promise<void>;
  recordSubscription(input: RecordBillingSubscriptionInput): Promise<void>;
}
