"use client";

import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  FileUp,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Settings2,
  Trash2,
  User,
  UsersRound,
  X,
  FolderOpen
} from "lucide-react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition, useCallback } from "react";

import { deleteContactAction, moveContactAction } from "@/app/(app)/contacts/actions";
import { ContactFormDialog } from "@/components/contacts/contact-form-dialog";
import { CsvImportDialog } from "@/components/contacts/csv-import-dialog";
import { Modal } from "@/components/contacts/modal";
import { StageManagerDialog } from "@/components/contacts/stage-manager-dialog";
import type { ContactActionResult, ContactsWorkspaceData } from "@/components/contacts/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CountryFlag } from "@/components/ui/country-flag";
import { AvatarInitials } from "@/components/ui/avatar-initials";
import type { ContactFilter, ContactListItemDto, ContactSearchSource, ContactView } from "@/lib/contacts/types";

const filters: { label: string; value: ContactFilter }[] = [
  { label: "All", value: "all" },
  { label: "Replied", value: "replied" },
  { label: "Opted out", value: "opted_out" },
];

function formatPhone(phone: string) {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `(${match[1]}) ${match[2]}-${match[3]}` : phone;
}

function formatActivity(value: string | null) {
  if (!value) return "No activity";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity";
  const now = new Date();
  const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
  if (diffHours < 24 && now.getDate() === date.getDate()) {
    if (diffHours < 1) return "Just now";
    return `${Math.floor(diffHours)}h ago`;
  }
  if (diffHours < 48 && now.getDate() - 1 === date.getDate()) {
    return "Yesterday";
  }
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(date);
}

function ContactBadges({ contact }: { contact: ContactListItemDto }) {
  if (contact.optedOut) {
    return <span className="inline-flex items-center rounded-full bg-[#FFF3F1] px-2.5 py-0.5 text-xs font-semibold text-[#B33B32]">Opted out</span>;
  }
  if (contact.hasReplied) {
    return <span className="inline-flex items-center rounded-full bg-[#EFF8F2] px-2.5 py-0.5 text-xs font-semibold text-[#246B4A]">Replied</span>;
  }
  return <span className="text-[#A5B2AB]">—</span>;
}

function ContactMenu({ onDelete, onEdit }: { onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        aria-label="Edit contact"
        className="grid size-8 place-items-center rounded-lg text-[#879189] hover:bg-[#F3F6F4] hover:text-[#26342B]"
        onClick={onEdit}
        title="Edit contact"
        type="button"
      >
        <Pencil aria-hidden="true" size={15} />
      </button>
      <button
        aria-label="Delete contact"
        className="grid size-8 place-items-center rounded-lg text-[#879189] hover:bg-[#FFF3F1] hover:text-[#B33B32]"
        onClick={onDelete}
        title="Delete contact"
        type="button"
      >
        <Trash2 aria-hidden="true" size={15} />
      </button>
    </div>
  );
}

type ContactsWorkspaceProps = ContactsWorkspaceData;

