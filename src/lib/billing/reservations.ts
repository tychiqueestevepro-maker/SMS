import { assertNonNegativeSafeInteger, safeAdd } from "./integer";
import type {
  BillingPeriodUsageState,
  UsageActualizationResult,
  UsageReservation,
  UsageReservationResult,
} from "./types";

function validateUsageState(usage: BillingPeriodUsageState): void {
  assertNonNegativeSafeInteger(
    usage.actualOutboundSegments,
    "Actual outbound segments",
  );
  assertNonNegativeSafeInteger(
    usage.reservedOutboundSegments,
    "Reserved outbound segments",
  );
  assertNonNegativeSafeInteger(usage.safetyCapSegments, "Safety cap segments");
}

export function effectiveOutboundUsage(usage: BillingPeriodUsageState): number {
  validateUsageState(usage);
  return safeAdd(
    usage.actualOutboundSegments,
    usage.reservedOutboundSegments,
    "Effective outbound usage",
  );
}

export function reserveOutboundUsage(
  usage: BillingPeriodUsageState,
  reservationId: string,
  estimatedSegments: number,
): UsageReservationResult {
  validateUsageState(usage);
  assertNonNegativeSafeInteger(estimatedSegments, "Estimated segments");
  if (!reservationId || estimatedSegments === 0) {
    throw new RangeError("A reservation ID and positive estimate are required.");
  }
  const effectiveUsage = effectiveOutboundUsage(usage);
  const projectedUsage = safeAdd(
    effectiveUsage,
    estimatedSegments,
    "Projected effective usage",
  );
  if (projectedUsage > usage.safetyCapSegments) {
    return {
      accepted: false,
      usage: { ...usage },
      reservation: null,
      effectiveUsage,
      safetyCapReached: effectiveUsage >= usage.safetyCapSegments,
      error: "SAFETY_CAP_REACHED",
    };
  }

  const updatedUsage = {
    ...usage,
    reservedOutboundSegments: safeAdd(
      usage.reservedOutboundSegments,
      estimatedSegments,
      "Reserved outbound usage",
    ),
  };
  return {
    accepted: true,
    usage: updatedUsage,
    reservation: {
      id: reservationId,
      estimatedSegments,
      state: "reserved",
      actualSegments: null,
    },
    effectiveUsage: projectedUsage,
    safetyCapReached: projectedUsage >= usage.safetyCapSegments,
    error: null,
  };
}

export function actualizeOutboundReservation(
  usage: BillingPeriodUsageState,
  reservation: UsageReservation,
  actualSegments: number,
): UsageActualizationResult {
  validateUsageState(usage);
  assertNonNegativeSafeInteger(actualSegments, "Actual segments");
  if (actualSegments === 0) {
    throw new RangeError("Actual consumed segments must be positive.");
  }
  if (reservation.state === "actualized") {
    if (reservation.actualSegments !== actualSegments) {
      throw new RangeError("An actualized reservation cannot change segment count.");
    }
    const effectiveUsage = effectiveOutboundUsage(usage);
    return {
      usage: { ...usage },
      reservation: { ...reservation },
      effectiveUsage,
      safetyCapReached: effectiveUsage >= usage.safetyCapSegments,
      replayed: true,
    };
  }
  if (reservation.state !== "reserved") {
    throw new RangeError("A canceled reservation cannot be actualized.");
  }
  if (usage.reservedOutboundSegments < reservation.estimatedSegments) {
    throw new RangeError("Reserved usage is inconsistent with the reservation.");
  }

  const updatedUsage = {
    ...usage,
    reservedOutboundSegments:
      usage.reservedOutboundSegments - reservation.estimatedSegments,
    actualOutboundSegments: safeAdd(
      usage.actualOutboundSegments,
      actualSegments,
      "Actual outbound usage",
    ),
  };
  const effectiveUsage = effectiveOutboundUsage(updatedUsage);
  return {
    usage: updatedUsage,
    reservation: {
      ...reservation,
      state: "actualized",
      actualSegments,
    },
    effectiveUsage,
    safetyCapReached: effectiveUsage >= usage.safetyCapSegments,
    replayed: false,
  };
}

export function cancelOutboundReservation(
  usage: BillingPeriodUsageState,
  reservation: UsageReservation,
): UsageActualizationResult {
  validateUsageState(usage);
  if (reservation.state === "canceled") {
    const effectiveUsage = effectiveOutboundUsage(usage);
    return {
      usage: { ...usage },
      reservation: { ...reservation },
      effectiveUsage,
      safetyCapReached: effectiveUsage >= usage.safetyCapSegments,
      replayed: true,
    };
  }
  if (reservation.state !== "reserved") {
    throw new RangeError("Actualized usage cannot be canceled.");
  }
  if (usage.reservedOutboundSegments < reservation.estimatedSegments) {
    throw new RangeError("Reserved usage is inconsistent with the reservation.");
  }
  const updatedUsage = {
    ...usage,
    reservedOutboundSegments:
      usage.reservedOutboundSegments - reservation.estimatedSegments,
  };
  const effectiveUsage = effectiveOutboundUsage(updatedUsage);
  return {
    usage: updatedUsage,
    reservation: {
      ...reservation,
      state: "canceled",
      actualSegments: null,
    },
    effectiveUsage,
    safetyCapReached: effectiveUsage >= usage.safetyCapSegments,
    replayed: false,
  };
}
