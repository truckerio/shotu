import assert from "node:assert/strict";

// Shared by the authenticated role-browser CI suite and the local browser check.
export async function checkCommercialProfileLayout(tab, { observe = async () => {} } = {}) {
  const page = tab.playwright;
  await page.getByRole("heading", { name: "Customer commercial profile", exact: true }).waitFor({ state: "visible" });
  await page.locator('#commercial-profile-form[aria-busy="false"]').waitFor({ state: "visible" });
  const geometry = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".commercial-profile-grid > *")].map((card) => {
      const box = card.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
    });
    return { width: innerWidth, height: innerHeight, pageHeight: document.documentElement.scrollHeight, cards };
  });
  assert.equal(geometry.cards.length, 2, "Form and preview must be the two workspace cards");
  assert.ok(geometry.cards.every((card) => card.top >= 0 && card.bottom <= geometry.height + 1), `Cards must fit the viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.pageHeight <= geometry.height + 1, "Profile workspace must scroll inside its cards");
  assert.ok(geometry.cards[0].right <= geometry.cards[1].left + 1, "Form must sit left of preview on desktop");

  const numbering = page.getByRole("group", { name: "Estimate numbering", exact: true });
  assert.equal(await numbering.isVisible(), false, "Advanced numbering starts hidden");
  await page.getByRole("button", { name: "More profile options", exact: true }).click();
  await observe();
  await page.getByRole("menuitem", { name: "Show advanced settings", exact: true }).click();
  await observe();
  await page.locator("#commercial-profile-advanced summary").filter({ hasText: "Document numbering" }).click();
  await observe();
  const prefix = page.getByRole("textbox", { name: "Estimate prefix", exact: true });
  const original = await prefix.evaluate((input) => input.value);
  await prefix.fill("QA-EST-");
  await page.getByRole("button", { name: "More profile options", exact: true }).click();
  await observe();
  await page.getByRole("menuitem", { name: "Hide advanced settings", exact: true }).click();
  await observe();
  assert.equal(await numbering.isVisible(), false);
  await page.getByRole("button", { name: "More profile options", exact: true }).click();
  await observe();
  await page.getByRole("menuitem", { name: "Show advanced settings", exact: true }).click();
  await observe();
  assert.equal(await prefix.evaluate((input) => input.value), "QA-EST-", "Hiding advanced settings must retain edits");
  await prefix.fill(original);
  await page.getByRole("region", { name: "Profile form", exact: true }).press("End");
  await observe();
  const scrolled = await page.getByRole("region", { name: "Profile form", exact: true }).evaluate((region) => ({ top: region.scrollTop, height: region.clientHeight, scrollHeight: region.scrollHeight }));
  assert.ok(scrolled.scrollHeight > scrolled.height && scrolled.top > 0, "Long form must scroll inside its card with the keyboard");
  assert.equal(await page.getByRole("button", { name: "Publish profile", exact: true }).isVisible(), true, "Publish remains visible while form scrolls");
  return { geometry, scrolled };
}

export async function checkCommercialProfileCompact(tab, { observe = async () => {} } = {}) {
  const page = tab.playwright;
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await observe();
  const name = page.getByRole("textbox", { name: "Legal name", exact: true });
  const original = await name.evaluate((input) => input.value);
  await name.fill("Responsive profile regression");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await observe();
  assert.ok((await page.getByRole("region", { name: "Preview document", exact: true }).innerText()).includes("Responsive profile regression"), "Preview reflects retained form values");
  const geometry = await page.evaluate(() => {
    const visibleCards = [...document.querySelectorAll(".commercial-profile-grid > *")].filter((card) => card.getBoundingClientRect().height > 0);
    return { visibleCards: visibleCards.length, bottom: visibleCards[0]?.getBoundingClientRect().bottom, height: innerHeight, width: innerWidth, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight };
  });
  assert.equal(geometry.visibleCards, 1, "Compact view shows one useful card at a time");
  assert.ok(geometry.bottom <= geometry.height + 1 && geometry.pageHeight <= geometry.height + 1, `Compact card stays in viewport: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.pageWidth <= geometry.width + 1, "No horizontal overflow");
  await page.getByRole("button", { name: "Form", exact: true }).click();
  await observe();
  assert.equal(await name.evaluate((input) => input.value), "Responsive profile regression", "Switching views must retain form edits");
  await name.fill(original);
  return geometry;
}
