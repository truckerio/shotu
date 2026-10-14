import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Stock keeps page tabs and offers counted availability through Queue", async () => {
  const source = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /ariaLabel="Inventory stock view"/);
  assert.doesNotMatch(source, /className="inventory-stock-tabs"/);
  assert.match(source, /inventory-queue-field[\s\S]*?<span>Queue<\/span>[\s\S]*?value=\{stockFilter\}/);
  assert.match(source, /stockCounts\[option.value\]/);
  assert.match(source, /icon=\{MarkerPin01\}/);
  assert.match(source, /icon=\{SwitchVertical01\}/);
  assert.match(source, /stockSort !== DEFAULT_STOCK_SORT \? "is-active"/);
});

test("Stock initial loading uses skeleton rows without replacing prefetch rows", async () => {
  const [source, css] = await Promise.all([readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"), readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8")]);
  assert.match(source, /initialLoading \? <div className="inventory-stock-skeleton" role="status" aria-label="Loading inventory" aria-busy="true"/);
  assert.match(source, /Array.from\(\{ length: 10 \}/);
  assert.doesNotMatch(source, /className="loading-icon"/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?inventory-skeleton-bar \{ animation: none/);
});

test("Shared icon dropdown retains the accessible select option owner", async () => {
  const source = await readFile(new URL("../../components/forms/Dropdown.jsx", import.meta.url), "utf8");
  assert.match(source, /icon: TriggerIcon/);
  assert.match(source, /TriggerIcon \? <span className="dropdown-select-trigger-icon" title=\{title\}><TriggerIcon aria-hidden="true"/);
  assert.match(source, /<SelectValue className=\{TriggerIcon \? "dropdown-select-icon-value"/);
  assert.match(source, /aria-label=\{ariaLabel\}/);
  assert.match(source, /<ListBoxItem/);
  assert.match(source, /onSelectionChange=\{changeSelection\}/);
});
