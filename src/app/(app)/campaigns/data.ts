import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  CampaignClientStatus,
  CampaignContactOption,
  CampaignEditorDto,
  CampaignListItemDto,
  CampaignPhoneOption,
} from "@/components/campaigns/types";
import { calculateCampaignStatistics } from "@/lib/campaigns/statistics";
import type {
  CampaignLaunchAssessment,
  CampaignStatistics,
  CampaignStatisticsOutboundMessage,
  CampaignStatisticsRecipient,
} from "@/lib/campaigns/types";
import type { DeliveryState, DispatchState } from "@/lib/messaging/types";
import { parseAndNormalizePhoneNumber } from "@/lib/contacts/phone";
import { loadCustomerBillingCapabilities } from "@/lib/billing/customer-capabilities.server";
import { createClient } from "@/lib/supabase/server";

type WorkspaceContext = {
  id: string;
};

type CampaignRow = {
  id: string;
  name: string;
  status: string;
  phone_number_id: string | null;
  timezone: string;
  send_window_start: string;
  send_window_end: string;
  drip_interval_minutes: number;
  sending_days: number[];
  created_at: string;
  updated_at: string;
};

type StepRow = {
  id: string;
  campaign_id: string;
  body: string;
  step_order: number;
  wait_days_after_previous: number | null;
};

type RecipientRow = {
  id: string;
  campaign_id: string;
  contact_id: string;
  state: CampaignStatisticsRecipient["state"];
  next_send_at: string | null;
  replied_at: string | null;
};

type DraftContactRow = {
  campaign_id: string;
  contact_id: string;
};

type MessageRow = {
  campaign_recipient_id: string;
  dispatch_state: DispatchState;
  delivery_state: DeliveryState;
  accepted_at: string | null;
};

type ContactRow = {
  id: string;
  first_name: string;
  last_name: string;
  company: string;
  phone_e164: string;
  deleted_at: string | null;
};

type PhoneRow = {
  id: string;
  phone_e164: string;
  status: string;
};

const emptyStatistics: CampaignStatistics = { replies: 0, remaining: 0, replyRate: 0, sentRecipients: 0 };

function clientStatus(status: string): CampaignClientStatus {
  if (status === "draft" || status === "active" || status === "paused" || status === "finished") return status;
  return "finished";
}

async function workspaceForCurrentUser(supabase: SupabaseClient): Promise<WorkspaceContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id as string };
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function launchAssessmentFromRpc(value: unknown): CampaignLaunchAssessment | null {
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const row = source as Record<string, unknown>;
  const rawReasons = row.reasons;
  const reasons = Array.isArray(rawReasons) && rawReasons.every(
    (reason): reason is CampaignLaunchAssessment["reasons"][number] =>
      reason === "large_volume" || reason === "possible_overage",
  )
    ? rawReasons
    : null;
  const assessment = {
    currentEffectiveUsageCredits: nonNegativeInteger(row.current_effective_usage_credits),
    eligibleRecipientCount: nonNegativeInteger(row.eligible_recipient_count),
    estimatedFirstStepCredits: nonNegativeInteger(row.estimated_first_step_credits),
    estimatedNewOverageCredits: nonNegativeInteger(row.estimated_new_overage_credits),
    includedCredits: nonNegativeInteger(row.included_credits),
    includedCreditsRemaining: nonNegativeInteger(row.included_credits_remaining),
    projectedUsageCredits: nonNegativeInteger(row.projected_usage_credits),
  };
  if (
    !reasons ||
    Object.values(assessment).some((entry) => entry === null) ||
    typeof row.requires_confirmation !== "boolean" ||
    row.requires_confirmation !== (reasons.length > 0)
  ) {
    return null;
  }

  return {
    currentEffectiveUsageCredits: assessment.currentEffectiveUsageCredits!,
    eligibleRecipientCount: assessment.eligibleRecipientCount!,
    estimatedFirstStepCredits: assessment.estimatedFirstStepCredits!,
    estimatedNewOverageCredits: assessment.estimatedNewOverageCredits!,
    includedCredits: assessment.includedCredits!,
    includedCreditsRemaining: assessment.includedCreditsRemaining!,
    projectedUsageCredits: assessment.projectedUsageCredits!,
    reasons,
    requiresConfirmation: row.requires_confirmation,
    unsupportedCountryCount: typeof row.unsupported_country_count === "number" ? row.unsupported_country_count : 0,
  };
}

