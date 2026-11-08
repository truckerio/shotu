import assert from "node:assert/strict";

export async function checkWorkorderOdooHandoff({ page, baseUrl, workorderId, role, setStatus }) {
  try {
    for (const status of ["accepted", "mechanic_done", "closed", "odoo_entered", "accepted"]) {
      await setStatus(status);
      // A direct link must obey the same visibility rule as normal navigation.
      await page.goto(`${baseUrl}/?workorder=${workorderId}&section=odoo`);
      const toggle = page.locator('.detail-context-actions button[aria-controls="workorder-preview-panel"]');
      await toggle.waitFor({ state: "visible" });
      await page.locator("#workorder-preview-panel").waitFor({ state: "visible" });
      const handoff = page.getByRole("tab", { name: "Odoo handoff", exact: true });
      const expected = role === "admin" && ["closed", "odoo_entered"].includes(status);
      assert.equal(await page.getByRole("tab", { name: "Integration", exact: true }).count(), 0, `${role} ${status}: no generic Integration tab`);
      assert.equal(await handoff.count(), expected ? 1 : 0, `${role} ${status}: only approved, authorized work shows handoff`);
      if (expected) {
        await handoff.click();
        await page.getByRole("heading", { name: "Odoo handoff", exact: true }).waitFor({ state: "visible" });
      } else {
        assert.equal(await page.locator(".workorder-odoo-panel").count(), 0, `${role} ${status}: deep link cannot mount hidden handoff`);
      }
    }
  } finally {
    await setStatus("accepted");
  }
}
