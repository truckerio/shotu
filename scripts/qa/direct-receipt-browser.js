import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.QA_BASE_URL || "http://localhost:5173";
const locationName = process.env.QA_LOCATION_NAME || "Arizona Yard";
if (!process.env.QA_RECEIPT_EMAIL || !process.env.QA_RECEIPT_PASSWORD) throw new Error("Set QA_RECEIPT_EMAIL and QA_RECEIPT_PASSWORD.");
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "msedge", headless: true });
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    try {
      const login = await context.request.post(`${base}/api/auth/sign-in/email`, {
        headers: { Origin: base }, data: { email: process.env.QA_RECEIPT_EMAIL, password: process.env.QA_RECEIPT_PASSWORD },
      });
      assert.equal(login.status(), 200, "Local test login must succeed");
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let part;
      let submitted;
      let posts = 0;
      let lookups = 0;
      // Browser tests exercise real rendering and session scope with a fixture
      // stock projection. Physical mutations are intercepted; DB transactions
      // are verified separately in the disposable PostgreSQL integration test.
      await page.route("**/api/office/inventory/stock?*", async (route) => {
        const result = await (await route.fetch()).json();
        assert.ok(result.items?.length, "Provide a local catalog to exercise the workspace");
        part = { ...result.items[0], partNumber: "QA-RECEIPT", trackingMode: "quantity" };
        await route.fulfill({ json: { ...result, items: [part], total: 1, pageCount: 1 } });
      });
      await page.route("**/api/office/inventory/direct-receipts**", async (route) => {
        if (route.request().method() === "POST") {
          posts += 1;
          submitted = route.request().postDataJSON();
          await route.abort("failed"); // Simulate committed receipt with a lost response.
        } else {
          lookups += 1;
          assert.ok(route.request().url().endsWith(submitted.idempotencyKey));
          await route.fulfill({ json: { status: "posted", receipt: { id: "QA-recovered-receipt", locationName: "Test receiving shop", lines: [{ quantity: submitted.quantity, uomCode: submitted.uomCode }] } } });
        }
      });
      const open = async () => {
        await page.goto(`${base}/?view=inventory&adminView=inventory`);
        const inventoryView = page.locator(".inventory-scope-field .dropdown-select-trigger");
        await inventoryView.waitFor();
        await inventoryView.click();
        await page.getByRole("option", { name: locationName, exact: true }).click();
        await page.getByText("QA-RECEIPT", { exact: true }).click();
        await page.getByRole("button", { name: "Add stock", exact: true }).click();
        return page.getByRole("dialog", { name: "Add inventory", exact: true });
      };
      let dialog = await open();
      assert.equal(await dialog.getByRole("button", { name: "Receive all", exact: true }).count(), 0, "Direct arrivals cannot imply an invoice quantity");
      assert.equal(await dialog.getByRole("button", { name: "Report an exception", exact: true }).count(), 0, "Direct arrivals offer only available or held outcomes");
      await dialog.getByRole("button", { name: "Edit line", exact: true }).click();
      await dialog.getByLabel("Received quantity for line 1", { exact: true }).fill("3");
      await dialog.getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Receive stock", exact: true }).click();
      const noPoReason = dialog.getByLabel("No purchase order reason", { exact: true });
      assert.equal(await noPoReason.evaluate((element) => element.validity.valueMissing), true);
      assert.equal(await noPoReason.evaluate((element) => document.activeElement === element), true);
      assert.equal(posts, 0);
      await noPoReason.fill("Counter delivery");
      const invalidFields = await dialog.locator("form").evaluate((form) => [...form.elements].filter((element) => typeof element.checkValidity === "function" && !element.checkValidity()).map((element) => element.getAttribute("aria-label") || element.getAttribute("name") || element.tagName));
      assert.deepEqual(invalidFields, [], "Completed direct receipt form must be valid");
      await dialog.getByRole("button", { name: "Receive stock", exact: true }).click();
      await page.waitForTimeout(500);
      assert.equal(posts, 1, `Direct receipt should submit once. Dialog: ${await dialog.textContent()}`);
      await dialog.getByRole("button", { name: "Check receipt", exact: true }).waitFor();
      assert.equal(posts, 1);
      assert.equal(submitted.quantity, 3);
      assert.equal(submitted.noPurchaseOrderReason, "Counter delivery");
      assert.equal(submitted.reference, "");
      // Reopen after reload: the immutable command must survive, inputs stay
      // locked, and recovery must find the original result instead of reposting.
      dialog = await open();
      assert.equal(await dialog.getByRole("button", { name: "Edit line", exact: true }).isDisabled(), true);
      assert.equal(await dialog.getByLabel("No purchase order reason", { exact: true }).inputValue(), "Counter delivery");
      await dialog.getByRole("button", { name: "Check receipt", exact: true }).click();
      await page.getByRole("heading", { name: "Stock received", exact: true }).waitFor();
      assert.equal(posts, 1);
      assert.equal(lookups, 1);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page overflow");
      console.log(`Receipt recovery passed at ${viewport.width}x${viewport.height}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