function statisticsForCampaign(
  campaignId: string,
  recipients: RecipientRow[],
  messages: MessageRow[],
): CampaignStatistics {
  const campaignRecipients = recipients.filter((recipient) => recipient.campaign_id === campaignId);
  if (campaignRecipients.length === 0) return emptyStatistics;
  const recipientIds = new Set(campaignRecipients.map((recipient) => recipient.id));
  return calculateCampaignStatistics(
    campaignRecipients.map((recipient) => ({
      hasPendingStep: recipient.next_send_at !== null,
      id: recipient.id,
      repliedAt: recipient.replied_at,
      state: recipient.state,
    })),
    messages
      .filter((message) => recipientIds.has(message.campaign_recipient_id))
      .map<CampaignStatisticsOutboundMessage>((message) => ({
        acceptedAt: message.accepted_at,
        campaignRecipientId: message.campaign_recipient_id,
        deliveryState: message.delivery_state,
        dispatchState: message.dispatch_state,
      })),
  );
}

type ExtendedPhoneRow = PhoneRow & {
  label?: string | null;
  country_code?: string | null;
};

export async function loadCampaignList(): Promise<CampaignListItemDto[]> {
  const supabase = await createClient();
  const workspace = await workspaceForCurrentUser(supabase);
  if (!workspace) return [];

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const creatorName = user?.user_metadata?.full_name || user?.email || null;

  const { data: campaignData } = await supabase
    .from("campaigns")
    .select("id,name,status,phone_number_id,created_at,updated_at")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  const campaigns = (campaignData ?? []) as CampaignRow[];
  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map((campaign) => campaign.id);
  const { data: recipientData } = await supabase
    .from("campaign_recipients")
    .select("id,campaign_id,contact_id,state,next_send_at,replied_at")
    .in("campaign_id", campaignIds);
  const recipients = (recipientData ?? []) as RecipientRow[];
  const recipientIds = recipients.map((recipient) => recipient.id);
  const { data: messageData } = recipientIds.length
    ? await supabase
        .from("messages")
        .select("campaign_recipient_id,dispatch_state,delivery_state,accepted_at")
        .in("campaign_recipient_id", recipientIds)
    : { data: [] };
  const messages = (messageData ?? []) as MessageRow[];

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  return campaigns.map((campaign) => {
    const campaignRecipients = recipients.filter((r) => r.campaign_id === campaign.id);
    const recentReplies = campaignRecipients.filter(
      (r) => r.replied_at && new Date(r.replied_at).getTime() >= oneDayAgo,
    ).length;

    let recentActivity: string | null = null;
    if (campaign.status === "draft") {
      recentActivity = "Not started yet";
    } else if (recentReplies > 0) {
      recentActivity = `${recentReplies} ${recentReplies === 1 ? "reply" : "replies"} in the last 24h`;
    } else {
      recentActivity = "No recent activity";
    }

    return {
      createdAt: campaign.created_at,
      creatorName,
      id: campaign.id,
      name: campaign.name,
      phoneNumberId: campaign.phone_number_id,
      recentActivity,
      recipientCount: new Set(campaignRecipients.map((r) => r.contact_id)).size,
      statistics: statisticsForCampaign(campaign.id, recipients, messages),
      status: clientStatus(campaign.status),
      updatedAt: campaign.updated_at,
    };
  });
}

async function loadCampaignRows(supabase: SupabaseClient, workspaceId: string, campaignId: string) {
  const [
    { data: campaignData },
    { data: stepData },
    { data: recipientData },
    { data: draftContactData },
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select("id,name,status,phone_number_id,timezone,send_window_start,send_window_end,sending_days,drip_interval_minutes,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("id", campaignId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("campaign_steps").select("id,campaign_id,body,step_order,wait_days_after_previous").eq("campaign_id", campaignId).order("step_order"),
    supabase.from("campaign_recipients").select("id,campaign_id,contact_id,state,next_send_at,replied_at").eq("campaign_id", campaignId),
    supabase
      .from("campaign_draft_contacts")
      .select("campaign_id,contact_id")
      .eq("campaign_id", campaignId),
  ]);
  return {
    campaign: (campaignData as CampaignRow | null) ?? null,
    draftContacts: (draftContactData ?? []) as DraftContactRow[],
    recipients: (recipientData ?? []) as RecipientRow[],
    steps: (stepData ?? []) as StepRow[],
  };
}

