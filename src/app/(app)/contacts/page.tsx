import type { Metadata } from "next";

import { ContactsWorkspace } from "@/components/contacts/contacts-workspace";
import type { PipelineStageDto } from "@/components/contacts/types";
import { PageHeader } from "@/components/page-header";
import type { ContactSearchSource, ExistingContactMatch } from "@/lib/contacts/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Contacts" };

type StageRow = {
  id: string;
  is_default: boolean;
  name: string;
  position: number;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company: string | null;
  phone_e164: string;
  country_code: string;
  pipeline_stage_id: string;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  created_at: string;
  deleted_at: string | null;
  pipeline_stages: { id: string; name: string } | { id: string; name: string }[] | null;
};

type CampaignRecipientRow = {
  contact_id: string;
  campaigns: { name: string } | { name: string }[] | null;
};

export default async function ContactsPage(props: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const page = Number(searchParams?.page) || 1;
  const pageSize = Number(searchParams?.pageSize) || 20;
  const filter = (searchParams?.filter as string) || "all";
  const search = (searchParams?.search as string) || "";
  const view = (searchParams?.view as string) || "list";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: workspace } = user
    ? await supabase.from("workspaces").select("id").eq("owner_id", user.id).maybeSingle()
    : { data: null };

  const workspaceId = workspace?.id;

  if (!workspaceId) {
    return null;
  }

  // 1. Fetch KPI counts
  const [
    { count: totalContacts },
    { count: repliedContacts },
    { count: optedOutContacts },
    { data: campaignRecipientsData },
  ] = await Promise.all([
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("deleted_at", null),
    supabase.from("contacts").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId).is("deleted_at", null).not("last_replied_at", "is", null),
    supabase.from("suppressions").select("*", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase.from("campaign_recipients").select("contact_id").eq("workspace_id", workspaceId),
  ]);

  const uniqueCampaignContacts = new Set(campaignRecipientsData?.map(r => r.contact_id));
  const inCampaignsCount = uniqueCampaignContacts.size;

  const kpis = {
    total: totalContacts ?? 0,
    replied: repliedContacts ?? 0,
    optedOut: optedOutContacts ?? 0,
    inCampaigns: inCampaignsCount,
  };

  // 2. Build Contacts Query
  let contactsQuery = supabase
    .from("contacts")
    .select("id,first_name,last_name,job_title,company,phone_e164,country_code,pipeline_stage_id,last_contacted_at,last_replied_at,created_at,deleted_at,pipeline_stages(id,name)", { count: "exact" })
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null);

  if (filter === "replied") {
    contactsQuery = contactsQuery.not("last_replied_at", "is", null);
  }

  // To filter by opted_out, we would need a join or inner query, which Supabase doesn't easily support directly without a view.
  // We will fetch suppressions first if filtering by opted_out or searching.
  const { data: suppressionData } = await supabase.from("suppressions").select("phone_e164").eq("workspace_id", workspaceId);
  const suppressedPhones = new Set((suppressionData ?? []).map((entry) => entry.phone_e164 as string));

  if (filter === "opted_out") {
    const suppressedPhonesArray = Array.from(suppressedPhones);
    if (suppressedPhonesArray.length > 0) {
      contactsQuery = contactsQuery.in("phone_e164", suppressedPhonesArray);
    } else {
      contactsQuery = contactsQuery.eq("id", "00000000-0000-0000-0000-000000000000"); // forces empty result
    }
  }

  if (search) {
    // Basic ilike on first_name, last_name, company, phone
    const searchPattern = `%${search}%`;
    contactsQuery = contactsQuery.or(`first_name.ilike.${searchPattern},last_name.ilike.${searchPattern},company.ilike.${searchPattern},phone_e164.ilike.${searchPattern}`);
  }

  // If in List view, apply pagination. If Pipeline view, we might need all matching contacts (or just fetch them all up to a large limit).
  const isPipeline = view === "pipeline";
  if (!isPipeline) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    contactsQuery = contactsQuery.order("created_at", { ascending: false }).range(from, to);
  } else {
    // Pipeline usually needs all active contacts
    contactsQuery = contactsQuery.order("created_at", { ascending: false }).limit(1000);
  }

  const [
    { data: stageData },
    { data: contactData, count: searchTotalCount },
    { data: recipientsData },
  ] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id,name,position,is_default")
      .eq("workspace_id", workspaceId)
      .order("position"),
    contactsQuery,
    supabase
      .from("campaign_recipients")
      .select("contact_id,campaigns(name)")
      .eq("workspace_id", workspaceId)
      .is("campaigns.deleted_at", null),
  ]);

  const rawStages = (stageData ?? []) as StageRow[];
  const rawContacts = (contactData ?? []) as unknown as ContactRow[];
  const stageById = new Map(rawStages.map((stage) => [stage.id, stage]));
  
  const campaignByContactId = new Map<string, string>();
  if (recipientsData) {
    for (const rec of recipientsData as unknown as CampaignRecipientRow[]) {
      const campaign = Array.isArray(rec.campaigns) ? rec.campaigns[0] : rec.campaigns;
      if (campaign?.name) {
        campaignByContactId.set(rec.contact_id, campaign.name);
      }
    }
  }

  const contacts: ContactSearchSource[] = rawContacts.map((contact) => {
    const relation = Array.isArray(contact.pipeline_stages) ? contact.pipeline_stages[0] : contact.pipeline_stages;
    return {
      activeCampaignName: campaignByContactId.get(contact.id) ?? null,
      company: contact.company ?? "",
      createdAt: contact.created_at,
      deletedAt: contact.deleted_at,
      firstName: contact.first_name ?? "",
      lastName: contact.last_name ?? "",
      jobTitle: contact.job_title ?? "",
      id: contact.id,
      isSuppressed: suppressedPhones.has(contact.phone_e164),
      lastContactedAt: contact.last_contacted_at,
      lastRepliedAt: contact.last_replied_at,
      phoneE164: contact.phone_e164,
      countryCode: contact.country_code,
      pipelineStageId: contact.pipeline_stage_id,
      pipelineStageName: relation?.name ?? stageById.get(contact.pipeline_stage_id)?.name ?? "Unknown",
    };
  });

  const stages: PipelineStageDto[] = rawStages.map((stage) => ({
    // For pipeline view, counts could be calculated based on the fetched data, or we'd need separate aggregate queries. 
    // We'll calculate based on the current filtered set.
    contactCount: contacts.filter((contact) => contact.pipelineStageId === stage.id).length,
    id: stage.id,
    isDefault: stage.is_default,
    name: stage.name,
    position: stage.position,
  }));
  
  const existingContactMatches: ExistingContactMatch[] = contacts.map((contact) => ({
    deletedAt: contact.deletedAt,
    id: contact.id,
    isSuppressed: contact.isSuppressed,
    phoneE164: contact.phoneE164,
  }));

  return (
    <>
      <PageHeader
        description="Keep your audience organized and move each relationship forward."
        title="Contacts"
      />
      <ContactsWorkspace 
        contacts={contacts} 
        existingContactMatches={existingContactMatches} 
        stages={stages} 
        kpis={kpis}
        pagination={{
          page,
          pageSize,
          total: searchTotalCount ?? 0,
        }}
        filters={{ search, filter, view }}
      />
    </>
  );
}
