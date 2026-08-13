export type AutomaticNumberActivationClaim = Readonly<{
  activationId: string | null;
  disposition:
    | "claimed"
    | "already_ready"
    | "provider_not_ready"
    | "in_progress";
  numberId: string;
  workspaceId: string;
}>;

export interface AutomaticNumberActivationRepository {
  claimPurchasedNumber(input: {
    numberId: string;
    requestedAt: string;
    workspaceId: string;
  }): Promise<AutomaticNumberActivationClaim>;
  completePurchasedNumber(input: {
    activationId: string;
    completedAt: string;
    numberId: string;
    periodEndsAt: string;
    periodStartsAt: string;
    subscriptionId: string;
    workspaceId: string;
  }): Promise<void>;
  failPurchasedNumber(input: {
    activationId: string;
    failedAt: string;
    failureCode: string;
    numberId: string;
    workspaceId: string;
  }): Promise<void>;
}
