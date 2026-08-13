import "server-only";

import type { InboxConversationViewDto, InboxPageData, InboxStageDto } from "@/components/inbox/types";
import { groupInboxConversations } from "@/lib/inbox/conversations";
import type { InboxContactSource, InboxMessageSource, InboxPhoneNumberSource } from "@/lib/inbox/types";
import type { ProductDeliveryStatus } from "@/lib/messaging/types";
import { loadCustomerBillingCapabilities } from "@/lib/billing/customer-capabilities.server";
import { createClient } from "@/lib/supabase/server";

type ContactRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone_e164: string;
  company: string | null;
  job_title: string | null;
  notes: string | null;
  pipeline_stage_id: string;
  deleted_at: string | null;
  has_unread_messages: boolean;
};

type PhoneRow = {
  id: string;
  phone_e164: string;
  status: "pending" | "ready";
  deleted_at: string | null;
};

type RepliedRecipientRow = {
  campaign_id: string;
  contact_id: string;
};

type CampaignNumberRow = {
  id: string;
  phone_number_id: string | null;
};

type MessageRow = {
  id: string;
  contact_id: string;
  phone_number_id: string;
  direction: "inbound" | "outbound";
  body: string;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  dispatch_state: string;
  delivery_state: string | null;
  campaign_id: string | null;
  step_order: number | null;
};

type CampaignNameRow = {
  id: string;
  name: string;
};

function deliveryStatus(message: MessageRow): ProductDeliveryStatus {
  if (message.direction === "inbound") return "delivered";
  if (message.dispatch_state === "failed" || message.delivery_state === "failed") return "failed";
  if (message.delivery_state === "delivered") return "delivered";
  if (message.dispatch_state === "accepted" || message.delivery_state === "sent") return "sent";
  return "pending";
}

