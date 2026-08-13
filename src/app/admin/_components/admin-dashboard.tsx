import {
  Activity,
  AlertTriangle,
  Building2,
  Database,
  DollarSign,
  Phone,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMicroUsd } from "@/lib/billing";

import type {
  AdminBillingOperationRow,
  AdminCustomerRow,
  AdminDashboardData,
  AdminDataSection,
  AdminMessageOperationRow,
  AdminNumberRow,
} from "../types";
import { SafetyCapControl } from "./safety-cap-control";
import { NumberActivationControl } from "./number-activation-control";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatPhone(value: string) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(value);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : value || "—";
}

function providerCost(value: number | null, currency: string | null = "USD") {
  if (value === null) return "Pending";
  if (!currency || currency.toUpperCase() === "USD") return formatMicroUsd(value);
  return `${value.toLocaleString("en-US")} micro ${currency.toUpperCase()}`;
}

function idValue(value: string | null) {
  if (!value) return <span className="text-[#9aa39d]">—</span>;
  return (
    <code className="block max-w-48 truncate rounded bg-[#f1f4f2] px-1.5 py-1 text-[11px] text-[#536159]" title={value}>
      {value}
    </code>
  );
}

function statusTone(value: string | null) {
  const normalized = value?.toLowerCase();
  if (normalized === "ready" || normalized === "active" || normalized === "delivered" || normalized === "reconciled") {
    return "success" as const;
  }
  if (
    normalized === "pending" ||
    normalized === "past_due" ||
    normalized === "dispatch_unknown" ||
    normalized === "needs_reconciliation"
  ) {
    return "warning" as const;
  }
  return "neutral" as const;
}

function SectionHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="border-b border-[#e7ebe8] px-5 py-4 sm:px-6">
      <h2 className="text-sm font-semibold text-[#26342b]">{title}</h2>
      <p className="mt-1 text-sm text-[#738078]">{description}</p>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center text-sm text-[#738078] sm:px-6">
      {children}
    </div>
  );
}

function SourceError({ section }: { section: Extract<AdminDataSection<unknown>, { status: "error" }> }) {
  return (
    <div className="m-5 flex items-start gap-3 rounded-lg border border-[#f0cbc6] bg-[#fff3f1] px-4 py-3 text-sm text-[#8f312a] sm:m-6" role="alert">
      <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
      <div>
        <p className="font-semibold">Internal data source unavailable</p>
        <p className="mt-1 break-words text-xs leading-5">{section.error.message}</p>
        {section.error.code ? <code className="mt-1 block text-[11px]">Code: {section.error.code}</code> : null}
      </div>
    </div>
  );
}

