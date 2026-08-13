import type {
  ResolvedSmsWebhookContext,
  SmsWebhookRoutingKey,
  VerifiedSmsWebhookMutation,
} from "./types";

export interface ApplyVerifiedEventResult {
  duplicate: boolean;
  contactId: string | null;
  inboundMessageId: string | null;
  deletedContact: boolean;
  associatedCampaignRecipientId: string | null;
}

/**
 * Server-only persistence boundary, implementable with Supabase/PostgREST.
 *
 * Routing never trusts a workspace supplied by the HTTP request: inbound events
 * resolve by the Riink phone number and status events by the stored outbound
 * provider identifier. This read-only resolution supplies credentials for
 * signature verification.
 *
 * `applyVerifiedEvent` maps to one `SECURITY DEFINER` PostgreSQL RPC, inaccessible
 * to workspace clients. In that single transaction it must:
 *
 * - re-resolve the event routing key and require it to match the expected
 *   workspace/number/message context used for signature verification;
 * - insert the workspace-scoped event idempotency key, returning `duplicate`
 *   without repeating mutations on conflict;
 * - lock and re-resolve contacts including soft-deleted rows and suppression;
 * - create an unknown contact minimally in the workspace's default stage;
 * - never restore a soft-deleted contact and attach inbound to that same row;
 * - select the latest accepted, non-Failed outbound for the same contact and
 *   Riink number at or before the inbound timestamp;
 * - apply STOP-family suppression, stop active recipients, clear schedules,
 *   and release cancelable reservations;
 * - remove suppression for a confirmed START/UNSTOP without ever resuming a
 *   recipient or campaign;
 * - stop an associated active recipient for any non-opt-out reply and release
 *   cancelable reservations;
 * - apply delivery callbacks idempotently, including a late explicit Failed;
 * - replace estimated usage with actual segments exactly once, retaining the
 *   immutable original billing period/usage position and provider cost;
 * - record inbound provider usage with zero included, overage, and customer
 *   billable amounts.
 *
 * The RPC owns all row locks and commits dedupe plus business mutations
 * atomically. No JavaScript callback is expected to remain inside a DB
 * transaction.
 */
export interface SmsWebhookRepository {
  resolveWebhookContext(
    routingKey: SmsWebhookRoutingKey,
  ): Promise<ResolvedSmsWebhookContext | null>;

  applyVerifiedEvent(
    mutation: VerifiedSmsWebhookMutation,
  ): Promise<ApplyVerifiedEventResult>;
}

