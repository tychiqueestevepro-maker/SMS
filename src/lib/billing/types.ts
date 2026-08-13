export interface BillingPlanSnapshotInput {
  planId: string;
  planVersion: number;
  monthlyPriceCents: number;
  includedSegments: number;
  overagePriceMicroUsd: number;
  maxPhoneNumbers: number;
  safetyCapSegments: number;
}

export type BillingPlanSnapshot = Readonly<BillingPlanSnapshotInput>;

export interface BillingPeriodSnapshotInput {
  id: string;
  workspaceId: string;
  startsAt: string;
  endsAt: string;
  plan: BillingPlanSnapshotInput;
}

export interface BillingPeriodSnapshot {
  readonly id: string;
  readonly workspaceId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly plan: BillingPlanSnapshot;
}

export type BillingMessageDirection = "inbound" | "outbound";
export type BillingDispatchOutcome = "sent" | "failed" | "unknown";

export interface BillingMessageUsage {
  messageId: string;
  billingPeriodId: string;
  direction: BillingMessageDirection;
  /** Immutable order assigned when an outbound is accepted. */
  usagePosition: number | null;
  numSegments: number | null;
  providerCostMicroUsd: number | null;
  dispatchOutcome: BillingDispatchOutcome;
  billedOverageSegments?: number;
  billedCustomerAmountMicroUsd?: number;
}

export interface BillingUsageLedgerEntry {
  messageId: string;
  billingPeriodId: string;
  direction: BillingMessageDirection;
  usagePosition: number | null;
  numSegments: number | null;
  providerCostMicroUsd: number | null;
  includedSegments: number | null;
  overageSegments: number | null;
  customerBillableAmountMicroUsd: number | null;
  billedOverageSegments: number;
  billedCustomerAmountMicroUsd: number;
}

export interface PeriodUsageAllocation {
  periodId: string;
  entries: BillingUsageLedgerEntry[];
  pendingOutboundMessageIds: string[];
  actualOutboundSegments: number;
  includedOutboundSegments: number;
  overageOutboundSegments: number;
  customerBillableAmountMicroUsd: number;
  providerMessageCostMicroUsd: number;
}

export interface BillingPeriodUsageState {
  actualOutboundSegments: number;
  reservedOutboundSegments: number;
  safetyCapSegments: number;
}

export type UsageReservationState = "reserved" | "actualized" | "canceled";

export interface UsageReservation {
  id: string;
  estimatedSegments: number;
  state: UsageReservationState;
  actualSegments: number | null;
}

export interface UsageReservationResult {
  accepted: boolean;
  usage: BillingPeriodUsageState;
  reservation: UsageReservation | null;
  effectiveUsage: number;
  safetyCapReached: boolean;
  error: "SAFETY_CAP_REACHED" | null;
}

export interface UsageActualizationResult {
  usage: BillingPeriodUsageState;
  reservation: UsageReservation;
  effectiveUsage: number;
  safetyCapReached: boolean;
  replayed: boolean;
}

export type SmsUsageWarningLevel = "75" | "90" | "100";

export interface SmsUsageWarning {
  level: SmsUsageWarningLevel;
  text: string;
}

export interface CustomerSmsUsageDto {
  title: "SMS usage";
  usedCredits: number;
  includedCredits: number;
  additionalCredits: number;
  additionalUsageAmountMicroUsd: number;
  primaryText: string;
  additionalCreditsText: string | null;
  additionalUsageText: string | null;
  helperText: string;
  warning: SmsUsageWarning | null;
  safetyCapCredits: number;
  safetyCapReached: boolean;
}

export interface AggregatedAdditionalUsage {
  description: "Additional SMS usage";
  additionalCredits: number;
  amountMicroUsd: number;
  sourcePeriodIds: string[];
  ledgerMessageIds: string[];
}

export interface BillingInvoiceRun {
  idempotencyKey: string;
  workspaceId: string;
  stripeInvoiceId: string;
  status: "pending" | "no_usage";
  amountMicroUsd: number;
  additionalCredits: number;
  sourcePeriodIds: readonly string[];
  ledgerMessageIds: readonly string[];
  createdAt: string;
}

export interface AdditionalUsageInvoiceLine {
  description: "Additional SMS usage";
  amountMicroUsd: number;
}

export interface PreparedInvoiceRun {
  run: BillingInvoiceRun;
  line: AdditionalUsageInvoiceLine | null;
  replayed: boolean;
}

export type InternalFixedProviderCostCategory =
  | "phone_number"
  | "telecom_setup"
  | "compliance";

export interface InternalFixedProviderCost {
  id: string;
  billingPeriodId: string;
  category: InternalFixedProviderCostCategory;
  amountMicroUsd: number;
}

export interface InternalProviderCostSummary {
  messageCostMicroUsd: number;
  fixedCostMicroUsd: number;
  totalProviderCostMicroUsd: number;
}

export interface LateReconciliationResult {
  originalPeriodId: string;
  originalUsagePosition: number;
  reconciledMessage: BillingMessageUsage;
  allocation: PeriodUsageAllocation;
  allocationDeltaMicroUsd: number;
  unpaidOverageSegments: number;
  unpaidAmountMicroUsd: number;
  replayed: boolean;
}
