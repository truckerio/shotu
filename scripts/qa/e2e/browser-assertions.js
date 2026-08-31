import { chromium } from "playwright";
import assert from "node:assert/strict";

const WORKORDER_VIEWPORTS = Object.freeze([
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "zoom-200-640", width: 640, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-820", width: 820, height: 1180 },
  { name: "desktop-1280", width: 1280, height: 800 },
  { name: "desktop-1920", width: 1920, height: 1080 },
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
  const trigger = page.locator(".profile-menu button:visible").first();
  await trigger.click();
  await page.locator(".profile-menu-popover:visible").waitFor({ state: "visible", timeout: 5_000 });
  await page.locator(".profile-menu-action:visible").first().waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator("main").first().waitFor({ state: "visible" });

  await page.setViewportSize({ width: 390, height: 844 });
  let mobileTrigger = page.locator(
    ".profile-menu-mobile-nav-trigger:visible, .profile-menu-mobile-action-trigger:visible, .profile-menu-trigger:visible",
  );
  if (await mobileTrigger.count() === 0) {
    const more = page.locator("details.mechanic-home-more > summary:visible");
    if (await more.count()) await more.click();
    mobileTrigger = page.locator(
      ".profile-menu-mobile-nav-trigger:visible, .profile-menu-mobile-action-trigger:visible, .profile-menu-trigger:visible",
    );
  }
  await mobileTrigger.first().click();
  await page.locator(".profile-menu-popover:visible").waitFor({ state: "visible", timeout: 5_000 });
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

function collectBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
  return errors;
}

function assertOnlyOptionalHelperFailures(failedResponses, label) {
  assert.ok(failedResponses.every((entry) => {
    const match = entry.match(/^(\d{3}) (https?:\/\/.+)$/);
    if (!match || match[1] !== "503") return false;
    const pathname = new URL(match[2]).pathname;
    return pathname === "/api/parts-helper/catalog" || pathname === "/api/proofreading/check";
  }), `${label} contained a failed response outside the exact optional-helper allowlist: ${failedResponses.join(" | ")}`);
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

async function assertMechanicClosedParts(page, workflow) {
  const completedRequests = page.locator(".part-request-history > summary");
  await completedRequests.waitFor({ state: "visible", timeout: 15_000 });
  await completedRequests.click();
  await visibleText(page, workflow.partNumber);
  assert.equal(
    await page.getByRole("button", { name: "Request part", exact: true }).count(),
    0,
    "closed workorders must not expose a mechanic part-request action",
  );
}

async function assertPartsReloadRecovery(page, config, workorderId, browserErrors) {
  const openedUrl = new URL(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/opened`, config.baseUrl).href;
  let interceptions = 0;
  let resolveInterception;
  const interception = new Promise((resolve) => { resolveInterception = resolve; });
  const errorStart = browserErrors.length;
  await page.route("**/api/mechanic/workorders/**", async (route) => {
    if (route.request().method() !== "POST" || route.request().url() !== openedUrl || interceptions > 0) {
      return route.continue();
    }
    interceptions += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "QA Parts load failure" }) });
    resolveInterception();
  });
  await page.goto(config.baseUrl.href, { waitUntil: "domcontentloaded" });
  await page.locator(".mechanic-home").waitFor({ state: "visible", timeout: 15_000 });
  await page.goto(
    new URL(`/?workorder=${encodeURIComponent(workorderId)}&section=parts`, config.baseUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  await Promise.race([
    interception,
    page.waitForTimeout(15_000).then(() => { throw new Error("QA mechanic-open interception timed out"); }),
  ]);
  assert.equal(interceptions, 1, "QA failure route must intercept exactly one mechanic-open request");
  await page.locator(".mechanic-home.route-loading").waitFor({ state: "detached", timeout: 15_000 });
  await page.locator(".mechanic-home").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".workorder-detail-page").count(), 0,
    "failed mechanic detail load must fall back without rendering stale Parts data");
  const injectedErrors = browserErrors.slice(errorStart);
  assert.equal(injectedErrors.length, 1,
    `the injected mechanic-open failure must be the only new browser error: ${injectedErrors.join(" | ")}`);
  assert.match(injectedErrors[0], /503 \(Service Unavailable\)/,
    "the single injected browser error must report the expected 503");
  browserErrors.splice(errorStart, 1);
  await page.unroute("**/api/mechanic/workorders/**");
  await page.goto(
    new URL(`/?workorder=${encodeURIComponent(workorderId)}&section=parts`, config.baseUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  await page.locator(".workorder-detail-page").waitFor({ state: "visible", timeout: 15_000 });
}

async function assertPermissionDeniedThenRecovered(page, config, role, workflow, browserErrors) {
  const errorStart = browserErrors.length;
  const family = role === "mechanic" ? "mechanic" : "office";
  const restrictedEndpoint = new URL(
    `/api/${family}/workorders/${encodeURIComponent(workflow.restrictedWorkorderId)}`,
    config.baseUrl,
  ).href;
  const deniedResponsePromise = role === "surveillance" ? null : page.waitForResponse((response) => (
    [restrictedEndpoint, `${restrictedEndpoint}/opened`].includes(response.url())
    && [403, 404].includes(response.status())
  ), { timeout: 15_000 });
  let deniedStatus = null;
  await page.goto(
    new URL(`/?workorder=${encodeURIComponent(workflow.restrictedWorkorderId)}&section=parts`, config.baseUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  if (deniedResponsePromise) {
    const deniedResponse = await deniedResponsePromise;
    deniedStatus = deniedResponse.status();
    assert.ok([403, 404].includes(deniedResponse.status()),
      `${role} restricted workorder response must fail closed`);
  }
  await page.locator("main.route-loading").waitFor({ state: "detached", timeout: 15_000 });
  await page.locator("main:not(.route-loading)").first().waitFor({ state: "visible", timeout: 15_000 });
  if (deniedStatus) {
    const deniedErrors = browserErrors.slice(errorStart);
    assert.equal(deniedErrors.length, 1,
      `${role} denied response must be the only new browser error: ${deniedErrors.join(" | ")}`);
    assert.match(deniedErrors[0], new RegExp(`${deniedStatus} \\(`),
      `${role} browser error must match the denied response status`);
    browserErrors.splice(errorStart, 1);
  }
  assert.equal(await page.getByText(workflow.restrictedConcern, { exact: false }).count(), 0,
    `${role} denied navigation must not render restricted or stale Parts data`);
  assert.equal(await page.locator(".workorder-detail-page .part-requests-panel").count(), 0,
    `${role} denied navigation must fall back without a Parts detail surface`);
  if (role === "surveillance") {
    await page.goto(config.baseUrl.href, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /^Needs Odoo, \d+ workorders$/ }).click();
    await page.getByLabel("Search workorders").fill(workflow.serial);
    await page.getByRole("button", { name: new RegExp(workflow.serial) }).click();
    await visibleText(page, workflow.concern);
    return;
  }
  await page.goto(
    new URL(`/?workorder=${encodeURIComponent(workflow.workorderId)}&section=parts`, config.baseUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  await visibleText(page, workflow.concern);
}

async function assertEmptyParts(page, config, workflow) {
  await page.goto(
    new URL(`/?workorder=${encodeURIComponent(workflow.emptyWorkorderId)}&section=parts`, config.baseUrl).href,
    { waitUntil: "domcontentloaded" },
  );
  await visibleText(page, workflow.emptyConcern);
  await page.locator(".part-requests-panel").waitFor({ state: "visible", timeout: 15_000 });
  assert.equal(await page.locator(".part-request-card").count(), 0,
    "empty Parts fixture must render without request cards");
}

async function assertOfficeBrowserPrint(page, workflow) {
  const previewToggle = page.getByRole("button", { name: "Open preview", exact: true });
  if (await previewToggle.count()) await previewToggle.click();
  const previewTab = page.getByRole("tab", { name: "Preview", exact: true });
  if (await previewTab.count()) await previewTab.click();
  await page.evaluate(() => { window.print = () => { window.__qaPrintCalled = true; }; });
  const printTrigger = page.getByRole("button", { name: "Print workorder", exact: true }).first();
  await printTrigger.click();
  await page.getByRole("menuitem", { name: /Print workorder/ }).click();
  await page.locator(".browser-print-document").waitFor({ state: "attached", timeout: 15_000 });
  const printText = await page.locator(".browser-print-document").textContent();
  assert.match(printText || "", new RegExp(workflow.actualPartNumber));
  assert.doesNotMatch(printText || "", new RegExp(workflow.plannedPartNumber));
  await page.waitForFunction(() => window.__qaPrintCalled === true, null, { timeout: 15_000 });
  assert.equal(await page.evaluate(() => window.__qaPrintCalled === true), true,
    "Office print action must reach the browser print boundary");
}

async function assertActiveMechanicParts({ browser, config, workflow }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);
  const manualOptionalHelperFailures = [];
  const manualFailedResponseUrls = [];
  page.on("response", (response) => {
    if (response.status() >= 400) manualFailedResponseUrls.push(`${response.status()} ${response.url()}`);
    if (response.status() === 503 && /\/api\/(parts-helper\/catalog|proofreading\/check)/.test(response.url())) {
      manualOptionalHelperFailures.push(response.url());
    }
  });
  try {
    await signIn(page, config, "mechanic");
    await page.goto(
      new URL(`/?workorder=${encodeURIComponent(workflow.activeWorkorderId)}&section=parts`, config.baseUrl).href,
      { waitUntil: "domcontentloaded" },
    );
    await visibleText(page, workflow.activeConcern);
    const editor = page.locator(".used-parts-editor");
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    await visibleText(editor, "Actual parts are read-only");
    assert.equal(await editor.getByRole("combobox", { name: "Part number 1" }).count(), 0,
      "Parts View must not expose actual-part entry to a mechanic.");

    await page.getByRole("button", { name: "Request part", exact: true }).click();
    const requestForm = page.locator(".mechanic-part-request-form");
    await requestForm.waitFor({ state: "visible", timeout: 15_000 });
    await requestForm.locator("#mechanic-part-query").fill(workflow.activeRequestDescription);
    const requestResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/mechanic/workorders/${workflow.activeWorkorderId}/parts`)
      && response.request().method() === "POST"
      && response.status() === 200
    ));
    await requestForm.getByRole("button", { name: "Send request", exact: true }).click();
    const requestPayload = await (await requestResponse).json();
    assert.ok(requestPayload?.partRequest?.id, "Mechanic request UI must create a canonical part request.");
    await visibleText(requestForm, "Part request sent to office.");
    await visibleText(page, workflow.activeRequestDescription);
    if (browserErrors.length) {
      assertOnlyOptionalHelperFailures(manualFailedResponseUrls, "Mechanic request entry");
      assert.ok(manualOptionalHelperFailures.length >= browserErrors.length,
        `Mechanic text-entry errors must map only to optional helpers. Failed responses: ${manualFailedResponseUrls.join(" | ")}`);
      assert.ok(browserErrors.every((error) => /503 \(Service Unavailable\)/.test(error)),
        `Optional helper failures must be the only remaining mechanic browser errors: ${browserErrors.join(" | ")}`);
      browserErrors.length = 0;
    }
    assert.deepEqual(browserErrors, [], `active mechanic Parts browser emitted errors:\n${browserErrors.join("\n")}`);
    return { requestId: requestPayload.partRequest.id };
  } finally {
    await context.close();
  }
}

