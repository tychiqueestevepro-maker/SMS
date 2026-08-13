export type StripeRequestOptions = { idempotencyKey?: string };

export interface StripeSubscriptionRecord {
  id: string;
  items: {
    data: Array<{
      current_period_end: number;
      current_period_start: number;
      price: string | { id: string };
    }>;
  };
  latest_invoice: string | { id: string } | null;
  metadata?: Record<string, string>;
  status: string;
}

export interface StripeInvoiceItemRecord {
  amount: number | null;
  currency: string;
  description: string | null;
  id: string;
  metadata?: Record<string, string>;
}

export interface StripeListPage<T> {
  data: T[];
  has_more: boolean;
}

export interface StripePriceRecord {
  active: boolean;
  currency: string;
  id: string;
  recurring: {
    interval: string;
    interval_count: number;
    usage_type: string;
  } | null;
  unit_amount: number | null;
}

export interface StripePromotionCodeRecord {
  active: boolean;
  code: string;
  customer: string | { id: string } | null;
  expires_at: number | null;
  id: string;
  max_redemptions: number | null;
  times_redeemed: number;
}

export interface StripeClientPort {
  customers: {
    create(params: Record<string, unknown>, options?: StripeRequestOptions): Promise<{ id: string }>;
  };
  setupIntents: {
    create(
      params: Record<string, unknown>,
      options?: StripeRequestOptions,
    ): Promise<{ client_secret: string | null; id: string }>;
    retrieve(id: string): Promise<{
      id: string;
      status: string;
      customer: string | { id: string } | null;
      payment_method: string | { id: string } | null;
      metadata?: Record<string, string>;
    }>;
  };
  billingPortal: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ url: string }>;
    };
  };
  subscriptions: {
    create(
      params: Record<string, unknown>,
      options?: StripeRequestOptions,
    ): Promise<StripeSubscriptionRecord>;
    list(params: Record<string, unknown>): Promise<StripeListPage<StripeSubscriptionRecord>>;
    update(
      id: string,
      params: Record<string, unknown>,
      options?: StripeRequestOptions,
    ): Promise<{ cancel_at_period_end: boolean }>;
  };
  prices: {
    retrieve(id: string): Promise<StripePriceRecord>;
  };
  promotionCodes: {
    list(params: Record<string, unknown>): Promise<StripeListPage<StripePromotionCodeRecord>>;
  };
  invoiceItems: {
    create(
      params: Record<string, unknown>,
      options?: StripeRequestOptions,
    ): Promise<{ id: string }>;
    list(params: Record<string, unknown>): Promise<StripeListPage<StripeInvoiceItemRecord>>;
  };
  webhooks: {
    constructEvent(
      payload: Buffer,
      signature: string,
      secret: string,
    ): { created: number; data: { object: unknown }; id: string; type: string };
  };
}

export interface StripeErrorShape {
  code?: unknown;
  message?: unknown;
  raw?: { code?: unknown; message?: unknown };
}