function SummaryCard({
  description,
  icon: Icon,
  title,
  value,
}: {
  description: string;
  icon: typeof ShieldCheck;
  title: string;
  value: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-10 place-items-center rounded-lg bg-[#edf3ef] text-[#246b4a]">
          <Icon aria-hidden="true" size={18} />
        </span>
        <p className="text-2xl font-semibold tracking-[-0.035em] text-[#17211b]">{value}</p>
      </div>
      <h2 className="mt-4 text-sm font-semibold text-[#26342b]">{title}</h2>
      <p className="mt-1 text-xs leading-5 text-[#738078]">{description}</p>
    </Card>
  );
}

function CustomersTable({ section }: { section: AdminDataSection<AdminCustomerRow> }) {
  if (section.status === "error") return <SourceError section={section} />;
  if (section.rows.length === 0) return <EmptyState>No customer workspaces found.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1120px] w-full text-left text-xs">
        <thead className="bg-[#fafbfa] text-[#6f7b74]">
          <tr>
            {[
              "Workspace",
              "Owner",
              "Subscription",
              "Numbers",
              "Period usage",
              "Messaging",
              "Safety cap",
            ].map((heading) => <th className="px-4 py-3 font-semibold" key={heading}>{heading}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf0ee]">
          {section.rows.map((customer) => (
            <tr className="align-top" key={customer.workspaceId}>
              <td className="px-4 py-4">
                <p className="font-semibold text-[#26342b]">{customer.workspaceName}</p>
                <div className="mt-1">{idValue(customer.workspaceId)}</div>
                <p className="mt-1 text-[11px] text-[#89938d]">Created {formatDate(customer.createdAt)}</p>
              </td>
              <td className="px-4 py-4 text-[#536159]">
                <p>{customer.ownerName ?? "—"}</p>
                <p className="mt-1">{customer.ownerEmail ?? "—"}</p>
              </td>
              <td className="px-4 py-4">
                <Badge tone={statusTone(customer.subscriptionStatus)}>{customer.subscriptionStatus ?? "Not started"}</Badge>
                <p className="mt-2 text-[#6f7b74]">Payment: {customer.paymentMethodStatus ?? "unknown"}</p>
              </td>
              <td className="px-4 py-4 text-[#536159]">
                <p>{customer.phoneCount} total</p>
                <p className="mt-1">{customer.pendingPhoneCount} pending setup</p>
              </td>
              <td className="px-4 py-4 text-[#536159]">
                <p>{customer.actualCredits.toLocaleString("en-US")} actual segments</p>
                <p className="mt-1">{customer.reservedCredits.toLocaleString("en-US")} reserved</p>
                <p className="mt-1">{customer.includedCredits.toLocaleString("en-US")} included</p>
              </td>
              <td className="px-4 py-4">
                <Badge tone={customer.messagingEnabled ? "success" : "warning"}>{customer.messagingEnabled ? "Enabled" : "Suspended"}</Badge>
                {customer.suspensionReason ? <p className="mt-2 max-w-44 text-[#8f312a]">{customer.suspensionReason}</p> : null}
              </td>
              <td className="px-4 py-4">
                <SafetyCapControl
                  currentCredits={customer.safetyCapCredits}
                  includedCredits={customer.includedCredits}
                  workspaceId={customer.workspaceId}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumbersTable({ section }: { section: AdminDataSection<AdminNumberRow> }) {
  if (section.status === "error") return <SourceError section={section} />;
  if (section.rows.length === 0) return <EmptyState>No phone number setup records found.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1380px] w-full text-left text-xs">
        <thead className="bg-[#fafbfa] text-[#6f7b74]"><tr>{["Phone number", "Workspace", "Riink state", "Provider", "Provider IDs", "A2P / setup", "Provider error", "Activation", "Updated"].map((heading) => <th className="px-4 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-[#edf0ee]">
          {section.rows.map((number) => (
            <tr className="align-top" key={number.numberId}>
              <td className="px-4 py-4"><p className="font-semibold text-[#26342b]">{formatPhone(number.phoneNumber)}</p><div className="mt-1">{idValue(number.numberId)}</div></td>
              <td className="px-4 py-4"><p className="font-medium text-[#536159]">{number.workspaceName}</p><div className="mt-1">{idValue(number.workspaceId)}</div></td>
              <td className="px-4 py-4"><Badge tone={statusTone(number.productStatus)}>{number.productStatus}</Badge></td>
              <td className="px-4 py-4 text-[#536159]"><p>{number.provider ?? "—"}</p><p className="mt-1">Status: {number.providerStatus ?? "unknown"}</p></td>
              <td className="space-y-1 px-4 py-4"><div>{idValue(number.providerNumberId)}</div><div>{idValue(number.accountSid)}</div><div>{idValue(number.messagingServiceSid)}</div></td>
              <td className="px-4 py-4 text-[#536159]"><p>Setup: {number.setupState ?? "unknown"}</p><p className="mt-1">A2P: {number.a2pState ?? "unknown"}</p><p className="mt-1">Advanced Opt-Out: {number.advancedOptOutConfirmed ? "confirmed" : "pending"}</p></td>
              <td className="max-w-64 px-4 py-4 text-[#8f312a]"><p className="font-medium">{number.providerErrorCode ?? "—"}</p><p className="mt-1 break-words leading-5">{number.providerErrorMessage ?? "No provider error"}</p></td>
              <td className="px-4 py-4">
                {number.productStatus === "ready" ? (
                  <span className="text-[#246b4a]">Ready</span>
                ) : number.activationEligible ? (
                  <NumberActivationControl numberId={number.numberId} />
                ) : number.productStatus.toLowerCase() === "pending" ? (
                  <NumberActivationControl
                    approveFirst
                    numberId={number.numberId}
                    workspaceId={number.workspaceId}
                  />
                ) : (
                  <span className="text-[#7a857e]">Awaiting approval</span>
                )}
              </td>
              <td className="px-4 py-4 text-[#6f7b74]">{formatDate(number.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MessageOperationsTable({ section }: { section: AdminDataSection<AdminMessageOperationRow> }) {
  if (section.status === "error") return <SourceError section={section} />;
  if (section.rows.length === 0) return <EmptyState>No messages currently require operator review.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1300px] w-full text-left text-xs">
        <thead className="bg-[#fafbfa] text-[#6f7b74]"><tr>{["Message", "Workspace", "Dispatch", "Delivery", "Provider", "Provider message SID", "Segments", "Provider cost", "Error / reconciliation", "Created"].map((heading) => <th className="px-4 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-[#edf0ee]">
          {section.rows.map((message) => (
            <tr className="align-top" key={message.messageId}>
              <td className="px-4 py-4">{idValue(message.messageId)}<p className="mt-1 text-[#6f7b74]">{message.direction}</p></td>
              <td className="px-4 py-4"><p className="font-medium text-[#536159]">{message.workspaceName}</p><div className="mt-1">{idValue(message.workspaceId)}</div></td>
              <td className="px-4 py-4"><Badge tone={statusTone(message.dispatchState)}>{message.dispatchState}</Badge><p className="mt-2 text-[#6f7b74]">Accepted {formatDate(message.acceptedAt)}</p></td>
              <td className="px-4 py-4"><Badge tone={statusTone(message.deliveryState)}>{message.deliveryState ?? "unknown"}</Badge></td>
              <td className="px-4 py-4 text-[#536159]"><p>{message.provider ?? "—"}</p><p className="mt-1">{message.providerStatus ?? "unknown"}</p></td>
              <td className="px-4 py-4">{idValue(message.providerMessageId)}</td>
              <td className="px-4 py-4 text-[#536159]">{message.numSegments ?? "Pending"}</td>
              <td className="px-4 py-4 font-medium text-[#536159]">{providerCost(message.providerCostMicroUsd, message.providerCurrency)}</td>
              <td className="max-w-72 px-4 py-4"><p className="font-medium text-[#8f312a]">{message.providerErrorCode ?? message.reconciliationReason ?? "—"}</p><p className="mt-1 break-words leading-5 text-[#6f7b74]">{message.providerErrorMessage ?? "No technical error recorded"}</p></td>
              <td className="px-4 py-4 text-[#6f7b74]">{formatDate(message.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillingTable({ section }: { section: AdminDataSection<AdminBillingOperationRow> }) {
  if (section.status === "error") return <SourceError section={section} />;
  if (section.rows.length === 0) return <EmptyState>No billing periods found.</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1320px] w-full text-left text-xs">
        <thead className="bg-[#fafbfa] text-[#6f7b74]"><tr>{["Workspace / period", "Period", "Usage", "Allocation", "Safety cap", "Customer billing", "Provider cost", "Invoice", "Reconciliation"].map((heading) => <th className="px-4 py-3 font-semibold" key={heading}>{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-[#edf0ee]">
          {section.rows.map((period) => (
            <tr className="align-top" key={period.periodId}>
              <td className="px-4 py-4"><p className="font-medium text-[#536159]">{period.workspaceName}</p><div className="mt-1">{idValue(period.periodId)}</div></td>
              <td className="px-4 py-4 text-[#536159]"><Badge tone={statusTone(period.periodStatus)}>{period.periodStatus}</Badge><p className="mt-2">{formatDate(period.periodStart)}</p><p className="mt-1">to {formatDate(period.periodEnd)}</p></td>
              <td className="px-4 py-4 text-[#536159]"><p>{period.actualOutboundSegments.toLocaleString("en-US")} actual segments</p><p className="mt-1">{period.reservedOutboundSegments.toLocaleString("en-US")} reserved</p></td>
              <td className="px-4 py-4 text-[#536159]"><p>{period.includedSegments.toLocaleString("en-US")} included</p><p className="mt-1">{period.overageSegments.toLocaleString("en-US")} overage</p><p className="mt-1">{formatMicroUsd(period.overageAmountMicroUsd)}</p></td>
              <td className="px-4 py-4 text-[#536159]">{period.safetyCapSegments.toLocaleString("en-US")} segments</td>
              <td className="px-4 py-4 font-medium text-[#536159]">Billed {formatMicroUsd(period.billedAmountMicroUsd)}</td>
              <td className="px-4 py-4 font-medium text-[#536159]"><p>{formatMicroUsd(period.providerCostMicroUsd)} total</p><p className="mt-1 text-[#6f7b74]">{formatMicroUsd(period.providerMessageCostMicroUsd)} messages</p><p className="mt-1 text-[#6f7b74]">{formatMicroUsd(period.providerFixedCostMicroUsd)} fixed</p></td>
              <td className="px-4 py-4"><Badge tone={statusTone(period.invoiceStatus)}>{period.invoiceStatus ?? "not invoiced"}</Badge><div className="mt-2">{idValue(period.invoiceId)}</div><div className="mt-1">{idValue(period.invoiceRunId)}</div><div className="mt-1">{idValue(period.subscriptionId)}</div></td>
              <td className="px-4 py-4"><Badge tone={statusTone(period.reconciliationStatus)}>{period.reconciliationStatus ?? "pending data"}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const customers = data.customers.status === "ready" ? data.customers.rows.length : null;
  const pendingNumbers = data.numbers.status === "ready" ? data.numbers.rows.filter((number) => number.productStatus !== "ready").length : null;
  const reconciliation = data.messages.status === "ready" ? data.messages.rows.filter((message) => message.dispatchState === "dispatch_unknown" || Boolean(message.reconciliationReason)).length : null;
  const providerCosts = data.billing.status === "ready" ? data.billing.rows.reduce((total, period) => total + period.providerCostMicroUsd, 0) : null;

  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard description="Visible workspaces in the operator data seam" icon={Building2} title="Customers" value={customers === null ? "—" : customers.toLocaleString("en-US")} />
        <SummaryCard description="Phone numbers that are not Ready" icon={Phone} title="Pending setup" value={pendingNumbers === null ? "—" : pendingNumbers.toLocaleString("en-US")} />
        <SummaryCard description="Ambiguous dispatches and reconciliation work" icon={Activity} title="Needs review" value={reconciliation === null ? "—" : reconciliation.toLocaleString("en-US")} />
        <SummaryCard description="Recorded provider message costs in loaded periods" icon={DollarSign} title="Provider costs" value={providerCosts === null ? "—" : formatMicroUsd(providerCosts)} />
      </div>

      <nav aria-label="Administration sections" className="mt-6 flex flex-wrap gap-2">
        {[{ href: "#customers", icon: ShieldCheck, label: "Customers" }, { href: "#numbers", icon: Phone, label: "Numbers & setup" }, { href: "#messaging", icon: Activity, label: "Messaging" }, { href: "#billing", icon: Database, label: "Billing" }].map(({ href, icon: Icon, label }) => <a className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dfe5e0] bg-white px-3 text-xs font-semibold text-[#536159] hover:bg-[#f8faf8]" href={href} key={href}><Icon aria-hidden="true" size={14} />{label}</a>)}
      </nav>

      <Card className="mt-6 scroll-mt-6 overflow-hidden" id="customers"><SectionHeading description="Workspace access, subscription state, messaging controls, and per-workspace safety caps." title="Customers" /><CustomersTable section={data.customers} /></Card>
      <Card className="mt-6 scroll-mt-6 overflow-hidden" id="numbers"><SectionHeading description="Number setup, provider identifiers, A2P state, and technical failures." title="Phone numbers & setup" /><NumbersTable section={data.numbers} /></Card>
      <Card className="mt-6 scroll-mt-6 overflow-hidden" id="messaging"><SectionHeading description="Dispatch unknown records, actual segments, provider status, errors, and costs." title="Messaging & reconciliation" /><MessageOperationsTable section={data.messages} /></Card>
      <Card className="mt-6 scroll-mt-6 overflow-hidden" id="billing"><SectionHeading description="Billing periods, included/overage allocation, invoice idempotence, reconciliation, and margin inputs." title="Billing operations" /><BillingTable section={data.billing} /></Card>

      <p className="mt-5 text-right text-[11px] text-[#8b958f]">Snapshot generated {formatDate(data.generatedAt)}</p>
    </>
  );
}
