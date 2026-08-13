import type { Metadata } from "next";

import { loadInboxData } from "@/app/(app)/inbox/data";
import { InboxWorkspace } from "@/components/inbox/inbox-workspace";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  const inbox = await loadInboxData();
  return (
    <>
      <PageHeader
        description="Read and respond to every customer conversation from one place."
        title="Inbox"
      />
      <InboxWorkspace {...inbox} />
    </>
  );
}
