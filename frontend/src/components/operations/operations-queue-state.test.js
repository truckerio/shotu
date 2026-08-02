import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentUrl = new URL("./OperationsWorkspace.jsx", import.meta.url);

async function loadPresentationMapper() {
  const source = await readFile(componentUrl, "utf8");
  const start = source.indexOf("export function buildMobileQueuePresentation");
  assert.notEqual(start, -1, "mobile queue presentation mapper must exist");

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  assert.notEqual(end, -1, "mobile queue presentation mapper must be complete");
  const functionSource = source.slice(start, end).replace(/^export\s+/, "");
  return {
    mapper: Function(`${functionSource}; return buildMobileQueuePresentation;`)(),
    source,
  };
}

const categories = [
  "needs_attention",
  "unassigned",
  "active",
  "parts",
  "ready_review",
  "drafts",
  "odoo_backlog",
  "all",
].map((key) => ({ key, label: key, count: 1 }));
const primaryIds = new Set(["needs_attention", "active", "ready_review"]);

test("responsive presentation preserves a selected secondary queue", async () => {
  const { mapper } = await loadPresentationMapper();
  const presented = mapper(categories, "odoo_backlog", primaryIds);

  assert.deepEqual(presented.primary.map(({ key }) => key), [
    "needs_attention",
    "active",
    "odoo_backlog",
  ]);
  assert.equal(presented.primary.some(({ key }) => key === "all"), false);
  assert.equal(presented.secondary.some(({ key }) => key === "ready_review"), true);
  assert.deepEqual(
    new Set([...presented.primary, ...presented.secondary].map(({ key }) => key)),
    new Set(categories.map(({ key }) => key)),
  );
});

test("unavailable mobile queues are represented without changing canonical selection", async () => {
  const { mapper, source } = await loadPresentationMapper();

  for (const selected of ["unassigned", "parts", "drafts", "odoo_backlog", "all"]) {
    const presented = mapper(categories, selected, primaryIds);
    assert.equal(presented.primary.some(({ key }) => key === selected), true, selected);
  }

  assert.match(source, /buildMobileQueuePresentation\(mobileCategories, filters\.category\)/);
  assert.match(source, /activeTab=\{filters\.category\}/);
  assert.doesNotMatch(source, /matchMedia[\s\S]*setFilters/);
});

test("primary mobile queues retain their stable default presentation", async () => {
  const { mapper } = await loadPresentationMapper();
  const presented = mapper(categories, "active", primaryIds);

  assert.deepEqual(presented.primary.map(({ key }) => key), [
    "needs_attention",
    "active",
    "ready_review",
  ]);
  assert.equal(presented.secondary.some(({ key }) => key === "odoo_backlog"), true);
});
