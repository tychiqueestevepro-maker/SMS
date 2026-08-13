// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentMethodDialog } from "./payment-method-dialog";

const mocks = vi.hoisted(() => ({
  confirmCardSetup: vi.fn(),
  getElement: vi.fn(() => ({ element: "card" })),
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: mocks.loadStripe }));

vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    CardElement: ({
      onLoadError,
      onReady,
    }: {
      onLoadError?: () => void;
      onReady?: () => void;
    }) => (
      <div data-testid="embedded-card-field">
        <button onClick={onReady} type="button">Load card field</button>
        <button onClick={onLoadError} type="button">Fail card field</button>
      </div>
    ),
    Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useElements: () => ({ getElement: mocks.getElement }),
    useStripe: () => ({ confirmCardSetup: mocks.confirmCardSetup }),
  };
});

const session = {
  clientSecret: "seti_client_secret",
  kind: "setup" as const,
  ok: true as const,
  publishableKey: "pk_test_public",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function readyAndSubmit() {
  fireEvent.click(screen.getByRole("button", { name: "Load card field" }));
  fireEvent.click(screen.getByRole("button", { name: "Save card" }));
}

describe("PaymentMethodDialog", () => {
  it("maps a card failure to stable Riink copy without rendering the raw SDK error", async () => {
    mocks.confirmCardSetup.mockResolvedValue({
      error: {
        message: "RAW SDK: card was declined by external system",
        type: "card_error",
      },
    });
    const { container } = render(
      <PaymentMethodDialog onClose={vi.fn()} onComplete={vi.fn()} session={session} />,
    );

    await readyAndSubmit();

    expect(await screen.findByText("Check your card details and try again.")).toBeTruthy();
    expect(screen.queryByText(/RAW SDK/)).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain("stripe");
  });

  it("maps technical and loading failures to one generic product error", async () => {
    mocks.confirmCardSetup.mockRejectedValue({
      message: "RAW SDK transport error",
      type: "api_error",
    });
    render(<PaymentMethodDialog onClose={vi.fn()} onComplete={vi.fn()} session={session} />);

    await readyAndSubmit();
    expect(
      await screen.findByText("Payment method couldn't be saved. Please try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/transport error/i)).toBeNull();
  });

  it("closes through the completion callback after a successful SetupIntent", async () => {
    const onComplete = vi.fn();
    mocks.confirmCardSetup.mockResolvedValue({ setupIntent: { status: "succeeded" } });
    render(<PaymentMethodDialog onClose={vi.fn()} onComplete={onComplete} session={session} />);

    await readyAndSubmit();

    expect(onComplete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
