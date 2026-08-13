import { assertNonNegativeSafeInteger, safeAdd } from "./integer";
import type {
  BillingUsageLedgerEntry,
  InternalFixedProviderCost,
  InternalProviderCostSummary,
} from "./types";

export function summarizeInternalProviderCosts(
  entries: readonly BillingUsageLedgerEntry[],
  fixedCosts: readonly InternalFixedProviderCost[],
): InternalProviderCostSummary {
  const messageCostMicroUsd = entries.reduce(
    (total, entry) =>
      safeAdd(total, entry.providerCostMicroUsd ?? 0, "Message provider cost"),
    0,
  );
  const fixedCostMicroUsd = fixedCosts.reduce((total, cost) => {
    assertNonNegativeSafeInteger(cost.amountMicroUsd, "Fixed provider cost");
    return safeAdd(total, cost.amountMicroUsd, "Fixed provider cost");
  }, 0);
  return {
    messageCostMicroUsd,
    fixedCostMicroUsd,
    totalProviderCostMicroUsd: safeAdd(
      messageCostMicroUsd,
      fixedCostMicroUsd,
      "Total provider cost",
    ),
  };
}
