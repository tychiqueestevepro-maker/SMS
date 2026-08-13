import type {
  DeliveryState,
  ProviderMessageStatus,
} from "../../messaging/types";

export function toDeliveryState(
  status: ProviderMessageStatus,
): DeliveryState {
  if (status === "sent") return "sent";
  if (status === "delivered") return "delivered";
  if (status === "failed") return "failed";
  return null;
}

