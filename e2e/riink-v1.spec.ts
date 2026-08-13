import { expect, test, type Page } from "@playwright/test";

import { E2E_USERS } from "./support/fixtures";

async function signIn(page: Page, user: (typeof E2E_USERS)[keyof typeof E2E_USERS]) {
  await page.goto("/login");
  const essentialCookies = page.getByRole("button", { name: "Essential only" });
  await expect(essentialCookies).toBeVisible();
  await essentialCookies.click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/campaigns$/);
  await expect(page.getByRole("heading", { level: 1, name: "Campaigns" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("authentication protects workspace routes", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to Riink" })).toBeVisible();
});

test("authenticated users can navigate the four product areas", async ({ page }) => {
  await signIn(page, E2E_USERS.standard);

  for (const destination of ["Contacts", "Inbox", "Settings", "Campaigns"] as const) {
    await page.getByRole("link", { exact: true, name: destination }).click();
    await expect(page).toHaveURL(new RegExp(`/${destination.toLowerCase()}$`));
    await expect(page.getByRole("heading", { level: 1, name: destination })).toBeVisible();
  }
});

test("mobile navigation is usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await signIn(page, E2E_USERS.standard);

  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  await expect(openNavigation).toBeVisible();
  await openNavigation.click();
  await expect(openNavigation).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("link", { exact: true, name: "Contacts" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Contacts" })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    elements: [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .map((element) => `${element.tagName}.${element.className}`)
      .slice(0, 12),
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth, overflow.elements.join("\n")).toBeLessThanOrEqual(overflow.viewportWidth);
});

test("a campaign draft can be saved while number setup is in progress", async ({ page }) => {
  await signIn(page, E2E_USERS.standard);
  await page.goto("/campaigns/new");

  await expect(page.getByText("Pending", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Campaign name").fill("Pending number draft");
  await page.getByLabel("Message 1 content").fill("Hi {{first_name}}, this draft can wait.");
  await page.getByRole("button", { name: /Select contacts/ }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("button", { name: "Launch campaign" })).toBeDisabled();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("status")).toContainText("Draft saved.");
  await expect(page).toHaveURL(/\/campaigns\/[0-9a-f-]+$/);
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
});

test("a 1,000-recipient campaign requires explicit launch confirmation", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, E2E_USERS.largeCampaign);
  await page.goto("/campaigns/new");

  await page.getByLabel("Campaign name").fill("Large campaign guard");
  await page.getByLabel("Message 1 content").fill("Hi {{first_name}}, this is a campaign test.");
  await page.getByRole("button", { name: /Select contacts/ }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await page
    .getByLabel("I confirm these contacts agreed to receive messages from this business.")
    .check();
  await page.getByRole("button", { name: "Launch campaign" }).click();

  const confirmation = page.getByRole("dialog", { name: "Launch campaign?" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("You're about to enroll 1,000 contacts.");
  await expect(confirmation).toContainText(
    "This campaign may use SMS credits beyond your included allowance and generate additional usage charges.",
  );
  await expect(confirmation.getByRole("button", { name: "Launch campaign" })).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toBeHidden();
});
