import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  customerBillingCapabilitiesFromSummary,
  unavailableCustomerBillingCapabilities,
  type CustomerBillingCapabilities,
} from "./customer-capabilities";

export async function loadCustomerBillingCapabilities(
  client: SupabaseClient,
): Promise<CustomerBillingCapabilities> {
  const { data, error } = await client.rpc("get_billing_usage_summary");
  return error
    ? unavailableCustomerBillingCapabilities
    : customerBillingCapabilitiesFromSummary(data);
}