async function assertActiveOfficeParts({ browser, config, workflow, mechanicResult }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const browserErrors = collectBrowserErrors(page);
  const officeOptionalHelperFailures = [];
  const officeFailedResponseUrls = [];
  page.on("response", (response) => {
    if (response.status() >= 400) officeFailedResponseUrls.push(`${response.status()} ${response.url()}`);
    if (response.status() === 503 && /\/api\/(parts-helper\/catalog|proofreading\/check)/.test(response.url())) {
      officeOptionalHelperFailures.push(response.url());
    }
  });
  try {
    await signIn(page, config, "office");
    await page.goto(
      new URL(`/?workorder=${encodeURIComponent(workflow.activeWorkorderId)}&section=parts`, config.baseUrl).href,
      { waitUntil: "domcontentloaded" },
    );
    await visibleText(page, workflow.activeConcern);
    const editor = page.locator(".used-parts-editor:not(.is-readonly)");
    await editor.waitFor({ state: "visible", timeout: 15_000 });
    const savedPartsResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/office/workorders/${workflow.activeWorkorderId}/used-parts`)
      && response.request().method() === "PATCH"
      && response.status() === 200
    ));
    await editor.getByRole("combobox", { name: "Part number 1" }).fill(workflow.activeManualPartNumber);
    await editor.getByRole("spinbutton", { name: "Quantity 1" }).fill("2");
    await editor.getByRole("textbox", { name: "Repair order 1" }).fill("Browser manual used-part entry.");
    await savedPartsResponse;
    assert.equal(
      await editor.getByRole("combobox", { name: "Part number 1" }).inputValue(),
      workflow.activeManualPartNumber,
      "Office actual-part entry must remain visible after its saved API response.",
    );
    await visibleText(editor, "Saved");

    await page.getByRole("button", { name: "Plan / source part", exact: true }).click();
    const composer = page.locator(".office-add-part");
    await composer.waitFor({ state: "visible", timeout: 15_000 });
    await composer.getByRole("combobox", { name: "Part number or description" }).fill(workflow.activePlannedPartNumber);
    await composer.getByRole("textbox", { name: "Part number", exact: true }).fill(workflow.activePlannedPartNumber);
    await composer.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("1");
    const planResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/office/workorders/${workflow.activeWorkorderId}/part-plans`)
      && response.request().method() === "POST"
      && response.status() === 200
    ));
    await composer.getByRole("button", { name: "Save part plan", exact: true }).click();
    await planResponse;
    await visibleText(page, workflow.activePlannedPartNumber);

    const requestCard = page.locator(".office-part-request-card").filter({ hasText: workflow.activeRequestDescription });
    await requestCard.waitFor({ state: "visible", timeout: 15_000 });
    await requestCard.getByLabel("Message to mechanic").fill("QA browser review: use the planned supply instead.");
    const decisionResponse = page.waitForResponse((response) => (
      response.url().endsWith(`/api/office/workorders/${workflow.activeWorkorderId}/parts/${mechanicResult.requestId}/decision`)
      && response.request().method() === "POST"
      && response.status() === 200
    ));
    await requestCard.getByRole("button", { name: "Decline", exact: true }).click();
    const decisionPayload = await (await decisionResponse).json();
    assert.equal(decisionPayload?.partRequest?.approvalStatus, "rejected",
      "Office review UI must reject the mechanic request without allocating inventory.");
    await visibleText(requestCard, "Rejected");
    await visibleText(requestCard, "Request declined. The mechanic was notified.");
    if (browserErrors.length) {
      assertOnlyOptionalHelperFailures(officeFailedResponseUrls, "Office Parts entry");
      assert.ok(officeOptionalHelperFailures.length >= browserErrors.length,
        `Office text-entry errors must map only to optional helpers. Failed responses: ${officeFailedResponseUrls.join(" | ")}`);
      assert.ok(browserErrors.every((error) => /503 \(Service Unavailable\)/.test(error)),
        `Optional helper failures must be the only remaining office browser errors: ${browserErrors.join(" | ")}`);
      browserErrors.length = 0;
    }
    assert.deepEqual(browserErrors, [], `active office Parts browser emitted errors:\n${browserErrors.join("\n")}`);
    return {
      usedPartNumber: workflow.activeManualPartNumber,
      plannedPartNumber: workflow.activePlannedPartNumber,
      requestId: mechanicResult.requestId,
    };
  } finally {
    await context.close();
  }
}