export async function loadCampaignEditor(campaignId?: string): Promise<CampaignEditorDto | null> {
  const supabase = await createClient();
  const workspace = await workspaceForCurrentUser(supabase);
  if (!workspace) return null;

  const [contactResponse, suppressionResponse, phoneResponse, activeRecipientResponse, activeCampaignsResponse, capabilities] = await Promise.all([
    supabase.from("contacts").select("id,first_name,last_name,company,phone_e164,deleted_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
    supabase.from("suppressions").select("phone_e164").eq("workspace_id", workspace.id),
    supabase.from("phone_numbers").select("id,phone_e164,status,country_code").eq("workspace_id", workspace.id).is("deleted_at", null).order("created_at"),
    supabase.from("campaign_recipients").select("contact_id,campaign_id,state").eq("state", "active"),
    supabase.from("campaigns").select("phone_number_id").eq("workspace_id", workspace.id).eq("status", "active").is("deleted_at", null),
    loadCustomerBillingCapabilities(supabase),
  ]);
  const contacts = (contactResponse.data ?? []) as ContactRow[];
  const suppressed = new Set((suppressionResponse.data ?? []).map((row) => row.phone_e164 as string));
  const activeRecipients = (activeRecipientResponse.data ?? []) as Array<{ contact_id: string; campaign_id: string; state: string }>;
  const assignedPhoneIds = new Set((activeCampaignsResponse.data ?? []).map((c) => c.phone_number_id).filter(Boolean));

  const phoneNumbers: CampaignPhoneOption[] = ((phoneResponse.data ?? []) as ExtendedPhoneRow[]).flatMap((phone) => {
    if (phone.status !== "ready" && phone.status !== "pending") return [];
    const parsed = parseAndNormalizePhoneNumber(phone.phone_e164);
    const countryCode = phone.country_code || parsed?.countryCode || (phone.phone_e164.startsWith("+33") ? "FR" : phone.phone_e164.startsWith("+1") ? "US" : "US");
    return [{
      countryCode,
      id: phone.id,
      inUse: assignedPhoneIds.has(phone.id),
      label: phone.label || (assignedPhoneIds.has(phone.id) ? "In use" : "Default"),
      phoneNumber: phone.phone_e164,
      status: phone.status as "ready" | "pending",
    }];
  });

  let campaign: CampaignRow | null = null;
  let steps: StepRow[] = [];
  let recipients: RecipientRow[] = [];
  let draftContacts: DraftContactRow[] = [];
  let messages: MessageRow[] = [];
  if (campaignId) {
    const rows = await loadCampaignRows(supabase, workspace.id, campaignId);
    campaign = rows.campaign;
    draftContacts = rows.draftContacts;
    steps = rows.steps;
    recipients = rows.recipients;
    if (!campaign) return null;
    const recipientIds = recipients.map((recipient) => recipient.id);
    if (recipientIds.length > 0) {
      const response = await supabase
        .from("messages")
        .select("campaign_recipient_id,dispatch_state,delivery_state,accepted_at")
        .in("campaign_recipient_id", recipientIds);
      messages = (response.data ?? []) as MessageRow[];
    }
  }

  const contactOptions: CampaignContactOption[] = contacts.map((contact) => ({
    company: contact.company,
    contactId: contact.id,
    deletedAt: contact.deleted_at,
    firstName: contact.first_name,
    hasActiveSequence: activeRecipients.some((recipient) => recipient.contact_id === contact.id && recipient.campaign_id !== campaignId),
    isSuppressed: suppressed.has(contact.phone_e164),
    lastName: contact.last_name,
    name: `${contact.first_name} ${contact.last_name}`.trim() || contact.phone_e164,
    phoneNumber: contact.phone_e164,
  }));

  const selectedContactIds = campaign?.status === "draft"
    ? draftContacts.map((selection) => selection.contact_id)
    : recipients.map((recipient) => recipient.contact_id);

  let activeMonitoring: CampaignEditorDto["activeMonitoring"] = null;

  if (campaign && campaign.status !== "draft") {
    // Fetch all messages for workspace & campaign contacts for response timeline
    const campaignContactIds = Array.from(new Set(recipients.map((r) => r.contact_id)));

    const { data: allMessages } = campaignContactIds.length
      ? await supabase
          .from("messages")
          .select("id,contact_id,phone_number_id,direction,body,created_at,sent_at,received_at,dispatch_state,delivery_state")
          .eq("workspace_id", workspace.id)
          .in("contact_id", campaignContactIds)
          .order("created_at", { ascending: true })
      : { data: [] };

    const messageList = (allMessages ?? []) as Array<{
      id: string;
      contact_id: string;
      direction: "inbound" | "outbound";
      body: string;
      created_at: string;
      dispatch_state: string;
      delivery_state: string | null;
    }>;

    // Group messages by contact
    const messagesByContact = new Map<string, typeof messageList>();
    messageList.forEach((msg) => {
      const list = messagesByContact.get(msg.contact_id) || [];
      list.push(msg);
      messagesByContact.set(msg.contact_id, list);
    });

    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    const responses = campaignContactIds.map((contactId) => {
      const contact = contactMap.get(contactId);
      const cMessages = messagesByContact.get(contactId) || [];
      const recipient = recipients.find((r) => r.contact_id === contactId);
      const isSuppressed = contact ? suppressed.has(contact.phone_e164) : false;
      const hasReplied = Boolean(recipient?.replied_at) || cMessages.some((m) => m.direction === "inbound");

      let status: "replied" | "opted_out" | "pending" | "sent" = "pending";
      if (isSuppressed) {
        status = "opted_out";
      } else if (hasReplied) {
        status = "replied";
      } else if (cMessages.some((m) => m.direction === "outbound" && m.dispatch_state === "accepted")) {
        status = "sent";
      }

      const lastMsg = cMessages[cMessages.length - 1];

      return {
        company: contact?.company || "",
        contactId,
        contactName: contact ? `${contact.first_name} ${contact.last_name}`.trim() || contact.phone_e164 : "Contact",
        lastMessageBody: lastMsg ? lastMsg.body : "No messages exchanged yet",
        lastMessageTime: lastMsg ? lastMsg.created_at : campaign.created_at,
        messages: cMessages.map((m) => ({
          body: m.body,
          direction: m.direction,
          id: m.id,
          status: m.delivery_state || m.dispatch_state,
          timestamp: m.created_at,
        })),
        optedOut: isSuppressed,
        phone: contact?.phone_e164 || "",
        status,
      };
    });

    const stats = statisticsForCampaign(campaign.id, recipients, messages);
    const totalRecipients = recipientOptionsCount(recipients);
    const messagesSent = stats.sentRecipients;
    const repliesCount = stats.replies;
    const replyRate = stats.replyRate;
    const remainingCount = stats.remaining;
    const optedOutCount = responses.filter((r) => r.status === "opted_out").length;
    const completionPercent = totalRecipients > 0 ? Math.min(100, Math.round(((totalRecipients - remainingCount) / totalRecipients) * 100)) : 0;

    // Build Activity Over Time data (Last 7 days)
    const activityOverTime = buildActivityOverTime(messageList, campaign.created_at);

    // Selected phone number
    const sendingNumber = phoneNumbers.find((p) => p.id === campaign?.phone_number_id) || phoneNumbers[0] || null;

    const lastMsgTime = messageList.length > 0 ? messageList[messageList.length - 1].created_at : campaign.updated_at;

    activeMonitoring = {
      activityOverTime,
      details: {
        avgTimeToReply: calculateAvgTimeToReply(messageList),
        bouncedCount: messageList.filter((m) => m.dispatch_state === "failed" || m.delivery_state === "failed").length,
        fromNumber: sendingNumber?.phoneNumber || "Not set",
        lastActivity: formatTimeAgo(lastMsgTime),
        recipientsCount: totalRecipients,
        sendingDays: campaign.sending_days,
        sequenceName: steps.length > 0 ? `${campaign.name} Sequence (${steps.length} steps)` : campaign.name,
      },
      dripIntervalMinutes: campaign.drip_interval_minutes,
      metrics: {
        completionPercent,
        estimatedCompletionDate: calculateEstimatedCompletion(remainingCount, campaign.drip_interval_minutes),
        messagesSent,
        optedOutCount,
        remainingCount,
        repliesCount,
        replyRate,
        totalRecipients,
      },
      responses,
      sendWindowEnd: campaign.send_window_end,
      sendWindowStart: campaign.send_window_start,
      sendingNumber,
      sequenceName: steps.length > 0 ? steps[0].body.slice(0, 30) + "..." : campaign.name,
      startedAt: campaign.created_at,
      timezone: campaign.timezone,
    };
  }

  return {
    activeMonitoring,
    contacts: contactOptions,
    dripIntervalMinutes: campaign?.drip_interval_minutes ?? 2,
    id: campaign?.id ?? null,
    messagingAvailable: capabilities.canSendMessages,
    name: campaign?.name ?? "New Campaign",
    phoneNumberId: campaign?.phone_number_id ?? null,
    phoneNumbers,
    safetyCapReached: capabilities.safetyCapReached,
    selectedContactIds,
    sendWindowEnd: campaign?.send_window_end ?? "18:00:00",
    sendWindowStart: campaign?.send_window_start ?? "09:00:00",
    sendingDays: campaign?.sending_days ?? [1, 2, 3, 4, 5],
    statistics: campaign ? statisticsForCampaign(campaign.id, recipients, messages) : emptyStatistics,
    status: campaign ? clientStatus(campaign.status) : "draft",
    steps: steps.map((step, index) => ({
      body: step.body,
      id: step.id,
      waitDaysAfterPrevious: index === 0 ? null : step.wait_days_after_previous,
    })),
    timezone: campaign?.timezone ?? "UTC",
  };
}

function recipientOptionsCount(recipients: RecipientRow[]): number {
  return new Set(recipients.map((r) => r.contact_id)).size;
}

function buildActivityOverTime(
  messages: Array<{ created_at: string; direction: "inbound" | "outbound" }>,
  startDateStr: string,
) {
  const days: Array<{ date: string; label: string; sent: number; replies: number; replyRate: number }> = [];
  const endDate = new Date();
  const startDate = new Date(startDateStr);
  const diffDays = Math.max(7, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24)));

  for (let i = Math.min(diffDays - 1, 6); i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const dayMsgs = messages.filter((m) => m.created_at.startsWith(dateKey));
    const sent = dayMsgs.filter((m) => m.direction === "outbound").length;
    const replies = dayMsgs.filter((m) => m.direction === "inbound").length;
    const replyRate = sent > 0 ? Number(((replies / sent) * 100).toFixed(1)) : 0;

    days.push({ date: dateKey, label, replies, replyRate, sent });
  }

  return days;
}

