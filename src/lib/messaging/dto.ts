import type {
  MessageDto,
  MessageProductSource,
  PhoneNumberDto,
  PhoneNumberProductSource,
  ProductDeliveryStatus,
} from "./types";

function toDeliveryStatus(
  source: Pick<MessageProductSource, "deliveryState" | "dispatchState">,
): ProductDeliveryStatus {
  if (
    source.deliveryState === "failed" ||
    source.dispatchState === "failed" ||
    source.dispatchState === "dispatch_unknown"
  ) {
    return "failed";
  }

  if (source.deliveryState === "delivered") {
    return "delivered";
  }

  if (
    source.deliveryState === "sent" ||
    source.dispatchState === "accepted"
  ) {
    return "sent";
  }

  return "pending";
}

export function toMessageDto(source: MessageProductSource): MessageDto {
  return {
    id: source.id,
    direction: source.direction,
    body: source.body,
    createdAt: source.createdAt,
    sentAt: source.sentAt,
    deliveryStatus: toDeliveryStatus(source),
    smsCredits: source.actualSegments ?? source.estimatedSegments,
  };
}

export function toPhoneNumberDto(
  source: PhoneNumberProductSource,
): PhoneNumberDto {
  return {
    id: source.id,
    phoneNumber: source.phoneNumber,
    status: source.status,
    createdAt: source.createdAt,
  };
}
