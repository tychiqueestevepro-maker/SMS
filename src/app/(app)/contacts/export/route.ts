import { formatContactsCsv } from "@/lib/contacts/csv-export";
import type { ContactExportRecord } from "@/lib/contacts/types";
import { createClient } from "@/lib/supabase/server";

type ExportRow = {
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  phone_e164: string;
  last_contacted_at: string | null;
  last_replied_at: string | null;
  created_at: string;
  deleted_at: string | null;
  pipeline_stages: { name: string } | { name: string }[] | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!workspace) return new Response("Workspace not found", { status: 404 });

  const { data, error } = await supabase
    .from("contacts")
    .select(
      "first_name,last_name,company,phone_e164,last_contacted_at,last_replied_at,created_at,deleted_at,pipeline_stages(name)",
    )
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at");
  if (error) return new Response("We couldn't export your contacts.", { status: 500 });

  const records: ContactExportRecord[] = ((data ?? []) as unknown as ExportRow[]).map((contact) => {
    const relation = Array.isArray(contact.pipeline_stages) ? contact.pipeline_stages[0] : contact.pipeline_stages;
    return {
      company: contact.company ?? "",
      createdAt: contact.created_at,
      deletedAt: contact.deleted_at,
      firstName: contact.first_name ?? "",
      lastContactedAt: contact.last_contacted_at,
      lastName: contact.last_name ?? "",
      lastRepliedAt: contact.last_replied_at,
      phoneE164: contact.phone_e164,
      pipelineStage: relation?.name ?? "",
    };
  });

  const filename = `riink-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(formatContactsCsv(records), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