export function ContactsWorkspace({ contacts, existingContactMatches, stages, kpis, pagination, filters: serverFilters }: ContactsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ContactSearchSource | null>(null);
  const [deletingContact, setDeletingContact] = useState<ContactSearchSource | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [initialStageId, setInitialStageId] = useState<string | undefined>();
  const [notice, setNotice] = useState<ContactActionResult | null>(null);
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});
  const [draggedContactId, setDraggedContactId] = useState<string | null>(null);
  const [isDeleting, startDeleting] = useTransition();
  const [isMoving, startMoving] = useTransition();

  const filter = serverFilters?.filter || "all";
  const search = serverFilters?.search || "";
  const view = serverFilters?.view || "list";

  const updateSearchParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      let shouldResetPage = false;
      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
        if (key === 'search' || key === 'filter') {
          shouldResetPage = true;
        }
      });
      if (shouldResetPage) {
        params.delete("page");
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, pathname, router]
  );

  const displaySources = useMemo(
    () => contacts.map((contact) => {
      const stageId = stageOverrides[contact.id];
      const stage = stageId ? stages.find((candidate) => candidate.id === stageId) : null;
      return stage ? { ...contact, pipelineStageId: stage.id, pipelineStageName: stage.name } : contact;
    }),
    [contacts, stageOverrides, stages],
  );

  const mappedContacts: ContactListItemDto[] = useMemo(() => {
    return displaySources.map(c => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`.trim() || c.phoneE164,
      firstName: c.firstName,
      lastName: c.lastName,
      jobTitle: c.jobTitle,
      company: c.company,
      phoneNumber: c.phoneE164,
      countryCode: c.countryCode,
      pipelineStage: { id: c.pipelineStageId, name: c.pipelineStageName },
      campaignName: c.activeCampaignName,
      lastActivityAt: c.lastRepliedAt || c.lastContactedAt || null,
      hasReplied: c.lastRepliedAt !== null,
      optedOut: c.isSuppressed,
    }));
  }, [displaySources]);

  function sourceFor(id: string) {
    return contacts.find((contact) => contact.id === id) ?? null;
  }

  function openCreate(stageId?: string) {
    setEditingContact(null);
    setInitialStageId(typeof stageId === 'string' ? stageId : undefined);
    setContactDialogOpen(true);
  }

  function openEdit(id: string) {
    setEditingContact(sourceFor(id));
    setContactDialogOpen(true);
  }

  function handleResult(actionResult: ContactActionResult) {
    setNotice(actionResult);
    if (actionResult.ok) router.refresh();
  }

  function confirmDelete() {
    if (!deletingContact) return;
    startDeleting(async () => {
      const actionResult = await deleteContactAction(deletingContact.id);
      setNotice(actionResult);
      if (actionResult.ok) {
        setDeletingContact(null);
        router.refresh();
      }
    });
  }

  function moveContact(contactId: string, stageId: string) {
    const source = displaySources.find((contact) => contact.id === contactId);
    if (!source || source.pipelineStageId === stageId) return;

    const previousOverride = stageOverrides[contactId];
    setStageOverrides((current) => ({ ...current, [contactId]: stageId }));
    startMoving(async () => {
      const actionResult = await moveContactAction(contactId, stageId);
      if (!actionResult.ok) {
        setStageOverrides((current) => {
          const next = { ...current };
          if (previousOverride) next[contactId] = previousOverride;
          else delete next[contactId];
          return next;
        });
        setNotice(actionResult);
        return;
      }
      setNotice(actionResult);
      router.refresh();
    });
  }

  const noContacts = contacts.length === 0 && search === "" && filter === "all";
  const noResults = contacts.length === 0 && (search !== "" || filter !== "all");

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const currentPage = pagination?.page || 1;

  const getPercentage = (value: number) => {
    if (!kpis?.total) return "0%";
    return `${((value / kpis.total) * 100).toFixed(1)}%`;
  };

  return (
    <>
      {notice ? (
        <div
          className={`mb-4 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 text-sm ${
            notice.ok ? "border-[#CCE2D3] bg-[#EFF8F2] text-[#246B4A]" : "border-[#F0CBC6] bg-[#FFF3F1] text-[#B33B32]"
          }`}
          role={notice.ok ? "status" : "alert"}
        >
          <span>{notice.message}</span>
          <button aria-label="Dismiss" className="grid size-7 place-items-center rounded-md hover:bg-black/5" onClick={() => setNotice(null)} type="button">
            <X aria-hidden="true" size={15} />
          </button>
        </div>
      ) : null}

      {/* KPI Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total contacts */}
        <div className="flex items-center rounded-xl border border-[#E5E9E6] bg-white p-4">
          <div className="mr-4 grid size-12 place-items-center rounded-xl bg-[#EAF7F0] text-[#1B623B]">
            <User size={20} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#879189]">Total contacts</p>
            <p className="text-2xl font-bold text-[#171A18]">{kpis?.total.toLocaleString() ?? 0}</p>
            <p className="mt-0.5 text-xs text-[#879189]">All time</p>
          </div>
        </div>

        {/* Replied */}
        <div className="flex items-center rounded-xl border border-[#E5E9E6] bg-white p-4">
          <div className="mr-4 grid size-12 place-items-center rounded-xl bg-[#EBF4FE] text-[#1456A5]">
            <Send size={18} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#879189]">Replied</p>
            <p className="text-2xl font-bold text-[#171A18]">{kpis?.replied.toLocaleString() ?? 0}</p>
            <p className="mt-0.5 text-xs text-[#879189]">{getPercentage(kpis?.replied ?? 0)}</p>
          </div>
        </div>

        {/* Opted out */}
        <div className="flex items-center rounded-xl border border-[#E5E9E6] bg-white p-4">
          <div className="mr-4 grid size-12 place-items-center rounded-xl bg-[#FFF6E5] text-[#9A6202]">
            <Ban size={18} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#879189]">Opted out</p>
            <p className="text-2xl font-bold text-[#171A18]">{kpis?.optedOut.toLocaleString() ?? 0}</p>
            <p className="mt-0.5 text-xs text-[#879189]">{getPercentage(kpis?.optedOut ?? 0)}</p>
          </div>
        </div>

        {/* In campaigns */}
        <div className="flex items-center rounded-xl border border-[#E5E9E6] bg-white p-4">
          <div className="mr-4 grid size-12 place-items-center rounded-xl bg-[#F6F0FF] text-[#551FA5]">
            <FolderOpen size={18} />
          </div>
          <div>
            <p className="text-xs font-semibold text-[#879189]">In campaigns</p>
            <p className="text-2xl font-bold text-[#171A18]">{kpis?.inCampaigns.toLocaleString() ?? 0}</p>
            <p className="mt-0.5 text-xs text-[#879189]">{getPercentage(kpis?.inCampaigns ?? 0)}</p>
          </div>
        </div>
      </div>

      {/* Main Surface Container */}
      <div className="w-full min-w-0 max-w-full rounded-xl border border-[#E5E9E6] bg-white">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-[#E5E9E6] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent bg-[#11693E] px-4 text-xs font-semibold text-white hover:bg-[#0E5431]"
              disabled={stages.length === 0}
              onClick={() => openCreate()}
              type="button"
            >
              <Plus aria-hidden="true" size={15} />
              Add contact
            </button>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs font-semibold text-[#171A18] hover:bg-[#FBFCFB]"
              onClick={() => setImportOpen(true)}
              type="button"
            >
              <FileUp aria-hidden="true" size={15} className="text-[#66706A]" />
              Import CSV
            </button>
            <Link
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs font-semibold text-[#171A18] hover:bg-[#FBFCFB]"
              href="/contacts/export"
            >
              <Download aria-hidden="true" size={15} className="text-[#66706A]" />
              Export
            </Link>
          </div>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent bg-transparent px-3 text-xs font-semibold text-[#66706A] hover:bg-[#F3F6F4] hover:text-[#171A18]"
            onClick={() => setStagesOpen(true)}
            type="button"
          >
            <Settings2 aria-hidden="true" size={15} />
            Manage stages
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-3 border-b border-[#E5E9E6] p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#879189]" size={16} />
            <input
              aria-label="Search contacts"
              className="h-10 w-full rounded-lg border border-[#E5E9E6] bg-white pl-10 pr-3 text-sm text-[#171A18] placeholder:text-[#A5B2AB] focus:border-[#11693E] focus:outline-none focus:ring-1 focus:ring-[#11693E]"
              onChange={(event) => updateSearchParams({ search: event.target.value })}
              placeholder="Search name, company, or phone..."
              type="search"
              defaultValue={search}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex rounded-lg border border-[#E5E9E6] p-1" role="group" aria-label="Contact filter">
              {filters.map((item) => (
                <button
                  aria-pressed={filter === item.value}
                  className={`h-8 rounded-md px-4 text-xs font-semibold transition-colors ${
                    filter === item.value ? "bg-[#EFF8F2] text-[#11693E]" : "text-[#66706A] hover:text-[#171A18]"
                  }`}
                  key={item.value}
                  onClick={() => updateSearchParams({ filter: item.value })}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-[#E5E9E6] p-1" role="group" aria-label="Contact view">
              <button
                aria-label="List view"
                aria-pressed={view === "list"}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${view === "list" ? "bg-[#EFF8F2] text-[#11693E]" : "text-[#66706A] hover:text-[#171A18]"}`}
                onClick={() => updateSearchParams({ view: "list" })}
                type="button"
              >
                <List aria-hidden="true" size={15} />
                List
              </button>
              <button
                aria-label="Pipeline view"
                aria-pressed={view === "pipeline"}
                className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold ${view === "pipeline" ? "bg-[#EFF8F2] text-[#11693E]" : "text-[#66706A] hover:text-[#171A18]"}`}
                onClick={() => updateSearchParams({ view: "pipeline" })}
                type="button"
              >
                <LayoutGrid aria-hidden="true" size={15} />
                Pipeline
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {noContacts ? (
          <div className="grid min-h-[390px] place-items-center px-6 py-12 text-center">
            <div className="max-w-sm">
              <span className="mx-auto grid size-12 place-items-center rounded-xl border border-[#E5E9E6] bg-[#FAFBFA] text-[#11693E]">
                <UsersRound aria-hidden="true" size={21} />
              </span>
              <h2 className="mt-5 text-base font-semibold text-[#171A18]">No contacts yet</h2>
              <p className="mt-2 text-sm leading-6 text-[#66706A]">Add your first contact or import a CSV to get started.</p>
              <div className="mt-6 flex justify-center gap-2">
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent bg-[#11693E] px-4 text-xs font-semibold text-white hover:bg-[#0E5431]"
                  disabled={stages.length === 0}
                  onClick={() => openCreate()}
                  type="button"
                >
                  <Plus aria-hidden="true" size={15} />
                  Add contact
                </button>
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-3.5 text-xs font-semibold text-[#171A18] hover:bg-[#FBFCFB]"
                  onClick={() => setImportOpen(true)}
                  type="button"
                >
                  Import CSV
                </button>
              </div>
            </div>
          </div>
        ) : noResults ? (
          <div className="grid min-h-[320px] place-items-center px-6 py-12 text-center">
            <div>
              <Search aria-hidden="true" className="mx-auto text-[#A5B2AB]" size={24} />
              <h2 className="mt-4 text-sm font-semibold text-[#171A18]">No matching contacts</h2>
              <p className="mt-1.5 text-sm text-[#66706A]">Try a different search or filter.</p>
              <button className="mt-4 text-sm font-semibold text-[#11693E] hover:underline" onClick={() => updateSearchParams({ search: null, filter: null })} type="button">Clear filters</button>
            </div>
          </div>
        ) : view === "list" ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <table className="w-full table-fixed border-collapse text-left md:table-auto md:min-w-[900px]">
                <thead className="border-b border-[#E5E9E6] text-[11px] font-semibold uppercase tracking-wider text-[#A5B2AB]">
                  <tr>
                    <th className="hidden w-10 px-5 py-4 md:table-cell">
                      <input type="checkbox" className="size-4 rounded border-[#D0D5D2] text-[#11693E] focus:ring-[#11693E]" />
                    </th>
                    <th className="px-3 py-4">CONTACT</th>
                    <th className="hidden px-5 py-4 md:table-cell">PHONE</th>
                    <th className="hidden px-5 py-4 md:table-cell">STAGE</th>
                    <th className="hidden px-5 py-4 md:table-cell">LAST ACTIVITY</th>
                    <th className="hidden px-5 py-4 md:table-cell">STATUS</th>
                    <th className="w-12 px-2 py-4 md:w-24 md:px-5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E9E6]">
                  {mappedContacts.map((contact) => (
                    <tr className="group bg-white transition-colors hover:bg-[#FAFBFA]" key={contact.id}>
                      <td className="hidden px-5 py-4 md:table-cell">
                        <input type="checkbox" className="size-4 rounded border-[#D0D5D2] text-[#11693E] focus:ring-[#11693E]" />
                      </td>
                      <td className="min-w-0 px-3 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <AvatarInitials firstName={contact.firstName} lastName={contact.lastName} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#171A18]">{contact.name}</p>
                            {(contact.jobTitle || contact.company) && (
                              <p className="mt-0.5 text-xs text-[#879189]">
                                {[contact.jobTitle, contact.company].filter(Boolean).join(" @ ")}
                              </p>
                            )}
                            <p className="mt-1 flex items-center gap-2 text-xs text-[#66706A] md:hidden">
                              <CountryFlag countryCode={contact.countryCode} />
                              {formatPhone(contact.phoneNumber)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-5 py-4 text-sm text-[#171A18] md:table-cell">
                        <div className="flex items-center gap-2">
                          <CountryFlag countryCode={contact.countryCode} />
                          {formatPhone(contact.phoneNumber)}
                        </div>
                      </td>
                      <td className="hidden px-5 py-4 md:table-cell">
                        <span className="inline-flex items-center rounded-full bg-[#EAF7F0] px-2.5 py-1 text-xs font-semibold text-[#1B623B]">
                          {contact.pipelineStage.name}
                        </span>
                      </td>
                      <td className="hidden px-5 py-4 text-sm text-[#66706A] md:table-cell">{formatActivity(contact.lastActivityAt)}</td>
                      <td className="hidden px-5 py-4 md:table-cell"><ContactBadges contact={contact} /></td>
                      <td className="px-2 py-4 opacity-100 transition-opacity md:px-5 md:opacity-0 md:group-hover:opacity-100">
                        <ContactMenu onDelete={() => setDeletingContact(sourceFor(contact.id))} onEdit={() => openEdit(contact.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pagination && (
              <div className="flex items-center justify-between border-t border-[#E5E9E6] px-5 py-3">
                <p className="text-xs font-medium text-[#66706A]">
                  Showing {(currentPage - 1) * pagination.pageSize + 1} to {Math.min(currentPage * pagination.pageSize, pagination.total)} of {pagination.total.toLocaleString()} contacts
                </p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center rounded-lg border border-[#E5E9E6] bg-white p-1">
                    <button
                      className="grid size-7 place-items-center rounded text-[#879189] hover:bg-[#F3F6F4] hover:text-[#171A18] disabled:opacity-50 disabled:hover:bg-transparent"
                      disabled={currentPage <= 1}
                      onClick={() => updateSearchParams({ page: String(currentPage - 1) })}
                      type="button"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                      let pageNum = i + 1;
                      if (totalPages > 5 && currentPage > 3) {
                        pageNum = currentPage - 2 + i;
                        if (pageNum > totalPages) return null;
                      }
                      return (
                        <button
                          key={pageNum}
                          className={`grid min-w-7 h-7 place-items-center rounded px-1 text-xs font-semibold ${currentPage === pageNum ? 'bg-[#EAF7F0] text-[#11693E]' : 'text-[#66706A] hover:bg-[#F3F6F4] hover:text-[#171A18]'}`}
                          onClick={() => updateSearchParams({ page: String(pageNum) })}
                          type="button"
                        >
                          {pageNum}
                        </button>
                      );
                    })}

                    {totalPages > 5 && currentPage < totalPages - 2 && (
                      <>
                        <span className="grid size-7 place-items-center text-xs text-[#879189]">...</span>
                        <button
                          className="grid min-w-7 h-7 place-items-center rounded px-1 text-xs font-semibold text-[#66706A] hover:bg-[#F3F6F4] hover:text-[#171A18]"
                          onClick={() => updateSearchParams({ page: String(totalPages) })}
                          type="button"
                        >
                          {totalPages}
                        </button>
                      </>
                    )}

                    <button
                      className="grid size-7 place-items-center rounded text-[#879189] hover:bg-[#F3F6F4] hover:text-[#171A18] disabled:opacity-50 disabled:hover:bg-transparent"
                      disabled={currentPage >= totalPages}
                      onClick={() => updateSearchParams({ page: String(currentPage + 1) })}
                      type="button"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  
                  <select
                    className="h-9 rounded-lg border border-[#E5E9E6] bg-white px-2.5 text-xs font-semibold text-[#171A18] focus:border-[#11693E] focus:outline-none focus:ring-1 focus:ring-[#11693E]"
                    value={pagination.pageSize}
                    onChange={(e) => updateSearchParams({ pageSize: e.target.value, page: "1" })}
                  >
                    <option value="20">20 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                  </select>
                </div>
              </div>
            )}
          </>
        ) : (
          <ContactPipeline
            contacts={mappedContacts}
            draggedContactId={draggedContactId}
            isMoving={isMoving}
            onDelete={(id) => setDeletingContact(sourceFor(id))}
            onDragStart={setDraggedContactId}
            onDrop={(stageId) => {
              if (draggedContactId) moveContact(draggedContactId, stageId);
              setDraggedContactId(null);
            }}
            onEdit={openEdit}
            onMove={moveContact}
            stages={stages}
            onManageStages={() => setStagesOpen(true)}
            onAddContact={openCreate}
          />
        )}
      </div>

      <ContactFormDialog
        contact={editingContact}
        initialStageId={initialStageId}
        key={`${editingContact?.id ?? "new"}-${contactDialogOpen}`}
        onClose={() => {
          setContactDialogOpen(false);
          setTimeout(() => setInitialStageId(undefined), 300);
        }}
        onResult={handleResult}
        open={contactDialogOpen}
        stages={stages}
      />
      <CsvImportDialog existingContacts={existingContactMatches} onClose={() => setImportOpen(false)} onResult={handleResult} open={importOpen} />
      <StageManagerDialog onClose={() => setStagesOpen(false)} onResult={handleResult} open={stagesOpen} stages={stages} />
      <Modal
        description="Their past messages stay available in Inbox, but they won't appear in your active contact list."
        onClose={() => { if (!isDeleting) setDeletingContact(null); }}
        open={Boolean(deletingContact)}
        title="Delete contact?"
      >
        <div className="p-5 sm:p-6">
          <p className="text-sm leading-6 text-[#536159]">
            Delete <span className="font-semibold text-[#171A18]">{deletingContact ? `${deletingContact.firstName} ${deletingContact.lastName}`.trim() || deletingContact.phoneE164 : "this contact"}</span>? Any active campaign sequence for this contact will stop.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[#E5E9E6] bg-[#FAFBFA] px-5 py-4 sm:px-6">
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E5E9E6] bg-white px-4 text-xs font-semibold text-[#171A18] hover:bg-[#FBFCFB]" disabled={isDeleting} onClick={() => setDeletingContact(null)} type="button">Cancel</button>
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-transparent bg-[#DA4545] px-4 text-xs font-semibold text-white hover:bg-[#C83434]" disabled={isDeleting} onClick={confirmDelete} type="button">Delete contact</button>
        </div>
      </Modal>
    </>
  );
}

type ContactPipelineProps = {
  contacts: ContactListItemDto[];
  draggedContactId: string | null;
  isMoving: boolean;
  onDelete: (id: string) => void;
  onDragStart: (id: string) => void;
  onDrop: (stageId: string) => void;
  onEdit: (id: string) => void;
  onMove: (contactId: string, stageId: string) => void;
  stages: ContactsWorkspaceData["stages"];
  onManageStages: () => void;
  onAddContact: (stageId?: string) => void;
};

function ContactPipeline({ contacts, draggedContactId, isMoving, onDelete, onDragStart, onDrop, onEdit, onMove, stages, onManageStages, onAddContact }: ContactPipelineProps) {
  return (
    <div className="overflow-x-auto bg-[#FAFBFA] p-4">
      <div className="flex min-h-[430px] min-w-max gap-4">
        {stages.map((stage) => {
          const stageContacts = contacts.filter((contact) => contact.pipelineStage.id === stage.id);
          return (
            <section
              className={`w-[292px] rounded-xl border bg-[#F3F6F4] p-3 transition-colors ${draggedContactId ? "border-[#AAC7B5]" : "border-[#E0E6E1]"}`}
              key={stage.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDrop(stage.id)}
            >
              <header className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[#344139]">{stage.name}</h2>
                  {stage.isDefault ? <span className="size-1.5 rounded-full bg-[#11693E]" title="Default stage" /> : null}
                </div>
                <Badge>{stageContacts.length}</Badge>
              </header>
              <div className="space-y-2">
                {stageContacts.map((contact) => (
                  <article
                    className={`cursor-grab rounded-xl border border-[#E5E9E6] bg-white p-3 shadow-sm active:cursor-grabbing ${draggedContactId === contact.id ? "opacity-50" : ""}`}
                    draggable
                    key={contact.id}
                    onDragEnd={() => onDragStart("")}
                    onDragStart={() => onDragStart(contact.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#171A18]">{contact.name}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-[#879189]">
                          <CountryFlag countryCode={contact.countryCode} className="size-3" />
                          {[contact.jobTitle, contact.company].filter(Boolean).join(" @ ") || formatPhone(contact.phoneNumber)}
                        </p>
                      </div>
                      <div className="relative">
                        <button aria-label="Edit contact" className="grid size-7 place-items-center rounded-md text-[#879189] hover:bg-[#F3F6F4]" onClick={() => onEdit(contact.id)} type="button">
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3"><ContactBadges contact={contact} /></div>
                    <div className="mt-3 flex items-center gap-2 border-t border-[#E5E9E6] pt-2.5">
                      <select
                        aria-label={`Move ${contact.name} to another stage`}
                        className="h-8 min-w-0 flex-1 rounded-md border border-[#E5E9E6] bg-white px-2 text-xs text-[#536159] focus:border-[#11693E] focus:outline-none focus:ring-1 focus:ring-[#11693E]"
                        disabled={isMoving}
                        onChange={(event) => onMove(contact.id, event.target.value)}
                        value={contact.pipelineStage.id}
                      >
                        {stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                      <button aria-label="Delete contact" className="grid size-8 place-items-center rounded-md text-[#879189] hover:bg-[#FFF3F1] hover:text-[#B33B32]" onClick={() => onDelete(contact.id)} type="button">
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {stageContacts.length === 0 ? (
                  <div className="grid h-24 place-items-center rounded-lg border border-dashed border-[#D0D5D2] text-xs text-[#879189]">Drop contacts here</div>
                ) : null}
                <button
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#D0D5D2] bg-[#FAFBFA] py-2 text-xs font-semibold text-[#66706A] transition-colors hover:bg-white hover:text-[#171A18]"
                  onClick={() => onAddContact(stage.id)}
                  type="button"
                >
                  <Plus size={14} /> Add contact
                </button>
              </div>
            </section>
          );
        })}
        <div className="w-[292px] shrink-0 pt-1">
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[#D0D5D2] bg-[#FAFBFA] py-4 text-sm font-semibold text-[#66706A] transition-colors hover:border-[#11693E] hover:text-[#11693E]"
            onClick={onManageStages}
            type="button"
          >
            <Plus size={16} /> Add a pipeline stage
          </button>
        </div>
      </div>
    </div>
  );
}
