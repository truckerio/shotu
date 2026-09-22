import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const name = `inventory-stock-task-state-${randomUUID()}.html`;
const file = new URL(`../../frontend/${name}`, import.meta.url);
const partId = randomUUID();
const actorId = randomUUID();
const locations = [
  { id: randomUUID(), name: "Shop A" },
  { id: randomUUID(), name: "Shop B" },
];

await writeFile(file, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">
  import React from "react";
  import { createRoot } from "react-dom/client";
  import "/src/typography.css";
  import "/src/styles.css";
  import { InventoryStockTasks } from "/src/features/inventory/InventoryStockTasks.jsx";
  const locations = ${JSON.stringify(locations)};
  const routedPart = { catalogPartId: "${partId}", partNumber: "ROUTED-PART", damageSerialNumber: "ROUTED-001" };
  function App() {
    const [kind, setKind] = React.useState("damage");
    return React.createElement(React.Fragment, null,
      React.createElement("button", { type: "button", onClick: () => setKind("damage") }, "Damage task"),
      React.createElement("button", { type: "button", onClick: () => setKind("transfer") }, "Transfer task"),
      React.createElement(InventoryStockTasks, { key: kind, locations, actorId: "${actorId}", kind, initialLocationId: locations[0].id, initialPart: kind === "damage" ? routedPart : null })
    );
  }
  createRoot(document.getElementById("root")).render(React.createElement(App));
</script></body></html>`);

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    // Vite watches this generated entry; HMR must not reset the fixture mid-journey.
    await context.routeWebSocket(/127\.0\.0\.1:5174/,socket=>socket.close());
    try {
      let transferPost = null;
      async function chooseDropdown(page, trigger, name) {
        await trigger.click();
        const listbox=page.locator('.dropdown-select-listbox');
        await listbox.getByRole('option',{name,exact:true}).press('Enter');
        await listbox.waitFor({state:'hidden'});
      }
      await context.route("**/api/office/inventory/catalog**", (route) => route.fulfill({ json: { items: [{ id: partId, partNumber: "TRANSFER-PART", description: "Transfer part", uomCode: "ea", trackingMode: "quantity" }] } }));
      await context.route("**/api/office/inventory/stock-tasks/snapshot?*", (route) => route.fulfill({ json: { revision: "1", quantity_on_hand: 5, quantity_reserved: 0, tracking_mode: "quantity", uom_code: "ea" } }));
      await context.route(/\/api\/office\/inventory\/stock-tasks\?/, async (route) => {
        const source = new URL(route.request().url()).searchParams.get("locationId");
        if (source === locations[1].id) await new Promise((resolve) => setTimeout(resolve, 300));
        await route.fulfill({ json: { items: source === locations[0].id ? [{ id: "a-task", part_number: "ONLY-AT-A", quantity: 1, uom_code: "ea", status: "inspection", holder: "Rack", kind: "damage", units: [], events: [] }] : [], canApprove: true, hasMore: false } });
      });
      await context.route("**/api/office/inventory/stock-tasks", async (route) => {
        transferPost = route.request().postDataJSON();
        await route.fulfill({ json: { task: { id: "posted", part_number: "TRANSFER-PART", kind: "transfer", status: "in_transit", quantity: 1, uom_code: "ea", holder: "Dock", units: [], events: [] } } });
      });

      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:5174/${name}`);

      await page.getByRole("heading", { name: "Block damaged unit", exact: false }).waitFor();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.getByRole("button", { name: "Mark stock damaged", exact: true }).click();
      assert.equal(await page.getByRole("combobox", { name: "Part number or description" }).count(), 1, "a generic damage task must not retain a routed serial");
      assert.equal(await page.getByLabel("Quantity", { exact: true }).isEditable(), true, "a generic damage quantity must be editable");

      const source = page.locator(".inventory-workflow-toolbar .dropdown-select-trigger").first();
      await chooseDropdown(page, source, 'Shop B');
      await page.waitForTimeout(40);
      assert.equal(await page.getByText("ONLY-AT-A", { exact: true }).count(), 0, "changing shops must clear the previous shop task list while the next list loads");

      await page.getByRole("button", { name: "Transfer task", exact: true }).click();
      await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
      const partInput = page.getByRole("combobox", { name: "Part number or description" });
      await partInput.pressSequentially("TRANSFER",{delay:30});
      try { await page.getByRole("option", { name: /TRANSFER-PART/ }).click(); }
      catch(error) { await page.screenshot({path:'/tmp/inventory-task-failure.png'});console.log(await page.locator('body').innerText());throw error; }
      await page.getByText(/Usable stock: 5 ea; reserved: 0\./).waitFor();
      const transferSource = page.locator(".inventory-workflow-toolbar .dropdown-select-trigger").first();
      const destination = page.locator(".inventory-workflow-form .dropdown-select-trigger").last();
      await chooseDropdown(page, destination, 'Shop B');
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await chooseDropdown(page, transferSource, 'Shop B');
      await page.getByRole("button", { name: "Dispatch transfer", exact: true }).click();
      const reselectedPart = page.getByRole("combobox", { name: "Part number or description" });
      await reselectedPart.pressSequentially("TRANSFER",{delay:30});
      await page.getByRole("option", { name: /TRANSFER-PART/ }).click();
      await page.getByText(/Usable stock: 5 ea; reserved: 0\./).waitFor();
      assert.equal(await destination.innerText(), "Choose destination", "a source change must clear the old transfer destination");
      await chooseDropdown(page, destination, 'Shop A');
      await page.getByLabel("Quantity", { exact: true }).fill("1");
      await page.getByLabel("Carrier / handoff reference", { exact: true }).fill("Dock 4");
      await page.getByLabel("Reason / damage details", { exact: true }).fill("Move stock");
      const posted=page.waitForResponse(response=>response.url().endsWith('/api/office/inventory/stock-tasks')&&response.request().method()==='POST');
      await page.getByRole("button", { name: "Confirm dispatch", exact: true }).click();
      await posted;
      assert.equal(transferPost.locationId, locations[1].id);
      assert.equal(transferPost.destinationId, locations[0].id);
      assert.deepEqual(errors, []);
      console.log(`inventory stock task state passed at ${width}px`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  await unlink(file).catch(() => {});
}
