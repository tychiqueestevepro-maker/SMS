import "server-only";

import type {
  AdminNumberActivationRepository,
  ApprovedNumberActivationClaim,
} from "./admin-activation-repository";

export interface ActiveWorkspaceSubscription {
  active: true;
  periodEndsAt: string;
  periodStartsAt: string;
  subscriptionId: string;
}

export type EnsureWorkspaceSubscriptionActive = (
  workspaceId: string,
) => Promise<ActiveWorkspaceSubscription>;

export type AdminNumberActivationErrorCode =
  | "NUMBER_NOT_APPROVED"
  | "NUMBER_ACTIVATION_IN_PROGRESS"
  | "NUMBER_ACTIVATION_FAILED";

const MESSAGES: Record<AdminNumberActivationErrorCode, string> = {
  NUMBER_NOT_APPROVED: "This phone number is not approved for activation yet.",
  NUMBER_ACTIVATION_IN_PROGRESS: "This phone number is already being activated.",
  NUMBER_ACTIVATION_FAILED: "The phone number couldn't be activated. It remains Pending.",
};

export class AdminNumberActivationError extends Error {
  constructor(
    readonly code: AdminNumberActivationErrorCode,
    readonly numberId: string,
    readonly workspaceId: string | null,
  ) {
    super(MESSAGES[code]);
    this.name = "AdminNumberActivationError";
  }
}

export interface AdminNumberActivationResult {
  alreadyReady: boolean;
  numberId: string;
  subscriptionId: string | null;
  workspaceId: string;
}

function validPeriod(startsAt: string, endsAt: string): boolean {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export class AdminNumberActivationService {
  private readonly now: () => Date;

  constructor(
    private readonly repository: AdminNumberActivationRepository,
    private readonly ensureSubscriptionActive: EnsureWorkspaceSubscriptionActive,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async activate(input: {
    adminUserId: string;
    numberId: string;
  }): Promise<AdminNumberActivationResult> {
    let claim: ApprovedNumberActivationClaim;
    try {
      claim = await this.repository.claimApprovedNumber({
        adminUserId: input.adminUserId,
        numberId: input.numberId,
        requestedAt: this.timestamp(),
      });
    } catch {
      throw new AdminNumberActivationError(
        "NUMBER_ACTIVATION_FAILED",
        input.numberId,
        null,
      );
    }

    if (claim.disposition === "already_ready") {
      return {
        alreadyReady: true,
        numberId: claim.numberId,
        subscriptionId: null,
        workspaceId: claim.workspaceId,
      };
    }
    if (claim.disposition === "not_approved") {
      throw new AdminNumberActivationError(
        "NUMBER_NOT_APPROVED",
        claim.numberId,
        claim.workspaceId,
      );
    }
    if (claim.disposition === "in_progress" || !claim.activationId) {
      throw new AdminNumberActivationError(
        "NUMBER_ACTIVATION_IN_PROGRESS",
        claim.numberId,
        claim.workspaceId,
      );
    }

    try {
      const subscription = await this.ensureSubscriptionActive(claim.workspaceId);
      if (
        subscription.active !== true ||
        !subscription.subscriptionId.trim() ||
        !validPeriod(subscription.periodStartsAt, subscription.periodEndsAt)
      ) {
        throw new Error("Active subscription correlation is invalid.");
      }
      await this.repository.completeApprovedNumber({
        activationId: claim.activationId,
        adminUserId: input.adminUserId,
        completedAt: this.timestamp(),
        numberId: claim.numberId,
        periodEndsAt: subscription.periodEndsAt,
        periodStartsAt: subscription.periodStartsAt,
        subscriptionId: subscription.subscriptionId,
        workspaceId: claim.workspaceId,
      });
      return {
        alreadyReady: false,
        numberId: claim.numberId,
        subscriptionId: subscription.subscriptionId,
        workspaceId: claim.workspaceId,
      };
    } catch (error) {
      try {
        await this.repository.failApprovedNumber({
          activationId: claim.activationId,
          adminUserId: input.adminUserId,
          failedAt: this.timestamp(),
          failureCode: this.failureCode(error),
          numberId: claim.numberId,
          workspaceId: claim.workspaceId,
        });
      } catch {
        // Failure recording is diagnostic; the number remains Pending because
        // only the correlated completion RPC can transition it to Ready.
      }
      throw new AdminNumberActivationError(
        "NUMBER_ACTIVATION_FAILED",
        claim.numberId,
        claim.workspaceId,
      );
    }
  }

  private failureCode(error: unknown): string {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
    ) {
      return (error as { code: string }).code;
    }
    return "NUMBER_ACTIVATION_FAILED";
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
