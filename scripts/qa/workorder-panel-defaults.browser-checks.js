import assert from "node:assert/strict";

export async function checkWorkorderPanelDefaults({ page, baseUrl, workorderId, role }) {
  const failures = [];
  const cases = [
    { name: "Detail", path: `/?workorder=${workorderId}&section=concern`, id: "workorder-preview-panel", open: "Open workorder tools", close: "Close workorder tools" },
    ...(role === "mechanic" ? [] : [{ name: "Create", path: "/?view=create", id: "workorder-documents-panel", open: "Open documents", close: "Close documents" }]),
  ];
  for (const item of cases) {
    try {
      await page.goto(`${baseUrl}${item.path}`);
      const toggle = page.locator(`.detail-context-actions button[aria-controls="${item.id}"]`);
      await toggle.waitFor({ state: "visible" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true", `${role} ${item.name} panel must start expanded`);
      await page.locator(`#${item.id}`).waitFor({ state: "visible" });
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", `${item.name} can close`);
      await toggle.click();
      await page.locator(`#${item.id}`).waitFor({ state: "visible" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true", `${item.name} can reopen`);
      await page.reload();
      await toggle.waitFor({ state: "visible" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "true", `${item.name} reload restores expanded default`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await toggle.waitFor({ state: "visible" });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", `${item.name} mobile drawer stays closed on entry`);
    } catch (error) {
      failures.push(`${item.name}: ${error.message}`);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }
  assert.deepEqual(failures, [], `${role} panel defaults: ${failures.join("; ")}`);
}