async function assertActivePartsWalkthrough({ browser, config, workflow }) {
  const mechanic = await assertActiveMechanicParts({ browser, config, workflow });
  const office = await assertActiveOfficeParts({ browser, config, workflow, mechanicResult: mechanic });
  return { role: "mechanic-office-active-parts", mechanic, office, passed: true };
}

async function selectMechanicLocale(page, optionName) {
  const selector = page.locator(".locale-selector:visible").first();
  await selector.getByRole("button").click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
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
      admin: "parts",
      office: "parts",
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

    if (role === "surveillance") {
      await assertOdooReadinessSurface(page, workflow);
      await selectWorkorderSection(page, "parts");
    }
    const viewportAssertions = await assertWorkorderViewportMatrix(page, role);

    if (role === "admin") {
      await assertRapidSectionNavigation(page);
      await assertCreateSectionNavigation(page, config.baseUrl);
      await assertCreatePartsTyping(page, config.baseUrl);
    }

    if (role === "office") {
      assert.equal(await page.locator(".locale-selector:visible").count(), 0,
        "Office must remain English-only after mechanic-only translation scope");
      await page.getByRole("tab", { name: /Chat with mechanic/ }).click();
      await visibleText(page, workflow.chatBody);
      await page.goto(
        new URL(`/?workorder=${encodeURIComponent(workflow.workorderId)}&section=parts`, config.baseUrl).href,
        { waitUntil: "domcontentloaded" },
      );
      await visibleText(page, workflow.concern);
      await assertOfficeBrowserPrint(page, workflow);
    }
    if (role === "mechanic") {
      await assertMechanicClosedParts(page, workflow);
      await assertPartsReloadRecovery(page, config, workflow.workorderId, browserErrors);
      await selectMechanicLocale(page, "Español");
      await visibleText(page, "Piezas usadas");
      await selectMechanicLocale(page, "ਪੰਜਾਬੀ");
      await visibleText(page, "ਵਰਤੇ ਪਾਰਟ");
      await selectMechanicLocale(page, "English");
      await visibleText(page, "Parts used");
    }
    if (role !== "admin") await assertPermissionDeniedThenRecovered(page, config, role, workflow, browserErrors);
    if (role !== "surveillance") await assertEmptyParts(page, config, workflow);
    assert.deepEqual(browserErrors, [], `${role} browser emitted errors:\n${browserErrors.join("\n")}`);

    return { role, url: page.url(), viewportAssertions, passed: true };
  } catch (error) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    error.message = `${role} browser assertion failed at ${page.url()}: ${error.message}\nVisible text: ${bodyText.slice(0, 500) || "[empty]"}\nBrowser errors: ${browserErrors.join("\n") || "[none]"}`;
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
      console.log(`[role-workflow] browser-${role}`);
      assertions.push(await assertRoleSurface({ browser, config, role, workflow }));
    }
    console.log("[role-workflow] browser-mechanic-office-active-parts");
    assertions.push(await assertActivePartsWalkthrough({ browser, config, workflow }));
    return assertions;
  } finally {
    await browser.close();
  }
}
