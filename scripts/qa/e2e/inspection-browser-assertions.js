import assert from "node:assert/strict";
import { chromium } from "playwright";

export const INSPECTION_VIEWPORTS = Object.freeze([
  { name: "phone-390", width: 390, height: 844 }, { name: "phone-430", width: 430, height: 932 },
  { name: "zoom-200-640", width: 640, height: 800 }, { name: "tablet-768", width: 768, height: 1024 },
  { name: "tablet-820", width: 820, height: 1180 }, { name: "desktop-1280", width: 1280, height: 800 }, { name: "desktop-1440", width: 1440, height: 900 }, { name: "desktop-1920", width: 1920, height: 1080 },
]);

function collectFailures(page) {
  const failures = [];
  page.on("console", (message) => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  return failures;
}

async function signIn(page, config, role) {
  await page.goto(config.baseUrl.href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username or email").fill(config.accounts[role].username);
  await page.getByLabel("Password").fill(config.password);
  await Promise.all([page.waitForURL((url) => url.origin === config.baseUrl.origin && !url.pathname.includes("sign-in")), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
  await page.getByRole("main").waitFor();
}

async function openInspectionWorkspace(page, role, inspectionNumber) {
  if (role === "admin") {
    await page.getByRole("button", { name: /Current view:/ }).click();
    await page.getByRole("menuitem", { name: /Inspections/ }).click();
  } else if (role === "office") {
    await page.getByRole("button", { name: "Inspections", exact: true }).click();
  } else if (role === "mechanic") {
    const inspection = page.getByRole("button", { name: new RegExp(`Open workorder Inspection · ${inspectionNumber}`) });
    await inspection.waitFor();
    await inspection.click();
    return true;
  }
  await page.getByRole("region", { name: "Inspection workspace" }).waitFor();
  if (role !== "mechanic" && role !== "surveillance") await page.getByRole("button", { name: "Completed", exact: true }).click();
  return false;
}

async function assertInspectionViewport(page, role, inspectionNumber) {
  const evidence = [];
  for (const viewport of INSPECTION_VIEWPORTS) {
    await page.setViewportSize(viewport);
    const detail = page.getByRole("region", { name: "Inspection detail" });
    await detail.waitFor();
    await detail.getByText(inspectionNumber, { exact: true }).waitFor();
    const geometry = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.equal(geometry.scrollWidth, geometry.clientWidth, `${role} ${viewport.name} must not horizontally overflow.`);
    evidence.push({ ...viewport, passed: true });
  }
  return evidence;
}

async function openInspectionRow(page, inspectionNumber) {
  const row = page.getByRole("row", { name: new RegExp(inspectionNumber) });
  await row.waitFor();
  await row.click();
  const detail = page.getByRole("region", { name: "Inspection detail" });
  await detail.waitFor();
  await detail.getByText(inspectionNumber, { exact: true }).waitFor();
}

async function assertDetailBackFocus(page, inspectionNumber) {
  await page.getByRole("button", { name: "Inspections", exact: true }).click();
  const search = page.getByLabel("Search inspections");
  await search.waitFor();
  assert.equal(await search.evaluate((element) => document.activeElement === element), true, "Inspection Back must restore focus to queue search.");
  await openInspectionRow(page, inspectionNumber);
}

async function visitSummaryWorkorderAndReturn(page, inspectionNumber, workorderNumber) {
  await page.getByRole("link", { name: new RegExp(`Open workorder ${workorderNumber}`) }).click();
  const returnAction = page.getByRole("button", { name: /Back to inspection/i });
  await returnAction.waitFor();
  await returnAction.click();
  const detail = page.getByRole("region", { name: "Inspection detail" });
  await detail.waitFor();
  await detail.getByText(inspectionNumber, { exact: true }).waitFor();
}

export async function assertInspectionBrowserJourney({ config, inspectionNumber, trailerInspectionNumber, workorderNumber }) {
  const browser = await chromium.launch({ channel: config.browser.channel, headless: config.browser.headless });
  const results = [];
  try {
    for (const role of ["admin", "office", "mechanic", "surveillance"]) {
      const context = await browser.newContext({ viewport: INSPECTION_VIEWPORTS[0] });
      const page = await context.newPage(); const failures = collectFailures(page);
      try {
        await signIn(page, config, role);
        const targetNumber = role === "mechanic" ? trailerInspectionNumber : inspectionNumber;
        const openedFromMixedQueue = await openInspectionWorkspace(page, role, targetNumber);
        if (!openedFromMixedQueue) await openInspectionRow(page, targetNumber);
        await assertDetailBackFocus(page, targetNumber);
        if (role === "surveillance") {
          assert.equal(await page.getByRole("button", { name: /Complete inspection|Assign|Create workorder/i }).count(), 0, "Read-only user must have no mutation controls.");
          assert.equal(await page.getByRole("button", { name: /Correct|Reinspect/i }).count(), 0, "Read-only user must not see lineage mutations.");
        } else if (role === "office" && workorderNumber) {
          await visitSummaryWorkorderAndReturn(page, inspectionNumber, workorderNumber);
          await page.getByRole("heading", { name: "Follow-up inspection" }).waitFor();
          await page.getByRole("button", { name: "Correct", exact: true }).waitFor();
          await page.getByRole("button", { name: "Reinspect", exact: true }).waitFor();
        }
        if (role === "mechanic") await page.getByRole("button", { name: "Next unchecked" }).press("Enter");
        if (role === "office") {
          const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: "Print slip" }).click()]);
          await popup.waitForLoadState("domcontentloaded"); await popup.close();
        }
        results.push({ role, inspectionNumber: targetNumber, viewports: await assertInspectionViewport(page, role, targetNumber) });
        assert.deepEqual(failures, [], `${role} browser/network failures: ${failures.join(" | ")}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  return results;
}
