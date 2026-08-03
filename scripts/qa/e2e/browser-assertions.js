import { chromium } from "playwright";
import assert from "node:assert/strict";

async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function signIn(page, config, role) {
  await page.goto(config.baseUrl.href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username or email").fill(config.accounts[role].username);
  await page.locator('input[name="password"]').fill(config.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function assertProfileMenu(page) {
  const trigger = page.getByRole("button", { name: /Open (account|profile) menu/ }).first();
  await trigger.click();
  await page.getByRole("menu", { name: "Profile actions" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.getByRole("menuitem", { name: "Change password" }).waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("main").first().waitFor({ state: "visible" });

  await page.setViewportSize({ width: 390, height: 844 });
  let mobileTrigger = page.locator(
    'button[aria-label="Open profile menu"]:visible, button[aria-label="Open account menu"]:visible',
  );
  if (await mobileTrigger.count() === 0) {
    const more = page.locator("details.mechanic-home-more > summary:visible");
    if (await more.count()) await more.click();
    mobileTrigger = page.locator(
      'button[aria-label="Open profile menu"]:visible, button[aria-label="Open account menu"]:visible',
    );
  }
  await mobileTrigger.first().click();
  await page.getByRole("menu", { name: "Profile actions" }).waitFor({ state: "visible", timeout: 5_000 });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function assertRapidSectionNavigation(page) {
  const navigation = page.locator(".workorder-section-nav-desktop");
  await navigation.waitFor({ state: "visible", timeout: 15_000 });

  for (const sectionId of ["parts", "unit", "team", "activity", "work", "parts"]) {
    const sectionButton = navigation.locator(`[data-section-id="${sectionId}"]`);
    const startedAt = Date.now();
    await sectionButton.click();
    assert.ok(
      Date.now() - startedAt < 1_500,
      `Expected ${sectionId} navigation to respond within 1.5 seconds.`,
    );
    assert.equal(
      await sectionButton.getAttribute("aria-current"),
      "page",
      `Expected ${sectionId} to become the active workorder section.`,
    );
    assert.equal(
      await page.locator(".workorder-detail-page").getAttribute("data-detail-section"),
      sectionId,
      `Expected the workorder detail body to render ${sectionId}.`,
    );
  }
}

async function assertCreateSectionNavigation(page, baseUrl) {
  await page.goto(new URL("/?view=create", baseUrl).href, { waitUntil: "domcontentloaded" });
  const pageSurface = page.locator(".create-workorder-page");
  await pageSurface.waitFor({ state: "visible", timeout: 15_000 });
  const navigation = page.locator(".workorder-section-nav-desktop");
  await navigation.waitFor({ state: "visible", timeout: 15_000 });

  for (const sectionId of ["unit", "assignment", "parts", "work"]) {
    const sectionButton = navigation.locator(`[data-section-id="${sectionId}"]`);
    const startedAt = Date.now();
    await sectionButton.click();
    assert.ok(
      Date.now() - startedAt < 1_500,
      `Expected create ${sectionId} navigation to respond within 1.5 seconds.`,
    );
    assert.equal(
      await sectionButton.getAttribute("aria-current"),
      "page",
      `Expected create ${sectionId} to become the active workorder section.`,
    );
    assert.equal(
      await pageSurface.getAttribute("data-detail-section"),
      sectionId,
      `Expected the create workorder body to render ${sectionId}.`,
    );
  }
}

async function assertRoleSurface({ browser, config, role, workflow }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await signIn(page, config, role);
    await assertProfileMenu(page);
    const sectionByRole = {
      admin: "activity",
      office: "chat",
      mechanic: "parts",
    };
    if (role === "surveillance") {
      await page.getByRole("button", { name: /^Entered, \d+ workorders$/ }).click();
      await page.getByLabel("Search workorders").fill(workflow.serial);
      await page.getByRole("button", { name: new RegExp(workflow.serial) }).click();
    } else {
      await page.goto(
        new URL(`/?workorder=${encodeURIComponent(workflow.workorderId)}&section=${sectionByRole[role]}`, config.baseUrl).href,
        { waitUntil: "domcontentloaded" },
      );
    }
    await visibleText(page, workflow.concern);

    if (role === "admin") {
      await assertRapidSectionNavigation(page);
      await assertCreateSectionNavigation(page, config.baseUrl);
    }

    if (role === "office") {
      await page.getByRole("tab", { name: /Chat with mechanic/ }).click();
      await visibleText(page, workflow.chatBody);
    }
    if (role === "mechanic") await visibleText(page, workflow.partNumber);
    if (role === "surveillance") {
      await page.getByText(/Odoo_entered|Entered in Odoo/i).first().waitFor({ state: "visible", timeout: 15_000 });
    }

    return { role, url: page.url(), passed: true };
  } catch (error) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    error.message = `${role} browser assertion failed at ${page.url()}: ${error.message}\nVisible text: ${bodyText.slice(0, 500) || "[empty]"}`;
    throw error;
  } finally {
    await context.close();
  }
}

export async function assertCriticalRoleSurfaces({ config, workflow }) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: config.browser.headless,
      ...(config.browser.channel ? { channel: config.browser.channel } : {}),
    });
  } catch (error) {
    if (!config.browser.channel) throw error;
    browser = await chromium.launch({ headless: config.browser.headless });
  }

  try {
    const assertions = [];
    for (const role of Object.keys(config.accounts)) {
      assertions.push(await assertRoleSurface({ browser, config, role, workflow }));
    }
    return assertions;
  } finally {
    await browser.close();
  }
}
