import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function choose(page, control, name) {
  await control.click();
  const option = page.getByRole("option", { name, exact: true });
  await option.click();
  await option.waitFor({ state: "hidden" });
}

export async function checkAdminBusinessSetup({ page, baseUrl, fixture, pool, artifacts }) {
  await pool.query("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'office') on conflict(user_id,company_id) do update set role='office'", [fixture.otherOfficeId, fixture.otherCompanyId]);
  const otherRole = await page.request.get(`${baseUrl}/api/admin/business-setup?companyId=${fixture.otherCompanyId}`);
  assert.equal(otherRole.status(), 403, "A primary Admin with only Office role in another company cannot read its setup");
  for (const [mode, label] of [["fleet_only", "Our own fleet"], ["customer_repairs", "Outside customers"], ["both", "Both"]]) {
    const companyId = randomUUID();
    const locationId = randomUUID();
    await pool.query("insert into companies(id,slug,name) values($1,$2,$3)", [companyId, `onboarding-${companyId}`, `Onboarding ${mode}`]);
    await pool.query("insert into locations(id,company_id,name,address) values($1,$2,'Setup shop','100 Test Road, Test City')", [locationId, companyId]);
    await pool.query("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'admin')", [fixture.otherOfficeId, companyId]);
    await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [fixture.otherOfficeId, locationId, companyId]);
    const setupUrl = `${baseUrl}/?adminView=settings&settingsTab=business&commercialCompany=${companyId}&commercialLocation=${locationId}`;
    const taxRequests = [];
    const observe = request => { if (/\/api\/(office\/inventory\/tax-profiles|customer-documents\/profile|admin\/customer-document-profiles)/.test(request.url())) taxRequests.push(request.url()); };
    page.on("request", observe);
    if (mode === "fleet_only") {
      await page.goto(`${baseUrl}/?adminView=operations`);
      await page.getByRole("button", { name: "Finish business setup", exact: true }).click();
      await page.getByRole("heading", { name: "Business setup", exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("commercialCompany"), companyId, "Prompt finds unfinished setup beyond the first configured company");
    }
    await page.goto(setupUrl);
    await page.getByRole("heading", { name: "Business setup", exact: true }).waitFor();
    const setupBox = await page.getByRole("region", { name: "Business setup workspace", exact: true }).boundingBox();
    assert.ok(setupBox.width <= 761, "Short onboarding stays within a readable desktop form width");
    assert.ok((await page.locator('button[aria-label="Setup company"]').innerText()).includes(`Onboarding ${mode}`), "Company selector shows the real company name");
    await choose(page, page.locator('button[aria-label="Maintenance work"]'), label);
    let failedResponse = mode === "fleet_only";
    const firstSaves = [];
    await page.route("**/api/admin/business-setup", async route => {
      if (route.request().method() !== "PUT") return route.continue();
      firstSaves.push(route.request().postDataJSON());
      if (failedResponse) {
        failedResponse = false;
        const response = await route.fetch();
        assert.equal(response.status(), 200, await response.text());
        return route.abort("failed");
      }
      return route.continue();
    });
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    if (mode === "fleet_only") {
      await page.getByText("Failed to fetch", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await page.getByRole("heading", { name: "Business details", exact: true }).waitFor();
    if (mode === "fleet_only") assert.equal(firstSaves[0].idempotencyKey, firstSaves[1].idempotencyKey, "Uncertain setup save reuses its command key");
    await page.reload();
    await page.getByRole("heading", { name: "Business details", exact: true }).waitFor();
    const businessName = `QA ${mode} Shop`;
    await page.getByRole("textbox", { name: "Business name", exact: true }).fill(businessName);
    await page.getByLabel("Business address", { exact: true }).fill("");
    await page.getByRole("button", { name: mode === "fleet_only" ? "Finish setup" : "Continue", exact: true }).click();
    await page.getByText("Enter your business name and address.", { exact: true }).waitFor();
    await page.getByLabel("Business address", { exact: true }).fill("100 Test Road, Test City, CA 90000");
    await page.getByLabel("Business address", { exact: true }).press("Tab");
    if (mode === "fleet_only") {
      await page.getByRole("button", { name: "Save and exit", exact: true }).click();
      await page.getByRole("heading", { name: "Workorders", exact: true }).waitFor();
      await page.goto(setupUrl);
      await page.getByRole("heading", { name: "Business details", exact: true }).waitFor();
      assert.equal(await page.getByRole("textbox", { name: "Business name", exact: true }).inputValue(), businessName);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.getByText("Step 2 of 2", { exact: true }).count(), 1);
      assert.equal(await page.getByRole("button", { name: "Set up billing", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Finish setup", exact: true }).click();
    } else {
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("heading", { name: "Customer billing", exact: true }).waitFor();
      if (mode === "both") await page.getByRole("button", { name: "Set up later", exact: true }).click();
      else {
        await page.getByRole("button", { name: "Set up billing", exact: true }).click();
        await page.getByRole("button", { name: "Back to business setup", exact: true }).waitFor();
        await page.locator('#commercial-profile-form[aria-busy="false"]').waitFor();
        assert.equal(await page.locator('button[aria-label="Profile company"]:visible').count(), 0, "Billing handoff cannot switch to a different company");
        assert.equal(await page.locator('button[aria-label="Profile location"]:visible').count(), 0, "Billing handoff keeps its selected location");
        assert.equal(await page.getByRole("textbox", { name: "Legal name", exact: true }).inputValue(), businessName, "Billing reuses onboarding details");
        await page.getByRole("textbox", { name: "Authorization", exact: true }).fill("Please review and approve this estimate.");
        await page.getByRole("button", { name: "Create tax profile", exact: true }).click();
        const creation = page.getByRole("region", { name: "New tax profile", exact: true });
        for (const [field, value] of [["Tax profile name", "Onboarding QA tax"], ["Jurisdiction", "Disposable test location"], ["Tax name 1", "QA levy"], ["Tax rate % 1", "7.25"], ["Tax change reason", "Onboarding browser fixture"]]) await creation.getByLabel(field, { exact: true }).fill(value);
        await creation.getByRole("button", { name: "Save tax profile", exact: true }).click();
        await creation.waitFor({ state: "hidden" });
        for (const category of ["Labor", "Parts", "Shop supplies", "Fees", "Core charges", "Credits"]) {
          const control = page.locator("label").filter({ hasText: new RegExp(`^${category}`) }).filter({ has: page.getByRole("button") }).getByRole("button");
          await choose(page, control, category === "Credits" ? "out of scope" : "exempt");
        }
        await page.getByRole("button", { name: "Publish profile", exact: true }).click();
        await page.getByText("Commercial profile published. Existing documents keep their original version.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Back to business setup", exact: true }).click();
        await page.getByText("Customer billing ready. Your saved document and tax settings are unchanged.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Finish setup", exact: true }).click();
      }
    }
    await page.getByRole("heading", { name: "Setup complete", exact: true }).waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Setup complete", exact: true }).waitFor();
    await page.getByText("Fleet maintenance ready.", { exact: true }).waitFor();
    const response = await page.request.get(`${baseUrl}/api/admin/business-setup?companyId=${companyId}&locationId=${locationId}`);
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.setup.operatingMode, mode);
    assert.equal(data.setup.status, "completed");
    assert.equal(data.setup.shopIdentity.legalName, businessName);
    assert.equal(data.billing.ready, mode === "customer_repairs");
    if (mode !== "customer_repairs") {
      assert.equal(taxRequests.length, 0, "Fleet and deferred billing never load or create tax profiles");
      const records = await pool.query("select count(*) from customer_document_profiles where company_id=$1", [companyId]);
      assert.equal(Number(records.rows[0].count), 0);
    }
    const invalid = await page.request.put(`${baseUrl}/api/admin/business-setup`, { data: { ...firstSaves[0], idempotencyKey: randomUUID(), shopIdentity: { ...data.setup.shopIdentity, email: "invalid-email" } } });
    assert.equal(invalid.status(), 400, "Invalid contact details fail at the real HTTP boundary");
    const forged = await page.request.put(`${baseUrl}/api/admin/business-setup`, { data: { ...firstSaves[0], idempotencyKey: randomUUID(), billing: { ready: true } } });
    assert.equal(forged.status(), 400, "Client cannot forge financial readiness");
    const stale = await page.request.put(`${baseUrl}/api/admin/business-setup`, { data: { ...firstSaves[0], idempotencyKey: randomUUID() } });
    assert.equal(stale.status(), 409, "Stale setup saves fail closed");
    const foreignLocation = await page.request.get(`${baseUrl}/api/admin/business-setup?companyId=${companyId}&locationId=${fixture.locationId}`);
    assert.ok([403, 404].includes(foreignLocation.status()), "Location cannot cross company scope");
    if (mode === "fleet_only") {
      await choose(page, page.locator('button[aria-label="Setup company"]'), "Maintenance integration");
      assert.equal(new URL(page.url()).searchParams.get("commercialCompany"), fixture.companyId, "Changing company updates the reload scope");
      await page.reload();
      await page.getByRole("heading", { name: "Business setup", exact: true }).waitFor();
      await choose(page, page.locator('button[aria-label="Setup company"]'), "Onboarding fleet_only");
      await page.getByRole("heading", { name: "Setup complete", exact: true }).waitFor();
    }
    await page.screenshot({ path: `${artifacts}/onboarding-${mode}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Onboarding has no horizontal overflow");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.unroute("**/api/admin/business-setup");
    page.off("request", observe);
  }
}
