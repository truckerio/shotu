import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

async function choose(page, control, name) {
  await control.click();
  const option = page.getByRole("option", { name, exact: true });
  await option.click();
  await option.waitFor({ state: "hidden" });
}

export async function checkCommercialProfileSetup({ page, baseUrl, fixture, pool, artifacts }) {
  const locationId = randomUUID();
  await pool.query("insert into locations(id,company_id,name) values($1,$2,'Profile setup shop')", [locationId, fixture.companyId]);
  await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [fixture.otherOfficeId, locationId, fixture.companyId]);
  const url = `${baseUrl}/?adminView=settings&settingsTab=commercial&commercialCompany=${fixture.companyId}&commercialLocation=${locationId}`;
  let failTaxLoad = true;
  await page.route("**/api/office/inventory/tax-profiles?*", route => {
    if (failTaxLoad) { failTaxLoad = false; return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary tax service failure" }) }); }
    return route.continue();
  });
  await page.goto(url);
  await page.locator('#commercial-profile-form[aria-busy="false"]').waitFor();
  const publish = page.getByRole("button", { name: "Publish profile", exact: true });
  assert.equal(await publish.isDisabled(), true);
  await page.getByRole("button", { name: / Tax profile$/ }).waitFor();
  await page.getByText("Temporary tax service failure", { exact: true }).waitFor();
  assert.equal(await publish.isDisabled(), true, "Failed tax load blocks publishing");
  await page.getByRole("button", { name: "Retry loading tax profiles", exact: true }).click();
  await page.getByRole("button", { name: "Create tax profile", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Tax profile version", exact: true }).count(), 0, "No raw internal version ID entry");
  await page.getByRole("textbox", { name: "Legal name", exact: true }).fill("Profile Setup QA Shop");
  await page.getByRole("textbox", { name: "Authorization", exact: true }).fill("I authorize the work shown.");
  await page.getByRole("button", { name: "Create tax profile", exact: true }).click();
  const create = page.getByRole("region", { name: "New tax profile", exact: true });
  await create.getByLabel("Tax profile name", { exact: true }).fill("QA explicitly configured tax");
  await create.getByLabel("Jurisdiction", { exact: true }).fill("Disposable test jurisdiction");
  await create.getByLabel("Tax name 1", { exact: true }).fill("QA sales tax");
  await create.getByLabel("Tax rate % 1", { exact: true }).fill("101");
  await create.getByLabel("Tax change reason", { exact: true }).fill("Disposable browser regression");
  await create.getByRole("button", { name: "Save tax profile", exact: true }).click();
  await create.getByText("Enter tax rate 1 from 0 to 100 with up to four decimal places.", { exact: true }).waitFor();
  assert.equal(await publish.isDisabled(), true, "Tax creation blocks parent profile publish");
  await create.getByLabel("Tax rate % 1", { exact: true }).fill("7.25");
  let loseTaxResponse = true;
  const taxRequests = [];
  let taxPersisted;
  let releaseTaxResponse;
  const taxPersistedPromise = new Promise(resolve => { taxPersisted = resolve; });
  const taxResponseGate = new Promise(resolve => { releaseTaxResponse = resolve; });
  await page.route("**/api/office/inventory/tax-profiles", async route => {
    if (route.request().method() !== "POST") return route.continue();
    taxRequests.push(route.request().postDataJSON());
    if (loseTaxResponse) {
      loseTaxResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      taxPersisted();
      await taxResponseGate;
      return route.abort("failed");
    }
    return route.continue();
  });
  await create.getByRole("button", { name: "Save tax profile", exact: true }).click();
  await taxPersistedPromise;
  try {
    assert.equal(await create.getByLabel("Tax rate % 1", { exact: true }).isDisabled(), true, "Submitted tax rates cannot be edited while saving");
    assert.equal(await page.getByRole("button", { name: / Profile location$/ }).isDisabled(), true, "Location cannot change during tax creation");
    assert.equal(await page.getByRole("textbox", { name: "Currency", exact: true, includeHidden: true }).isDisabled(), true, "Currency cannot change during tax creation");
  } finally { releaseTaxResponse(); }
  await create.getByText("Failed to fetch", { exact: true }).waitFor();
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === "/api/office/inventory/tax-profiles" && r.request().method() === "POST");
  await create.getByRole("button", { name: "Save tax profile", exact: true }).click();
  const savedResponse = await saved;
  assert.equal(savedResponse.status(), 201, await savedResponse.text());
  const tax = (await savedResponse.json()).profile.current;
  assert.equal(tax.components[0].rate, "7.25");
  assert.equal(tax.currency, "USD");
  assert.equal(taxRequests.length, 2);
  assert.equal(taxRequests[0].idempotencyKey, taxRequests[1].idempotencyKey, "An uncertain successful create is retried with the same key");
  const count = await pool.query("select count(*) from inventory_tax_profile_versions where company_id=$1 and name='QA explicitly configured tax'", [fixture.companyId]);
  assert.equal(Number(count.rows[0].count), 1, "Lost create response does not duplicate the tax profile");
  for (const label of ["Labor", "Parts", "Shop supplies", "Fees", "Core charges", "Credits"]) {
    const row = page.locator("label").filter({ hasText: new RegExp(`^${label}`) }).filter({ has: page.getByRole("button") });
    await choose(page, row.getByRole("button"), label === "Credits" ? "out of scope" : "exclusive");
  }
  let losePublishResponse = true;
  const publishRequests = [];
  let profilePersisted;
  let releasePublishResponse;
  const profilePersistedPromise = new Promise(resolve => { profilePersisted = resolve; });
  const publishResponseGate = new Promise(resolve => { releasePublishResponse = resolve; });
  await page.route("**/api/admin/customer-document-profiles", async route => {
    publishRequests.push(route.request().postDataJSON());
    if (losePublishResponse) {
      losePublishResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      profilePersisted();
      await publishResponseGate;
      return route.abort("failed");
    }
    return route.continue();
  });
  await publish.click();
  await profilePersistedPromise;
  try {
    assert.equal(await page.getByLabel("Legal name", { exact: true }).isDisabled(), true, "Profile fields cannot change while publish is in flight");
    assert.equal(await page.locator("#commercial-profile-form textarea").evaluateAll(nodes => nodes.length > 0 && nodes.every(node => node.matches(":disabled"))), true, "Text fields cannot change during publishing");
    assert.equal(await page.locator('button[aria-label="Tax profile"]').isDisabled(), true, "Tax selection cannot change while publishing");
  } finally { releasePublishResponse(); }
  await page.getByText("Failed to fetch", { exact: true }).waitFor();
  assert.equal(await publish.isEnabled(), true, "Publish can be retried after a transient failure");
  const issued = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/customer-document-profiles" && r.request().method() === "POST");
  await publish.click();
  const issuedResponse = await issued;
  assert.equal(issuedResponse.status(), 201, await issuedResponse.text());
  const profile = (await issuedResponse.json()).profileVersion;
  assert.equal(publishRequests[0].idempotencyKey, publishRequests[1].idempotencyKey, "Lost profile publish response uses the same command on retry");
  assert.equal(profile.locationId, locationId);
  assert.equal(profile.taxProfileVersionId, tax.id);
  await page.getByText("Commercial profile published. Existing documents keep their original version.", { exact: true }).waitFor();
  await page.reload();
  await page.locator('#commercial-profile-form[aria-busy="false"]').waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Legal name", exact: true }).inputValue(), "Profile Setup QA Shop");
  await page.getByText("Configured · edit tax treatment", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "Tax settings", exact: true }).click();
  assert.ok((await page.getByRole("button", { name: / Tax profile$/ }).innerText()).includes("QA explicitly configured tax"));
  await page.screenshot({ path: `${artifacts}/commercial-profile-created.png`, fullPage: true });
  const rows = (await pool.query("select version.tax_profile_version_id,version.line_tax_policy from customer_document_profile_versions version join customer_document_profiles profile on profile.id=version.profile_id where profile.company_id=$1 and profile.location_id=$2", [fixture.companyId, locationId])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tax_profile_version_id, tax.id);
  assert.equal(rows[0].line_tax_policy.part, "exclusive");
  // A company default may seed a location override, but its identity must never be reused.
  const defaultResponse = await page.request.post(`${baseUrl}/api/admin/customer-document-profiles`, { data: {
    companyId: fixture.companyId, locationId: null, expectedVersion: 0,
    shopIdentity: { legalName: "Company Default QA" }, documentTerms: {}, authorizationText: "I authorize the work shown.",
    discountPolicy: { maxOfficePercentage: "0", reasonRequired: true }, lineTaxPolicy: rows[0].line_tax_policy,
    defaultCurrency: "USD", taxProfileVersionId: tax.id, idempotencyKey: randomUUID(),
  } });
  assert.equal(defaultResponse.status(), 201, await defaultResponse.text());
  const fallbackLocationId = randomUUID();
  await pool.query("insert into locations(id,company_id,name) values($1,$2,'Profile fallback shop')", [fallbackLocationId, fixture.companyId]);
  await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [fixture.otherOfficeId, fallbackLocationId, fixture.companyId]);
  await page.goto(url.replace(locationId, fallbackLocationId));
  await page.locator('#commercial-profile-form[aria-busy="false"]').waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Legal name", exact: true }).inputValue(), "Company Default QA");
  const overrideResponse = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/customer-document-profiles" && r.request().method() === "POST");
  await publish.click();
  const overridden = await overrideResponse;
  assert.equal(overridden.status(), 201, await overridden.text());
  assert.equal(overridden.request().postDataJSON().profileId, null);
  assert.equal(overridden.request().postDataJSON().expectedVersion, 0);
  assert.equal((await overridden.json()).profileVersion.locationId, fallbackLocationId);

}
