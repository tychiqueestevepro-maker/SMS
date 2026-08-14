// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CampaignTestSendDialog } from "./campaign-test-send-dialog";

const mocks = vi.hoisted(() => ({
  sendCampaignTestMessageAction: vi.fn(),
}));

vi.mock("@/app/(app)/campaigns/actions", () => ({
  sendCampaignTestMessageAction: mocks.sendCampaignTestMessageAction,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "99999999-9999-4999-8999-999999999999",
  );
});

describe("CampaignTestSendDialog", () => {
  it("disables and grays the send button while one request is pending", async () => {
    let resolveRequest: ((value: { message: string; ok: boolean }) => void) | undefined;
    mocks.sendCampaignTestMessageAction.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );

    render(
      <CampaignTestSendDialog
        body="Bonjour {{first_name}}"
        isOpen
        onClose={vi.fn()}
        phoneNumberId="33333333-3333-4333-8333-333333333333"
      />,
    );

    fireEvent.change(screen.getByLabelText("Recipient phone number"), {
      target: { value: "06 12 34 56 78" },
    });
    const sendButton = screen.getByRole("button", { name: "Send test" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(mocks.sendCampaignTestMessageAction).toHaveBeenCalledTimes(1);
    const pendingButton = screen.getByRole("button", { name: "Sending test..." });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    expect(pendingButton.className).toContain("disabled:bg-[#949D97]");

    resolveRequest?.({ message: "Test message accepted for delivery.", ok: true });
    await waitFor(() => {
      expect(screen.getByText("Test message accepted for delivery.")).toBeTruthy();
    });
  });

  it("shows the rendered first message and its segment estimate", () => {
    render(
      <CampaignTestSendDialog
        body="Bonjour {{first_name}} de {{company}}"
        isOpen
        onClose={vi.fn()}
        phoneNumberId="33333333-3333-4333-8333-333333333333"
      />,
    );

    expect(screen.getByText("Bonjour Test de Riink")).toBeTruthy();
    expect(screen.getByText(/SMS segment/)).toBeTruthy();
  });
});
