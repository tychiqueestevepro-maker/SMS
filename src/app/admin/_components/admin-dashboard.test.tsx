// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./number-activation-control", () => ({
  NumberActivationControl: ({ approveFirst = false }: { approveFirst?: boolean }) => (
    <button type="button">{approveFirst ? "Approve & activate" : "Activate"}</button>
  ),
}));

import type { AdminDashboardData, AdminNumberRow } from "../types";

import { AdminDashboard } from "./admin-dashboard";

function numberRow(overrides: Partial<AdminNumberRow> = {}): AdminNumberRow {
  return {
    accountSid: "account_1",
    activationEligible: false,
    advancedOptOutConfirmed: false,
    a2pState: "under_review",
    messagingServiceSid: "service_1",
    numberId: "number_1",
    phoneNumber: "+14155550123",
    productStatus: "pending",
    provider: "provider",
    providerErrorCode: null,
    providerErrorMessage: null,
    providerNumberId: "provider_number_1",
    providerStatus: "active",
    setupState: "under_review",
    updatedAt: "2026-08-10T12:00:00.000Z",
    workspaceId: "workspace_1",
    workspaceName: "Workspace",
    ...overrides,
  };
}

function dashboard(numbers: AdminNumberRow[]): AdminDashboardData {
  return {
    billing: { rows: [], status: "ready" },
    customers: { rows: [], status: "ready" },
    generatedAt: "2026-08-10T12:00:00.000Z",
    messages: { rows: [], status: "ready" },
    numbers: { rows: numbers, status: "ready" },
  };
}

afterEach(cleanup);

describe("AdminDashboard number operations", () => {
  it("renders an approval path for a Pending number not yet eligible", () => {
    render(<AdminDashboard data={dashboard([numberRow()])} />);

    expect(screen.getByRole("button", { name: "Approve & activate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activate" })).not.toBeInTheDocument();
  });

  it("renders direct activation only after setup is approved", () => {
    render(
      <AdminDashboard
        data={dashboard([
          numberRow({
            activationEligible: true,
            advancedOptOutConfirmed: true,
            a2pState: "approved",
            setupState: "approved",
          }),
        ])}
      />,
    );

    expect(screen.getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve & activate" })).not.toBeInTheDocument();
  });
});
