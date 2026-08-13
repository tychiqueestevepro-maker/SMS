import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: authGetUser } })),
}));

import { POST } from "./route";

function supportRequest(message = "I need help activating my account.", ip = "203.0.113.10") {
  return new Request("https://www.riink.app/api/support-message", {
    body: JSON.stringify({ message, website: "" }),
    headers: {
      "content-type": "application/json",
      origin: "https://www.riink.app",
      "x-forwarded-for": ip,
    },
    method: "POST",
  });
}

describe("POST /api/support-message", () => {
  beforeEach(() => {
    process.env.APP_URL = "https://www.riink.app";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "Riink <support@riink.app>";
    process.env.SUPPORT_FORWARD_TO_EMAIL = "tychique@verytis.com";
    authGetUser.mockResolvedValue({ data: { user: { email: "member@example.com", id: "user-123" } } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the account message to support and a confirmation to the member", async () => {
    const resendFetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "support-email" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "confirmation-email" }), { status: 200 }));

    const response = await POST(supportRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(resendFetch).toHaveBeenCalledTimes(2);

    const supportPayload = JSON.parse(String(resendFetch.mock.calls[0][1]?.body));
    expect(supportPayload.to).toEqual(["tychique@verytis.com"]);
    expect(supportPayload.reply_to).toBe("member@example.com");
    expect(supportPayload.text).toContain("I need help activating my account.");

    const confirmationPayload = JSON.parse(String(resendFetch.mock.calls[1][1]?.body));
    expect(confirmationPayload.to).toEqual(["member@example.com"]);
    expect(confirmationPayload.reply_to).toBe("support@riink.app");
  });

  it("rejects a message when no authenticated account is available", async () => {
    authGetUser.mockResolvedValueOnce({ data: { user: null } });
    const resendFetch = vi.spyOn(globalThis, "fetch");

    const response = await POST(supportRequest("This message has enough characters.", "203.0.113.11"));

    expect(response.status).toBe(401);
    expect(resendFetch).not.toHaveBeenCalled();
  });
});
