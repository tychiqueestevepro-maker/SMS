// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import {
  CONTACT_IMPORT_LIMIT_MESSAGE,
  MAX_CONTACT_IMPORT_ROWS,
} from "@/lib/contacts/import-policy";

import { importContactsAction } from "./actions";

const validOperation = {
  action: "create",
  existingContactId: null,
  firstName: "Ada",
  lastName: "Lovelace",
  company: "Riink",
  phoneE164: "+12025550199",
  countryCode: "US",
  isSuppressed: false,
  preserveSuppression: true,
} as const;

describe("importContactsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects imports above the centralized row limit before authentication or writes", async () => {
    const operations = Array.from(
      { length: MAX_CONTACT_IMPORT_ROWS + 1 },
      () => validOperation,
    );

    await expect(
      importContactsAction(JSON.stringify(operations)),
    ).resolves.toEqual({
      message: CONTACT_IMPORT_LIMIT_MESSAGE,
      ok: false,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("accepts the maximum row count for validation", async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });
    const operations = Array.from(
      { length: MAX_CONTACT_IMPORT_ROWS },
      () => validOperation,
    );

    const response = await importContactsAction(JSON.stringify(operations));

    expect(response).toEqual({
      message: "Your workspace isn't ready yet. Please try again shortly.",
      ok: false,
    });
    expect(mocks.createClient).toHaveBeenCalledOnce();
  });
});