function calculateAvgTimeToReply(messages: Array<{ created_at: string; direction: "inbound" | "outbound"; contact_id: string }>): string {
  const inboundMsgs = messages.filter((m) => m.direction === "inbound");
  if (inboundMsgs.length === 0) return "—";

  let totalMs = 0;
  let count = 0;

  inboundMsgs.forEach((inbound) => {
    const prevOutbound = messages
      .filter((m) => m.contact_id === inbound.contact_id && m.direction === "outbound" && m.created_at < inbound.created_at)
      .pop();

    if (prevOutbound) {
      const diff = new Date(inbound.created_at).getTime() - new Date(prevOutbound.created_at).getTime();
      if (diff > 0 && diff < 30 * 24 * 3600 * 1000) {
        totalMs += diff;
        count++;
      }
    }
  });

  if (count === 0) return "—";
  const avgHours = Math.round(totalMs / (count * 3600 * 1000));
  if (avgHours < 1) return "< 1h";
  if (avgHours < 24) return `${avgHours}h`;
  const days = Math.floor(avgHours / 24);
  const hours = avgHours % 24;
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
}

function formatTimeAgo(timestampStr: string): string {
  const date = new Date(timestampStr);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function calculateEstimatedCompletion(remaining: number, dripMinutes: number): string | null {
  if (remaining <= 0) return "Completed";
  const minutesNeeded = remaining * (dripMinutes || 2);
  const estDate = new Date(Date.now() + minutesNeeded * 60 * 1000);
  return estDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export async function loadCampaignLaunchContext(campaignId: string) {
  const supabase = await createClient();
  const workspace = await workspaceForCurrentUser(supabase);
  if (!workspace) return null;
  const editor = await loadCampaignEditor(campaignId);
  if (!editor || editor.status !== "draft") return null;

  const { data: assessmentData, error: assessmentError } = await supabase.rpc(
    "assess_campaign_launch",
    { p_campaign_id: campaignId },
  );
  if (assessmentError) return null;
  const assessment = launchAssessmentFromRpc(assessmentData);
  if (!assessment) return null;

  return {
    assessment,
    campaign: editor,
    workspaceId: workspace.id,
  };
}
