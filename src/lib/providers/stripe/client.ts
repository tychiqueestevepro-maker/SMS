import "server-only";

import Stripe from "stripe";

import type { StripeClientPort } from "./types";

export function createStripeClient(secretKey: string): StripeClientPort {
  return new Stripe(secretKey, {
    appInfo: { name: "Riink" },
    maxNetworkRetries: 0,
  }) as unknown as StripeClientPort;
}