export async function loadInboxData(): Promise<InboxPageData> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { conversations: [], effectiveCredits: 0, messagingAvailable: false, safetyCapCredits: 0, safetyCapReached: false, stages: [], workspaceId: null };

  const { data: workspace } = await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle();
  const workspaceId = (workspace?.id as string | undefined) ?? null;
  if (!workspaceId) return { conversations: [], effectiveCredits: 0, messagingAvailable: false, safetyCapCredits: 0, safetyCapReached: false, stages: [], workspaceId: null };

  const [phoneResponse, messageResponse, stageResponse, repliedRecipientResponse, capabilities] = await Promise.all([
    supabase.from("phone_numbers").select("id,phone_e164,status,deleted_at").eq("workspace_id", workspaceId),
    supabase
      .from("messages")
      .select("id,contact_id,phone_number_id,direction,body,created_at,sent_at,received_at,dispatch_state,delivery_state,campaign_id,step_order")
      .eq("workspace_id", workspaceId)
      .or("direction.eq.inbound,dispatch_state.in.(accepted,failed)")
      .order("created_at"),
    supabase.from("pipeline_stages").select("id,name,position").eq("workspace_id", workspaceId).order("position"),
    supabase.from("campaign_recipients").select("contact_id,campaign_id").eq("state", "stopped").eq("stop_reason", "reply"),
    loadCustomerBillingCapabilities(supabase),
  ]);

  const phoneRows = (phoneResponse.data ?? []) as PhoneRow[];
  const messageRows = (messageResponse.data ?? []) as MessageRow[];
  const repliedRecipients = (repliedRecipientResponse.data ?? []) as RepliedRecipientRow[];

  const contactIdsToFetch = Array.from(new Set([
    ...messageRows.map((m) => m.contact_id),
    ...repliedRecipients.map((r) => r.contact_id),
  ]));

  const [contactResponse, suppressionResponse] = await Promise.all([
    contactIdsToFetch.length
      ? supabase.from("contacts").select("id,first_name,last_name,phone_e164,company,job_title,notes,pipeline_stage_id,deleted_at,has_unread_messages").eq("workspace_id", workspaceId).in("id", contactIdsToFetch)
      : Promise.resolve({ data: [] }),
    supabase.from("suppressions").select("phone_e164").eq("workspace_id", workspaceId),
  ]);

  const contactRows = (contactResponse.data ?? []) as ContactRow[];
  const suppressedPhones = new Set((suppressionResponse.data ?? []).map((row) => row.phone_e164 as string));
  const repliedCampaignIds = Array.from(
    new Set(repliedRecipients.map((recipient) => recipient.campaign_id)),
  );
  
  const uniqueMessageCampaignIds = Array.from(
    new Set(messageRows.map((msg) => msg.campaign_id).filter((id): id is string => id !== null))
  );
  
  const allCampaignIdsToFetch = Array.from(new Set([...repliedCampaignIds, ...uniqueMessageCampaignIds]));
  
  const { data: campaignData } = allCampaignIdsToFetch.length
    ? await supabase
        .from("campaigns")
        .select("id,name,phone_number_id")
        .eq("workspace_id", workspaceId)
        .in("id", allCampaignIdsToFetch)
    : { data: [] };
    
  const campaignPhoneById = new Map(
    ((campaignData ?? []) as CampaignNumberRow[]).map((campaign) => [
      campaign.id,
      campaign.phone_number_id,
    ]),
  );
  const campaignNameById = new Map(
    ((campaignData ?? []) as CampaignNameRow[]).map((campaign) => [
      campaign.id,
      campaign.name,
    ]),
  );
  const stoppedConversationIds = new Set(
    repliedRecipients.flatMap((recipient) => {
      const phoneNumberId = campaignPhoneById.get(recipient.campaign_id);
      return phoneNumberId ? [`${recipient.contact_id}:${phoneNumberId}`] : [];
    }),
  );

  const contacts: InboxContactSource[] = contactRows.map((contact) => ({
    deletedAt: contact.deleted_at,
    firstName: contact.first_name,
    lastName: contact.last_name,
    company: contact.company ?? "",
    jobTitle: contact.job_title ?? "",
    notes: contact.notes ?? "",
    id: contact.id,
    isSuppressed: suppressedPhones.has(contact.phone_e164),
    phoneE164: contact.phone_e164,
    hasUnreadMessages: contact.has_unread_messages,
  }));
  const phones: InboxPhoneNumberSource[] = phoneRows.map((phone) => ({
    id: phone.id,
    phoneNumber: phone.phone_e164,
    status: phone.status,
  }));
  const messages: InboxMessageSource[] = messageRows.map((message) => ({
    body: message.body,
    contactId: message.contact_id,
    deliveryStatus: deliveryStatus(message),
    direction: message.direction,
    id: message.id,
    occurredAt: message.received_at ?? message.sent_at ?? message.created_at,
    phoneNumberId: message.phone_number_id,
    campaignId: message.campaign_id,
    stepOrder: message.step_order,
  }));
  const contactById = new Map(contactRows.map((contact) => [contact.id, contact]));
  const phoneById = new Map(phoneRows.map((phone) => [phone.id, phone]));
  const safeConversations = groupInboxConversations(messages, contacts, phones);
  const conversations: InboxConversationViewDto[] = safeConversations.map((conversation) => {
    const contact = contactById.get(conversation.contactId);
    const phone = phoneById.get(conversation.phoneNumberId);
    
    let campaignContext: { name: string; stepOrder: number } | null = null;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const msg = conversation.messages[i]!;
      if (msg.direction === "outbound" && msg.campaignId) {
        const name = campaignNameById.get(msg.campaignId);
        if (name) {
          campaignContext = { name, stepOrder: msg.stepOrder ?? 1 };
          break;
        }
      }
    }

    return {
      ...conversation,
      isSuppressed: contact ? suppressedPhones.has(contact.phone_e164) : false,
      phoneNumberAvailable: phone?.deleted_at === null,
      phoneNumberStatus: phone?.status ?? "pending",
      pipelineStageId: contact?.pipeline_stage_id ?? "",
      sequenceStoppedOnReply: stoppedConversationIds.has(conversation.id),
      campaignContext,
    };
  });
  const stages: InboxStageDto[] = (stageResponse.data ?? []).map((stage) => ({ id: stage.id as string, name: stage.name as string }));
  return {
    conversations,
    effectiveCredits: capabilities.effectiveCredits,
    messagingAvailable: capabilities.canSendMessages,
    safetyCapCredits: capabilities.safetyCapCredits,
    safetyCapReached: capabilities.safetyCapReached,
    stages,
    workspaceId,
  };
}
