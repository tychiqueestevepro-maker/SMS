import "server-only";

import { createStripeClient } from "./client";
import { StripeBillingGateway } from "./gateway";

let gateway: StripeBillingGateway | undefined;

export function stripeBillingGatewayFromEnvironment(): StripeBillingGateway {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Riink billing provider configuration is missing.");
  gateway ??= new StripeBillingGateway(createStripeClient(secretKey));
  return gateway;
}
