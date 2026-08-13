// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { InboxConversationViewDto } from "./types";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  sendManualMessageAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/app/(app)/inbox/actions", () => ({
  sendManualMessageAction: mocks.sendManualMessageAction,
}));

import { ManualComposer } from "./manual-composer";

const conversation: InboxConversationViewDto = {
  contactId: "contact-1",
  contactLabel: "Alex Smith",
  contactCompany: "",
  contactJobTitle: "",
  contactNotes: "",
  contactPhoneNumber: "+12025550101",
  deletedContact: false,
  id: "contact-1:number-1",
  isSuppressed: false,
  lastMessageAt: "2026-08-10T12:00:00.000Z",
  messages: [],
  phoneNumber: "+15125550192",
  phoneNumberAvailable: true,
  phoneNumberId: "number-1",
  phoneNumberStatus: "ready",
  pipelineStageId: "stage-1",
  readOnly: false,
  sequenceStoppedOnReply: false,
  hasUnreadMessages: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ManualComposer", () => {
  it("prevents an estimated multi-credit message from crossing the safety cap", () => {
    render(
      <ManualComposer
        conversation={conversation}
        effectiveCredits={9_999}
        messagingAvailable
        onResult={vi.fn()}
        safetyCapCredits={10_000}
        safetyCapReached={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Write a message"), {
      target: { value: "a".repeat(161) },
    });

    expect(screen.getByText("This message would exceed your SMS credit safety limit.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/2 SMS credits/)).toBeTruthy();
  });

  it("allows a one-credit message to reach exactly the safety cap", () => {
    render(
      <ManualComposer
        conversation={conversation}
        effectiveCredits={9_999}
        messagingAvailable
        onResult={vi.fn()}
        safetyCapCredits={10_000}
        safetyCapReached={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Write a message"), {
      target: { value: "Short message" },
    });

    expect(screen.queryByText(/would exceed/)).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/1 SMS credit/)).toBeTruthy();
  });

  it("uses the same trimmed body as the server at the credit boundary", () => {
    render(
      <ManualComposer
        conversation={conversation}
        effectiveCredits={9_999}
        messagingAvailable
        onResult={vi.fn()}
        safetyCapCredits={10_000}
        safetyCapReached={false}
      />,
    );

    fireEvent.change(screen.getByLabelText("Write a message"), {
      target: { value: `${"a".repeat(159)}  ` },
    });

    expect(screen.queryByText(/would exceed/)).toBeNull();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/159 characters · 1 SMS credit/)).toBeTruthy();
  });

  it("shows a product-level billing message when messaging is unavailable", () => {
    render(
      <ManualComposer
        conversation={conversation}
        effectiveCredits={0}
        messagingAvailable={false}
        onResult={vi.fn()}
        safetyCapCredits={10_000}
        safetyCapReached={false}
      />,
    );

    expect(
      screen.getByText("Messaging is currently unavailable. Check Billing in Settings."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Write a message")).toBeNull();
  });
});
