export type ApprovedNumberActivationClaim = Readonly<{
  activationId: string | null;
  disposition: "claimed" | "already_ready" | "not_approved" | "in_progress";
  numberId: string;
  workspaceId: string;
}>;

export interface AdminNumberActivationRepository {
  claimApprovedNumber(input: {
    adminUserId: string;
    numberId: string;
    requestedAt: string;
  }): Promise<ApprovedNumberActivationClaim>;
  completeApprovedNumber(input: {
    activationId: string;
    adminUserId: string;
    completedAt: string;
    numberId: string;
    periodEndsAt: string;
    periodStartsAt: string;
    subscriptionId: string;
    workspaceId: string;
  }): Promise<void>;
  failApprovedNumber(input: {
    activationId: string;
    adminUserId: string;
    failedAt: string;
    failureCode: string;
    numberId: string;
    workspaceId: string;
  }): Promise<void>;
}
