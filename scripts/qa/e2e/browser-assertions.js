import { chromium } from "playwright";
import assert from "node:assert/strict";

const WORKORDER_VIEWPORTS = Object.freeze([
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
]);

const ONSCREEN_KEYBOARD_VIEWPORTS = Object.freeze([
  { name: "phone-390", width: 390, layoutHeight: 844, keyboardHeight: 500 },
  { name: "tablet-820", width: 820, layoutHeight: 1180, keyboardHeight: 700 },
]);

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

  // Return to the stable Parts tab before opening each overflow-only section.
  // The active overflow item is promoted into the primary row, so the More
  // trigger is intentionally absent until a primary tab is active again.
  for (const sectionId of [
    "parts", "unit", "parts", "assignment", "parts", "activity", "parts", "diagnosisRepair", "parts",
  ]) {
    const sectionButton = navigation.locator(`[data-section-id="${sectionId}"]`);
    const startedAt = Date.now();
    await selectWorkorderSection(page, sectionId);
    assert.ok(
      Date.now() - startedAt < 1_500,
      `Expected ${sectionId} navigation to respond within 1.5 seconds.`,
    );
    if (await sectionButton.count()) {
      assert.equal(
        await sectionButton.getAttribute("aria-current"),
        "page",
        `Expected ${sectionId} to become the active workorder section.`,
      );
    }
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

  for (const sectionId of ["location", "schedule", "concern", "unit", "location", "parts"]) {
    const sectionButton = navigation.locator(`[data-section-id="${sectionId}"]`);
    const startedAt = Date.now();
    await selectWorkorderSection(page, sectionId);
    assert.ok(
      Date.now() - startedAt < 1_500,
      `Expected create ${sectionId} navigation to respond within 1.5 seconds.`,
    );
    if (await sectionButton.count()) {
      assert.equal(
        await sectionButton.getAttribute("aria-current"),
        "page",
        `Expected create ${sectionId} to become the active workorder section.`,
      );
    }
    assert.equal(
      await pageSurface.getAttribute("data-detail-section"),
      sectionId,
      `Expected the create workorder body to render ${sectionId}.`,
    );
  }
}

