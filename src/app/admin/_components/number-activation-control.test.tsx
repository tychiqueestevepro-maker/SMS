// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  activate: vi.fn(),
  approveAndActivate: vi.fn(),
}));

vi.mock("@/app/admin/actions", () => ({
  activateApprovedNumberAction: actions.activate,
  approveAndActivatePendingNumberAction: actions.approveAndActivate,
}));

import { NumberActivationControl } from "./number-activation-control";

describe("NumberActivationControl", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("sends only the number ID to the protected admin action", async () => {
    actions.activate.mockResolvedValue({ message: "Phone number activated.", ok: true });
    render(<NumberActivationControl numberId="number_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => expect(actions.activate).toHaveBeenCalledWith("number_1"));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Phone number activated.",
    );
  });

  it("renders only the stable Pending failure returned by the action", async () => {
    actions.activate.mockResolvedValue({
      code: "NUMBER_ACTIVATION_FAILED",
      message: "The phone number couldn't be activated. It remains Pending.",
      ok: false,
    });
    render(<NumberActivationControl numberId="number_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The phone number couldn't be activated. It remains Pending.",
    );
  });

  it("requires confirmation before approving setup and activating", async () => {
    actions.approveAndActivate.mockResolvedValue({
      message: "Phone number activated.",
      ok: true,
    });
    render(
      <NumberActivationControl
        approveFirst
        numberId="number_1"
        workspaceId="workspace_1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve & activate" }));
    expect(actions.approveAndActivate).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Confirm that registration is approved and Advanced Opt-Out is enabled for the Messaging Service. This may activate the workspace plan.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(actions.approveAndActivate).toHaveBeenCalledWith(
        "number_1",
        "workspace_1",
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Phone number activated.",
    );
  });
});