async function assertCreatePartsTyping(page, baseUrl) {
  await page.goto(new URL("/?view=create", baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.locator(".create-workorder-page").waitFor({ state: "visible", timeout: 15_000 });
  await selectWorkorderSection(page, "parts");

  const partNumber = page.getByRole("combobox", { name: "Part number 1" });
  const repairOrder = page.getByRole("textbox", { name: "Repair order 1" });
  const laborRepairOrder = page.getByRole("textbox", { name: "Repair order / work performed" });
  const exactValues = [
    [partNumber, "FILTER 2000"],
    [repairOrder, "Replace  filter housing"],
    [laborRepairOrder, "Inspect  and repair"],
  ];

  for (const [field, expected] of exactValues) {
    await field.focus();
    await page.keyboard.type(expected, { delay: 0 });
    assert.equal(await field.inputValue(), expected, `Expected rapid typing to preserve ${JSON.stringify(expected)}.`);
  }

  await page.waitForTimeout(400);
  assert.equal(await partNumber.inputValue(), "FILTER 2000", "Catalog lookup must not replace manual text.");
  const quantity = page.locator("#known-part-quantity-0");
  await quantity.fill("2");
  assert.equal(await quantity.inputValue(), "2", "Quantity editing must remain functional.");
}

async function assertCreateOnscreenKeyboardVisibility(page, baseUrl) {
  const results = [];
  for (const viewport of ONSCREEN_KEYBOARD_VIEWPORTS) {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(new URL("/?view=create", baseUrl).href, { waitUntil: "domcontentloaded" });
    await page.locator(".create-workorder-page").waitFor({ state: "visible", timeout: 15_000 });
    await selectWorkorderSection(page, "unit");
    await page.setViewportSize({ width: viewport.width, height: viewport.layoutHeight });

    await page.locator("#workorder-unit").focus();
    await page.waitForFunction(() => document.activeElement?.id === "workorder-unit");
    await page.waitForTimeout(50);
    await page.setViewportSize({ width: viewport.width, height: viewport.keyboardHeight });
    await page.locator('.create-workorder-page[data-keyboard-open="true"]').waitFor({
      state: "visible",
      timeout: 5_000,
    });
    await page.locator("#customer-company-name").evaluate((field) => field.focus({ preventScroll: true }));
    await page.waitForTimeout(500);

    const geometry = await page.locator("#customer-company-name").evaluate((field) => {
      const bounds = field.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportBottom = viewportTop + (viewport?.height || window.innerHeight);
      return {
        fieldTop: bounds.top,
        fieldBottom: bounds.bottom,
        viewportTop,
        viewportBottom,
      };
    });
    assert.ok(
      geometry.fieldTop >= geometry.viewportTop && geometry.fieldBottom <= geometry.viewportBottom - 32,
      `${viewport.name}: focused create field must keep 32px clearance above the onscreen keyboard`,
    );
    results.push({ ...viewport, ...geometry, passed: true });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return results;
}

function collectBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

async function assertWorkorderViewportMatrix(page, role) {
  const results = [];
  for (const viewport of WORKORDER_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.locator(".workorder-detail-page").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(50);
    const geometry = await page.evaluate(() => {
      const documentElement = document.documentElement;
      const surface = document.querySelector(".workorder-detail-page");
      const bounds = surface?.getBoundingClientRect();
      return {
        clientWidth: documentElement.clientWidth,
        scrollWidth: documentElement.scrollWidth,
        surfaceLeft: bounds?.left ?? -1,
        surfaceRight: bounds?.right ?? -1,
        surfaceWidth: bounds?.width ?? 0,
      };
    });
    assert.equal(
      geometry.scrollWidth,
      geometry.clientWidth,
      `${role} ${viewport.name}: workorder page must not overflow horizontally`,
    );
    assert.ok(geometry.surfaceWidth > 0, `${role} ${viewport.name}: workorder surface must render`);
    assert.ok(
      geometry.surfaceLeft >= 0 && geometry.surfaceRight <= geometry.clientWidth,
      `${role} ${viewport.name}: workorder surface must remain inside the viewport`,
    );
    results.push({ ...viewport, ...geometry, passed: true });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  return results;
}

async function selectWorkorderSection(page, sectionId) {
  const visibleSection = page.locator(`[data-section-id="${sectionId}"]:visible`).first();
  if (await visibleSection.count()) {
    await visibleSection.click();
    return;
  }
  await page.locator('.workorder-section-nav-desktop button[aria-label^="More "]:visible').click();
  await page.locator(`[role="menu"] [data-section-id="${sectionId}"]`).click();
}

async function assertOdooReadinessSurface(page, workflow) {
  await selectWorkorderSection(page, "odoo");
  await page.getByRole("region", { name: "Odoo readiness" }).waitFor({ state: "visible", timeout: 15_000 });
  await visibleText(page, workflow.odooReadiness.ready ? "Ready to create draft" : "Needs setup");
}

async function assertRoleSurface({ browser, config, role, workflow }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);
  try {
    await signIn(page, config, role);
    await assertProfileMenu(page);
    const sectionByRole = {
      admin: "activity",
      office: "chat",
      mechanic: "parts",
    };
    if (role === "surveillance") {
      await page.getByRole("button", { name: /^Needs Odoo, \d+ workorders$/ }).click();
      await page.getByLabel("Search workorders").fill(workflow.serial);
      await page.getByRole("button", { name: new RegExp(workflow.serial) }).click();
    } else {
      await page.goto(
        new URL(`/?workorder=${encodeURIComponent(workflow.workorderId)}&section=${sectionByRole[role]}`, config.baseUrl).href,
        { waitUntil: "domcontentloaded" },
      );
    }
    await visibleText(page, workflow.concern);

    if (role === "surveillance") await assertOdooReadinessSurface(page, workflow);
    const viewportAssertions = await assertWorkorderViewportMatrix(page, role);

    if (role === "admin") {
      await assertRapidSectionNavigation(page);
      await assertCreateSectionNavigation(page, config.baseUrl);
      await assertCreatePartsTyping(page, config.baseUrl);
      await assertCreateOnscreenKeyboardVisibility(page, config.baseUrl);
    }

    if (role === "office") {
      await page.getByRole("tab", { name: /Chat with mechanic/ }).click();
      await visibleText(page, workflow.chatBody);
    }
    if (role === "mechanic") await visibleText(page, workflow.partNumber);
    assert.deepEqual(browserErrors, [], `${role} browser emitted errors:\n${browserErrors.join("\n")}`);

    return { role, url: page.url(), viewportAssertions, passed: true };
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
