import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { authorizeCompanySettings } from "./company-settings.js";

const context = { actor: { id: "user", role: "admin" }, sessionMode: "standard", companyIds: new Set(["A", "B"]),
  companyRoles: new Map([["A", "admin"], ["B", "mechanic"]]) };

test("legacy company settings require explicit existing company admin before mutation", () => {
  for (const input of [{ companyId: "B", nextNumber: 1 }, { companyId: "foreign" }, { name: "new company" }, null, []]) {
    let mutated = false;
    assert.throws(() => { authorizeCompanySettings(context, input); mutated = true; }, (error) => [400, 403, 404].includes(error.statusCode));
    assert.equal(mutated, false);
  }
  assert.deepEqual(authorizeCompanySettings(context, { companyId: " A ", prefix: "QA" }), { companyId: "A", prefix: "QA" });
});

test("HTTP company settings guard runs before the ledger lock or activity write", async () => {
  const source = await readFile(new URL("../../../server.js", import.meta.url), "utf8");
  const branch = source.slice(source.indexOf('req.method === "POST" && url.pathname === "/api/companies"'), source.indexOf('req.method === "POST" && url.pathname === "/api/print"'));
  assert.match(branch, /authorizeCompanySettings\(requestContext, await readBody\(req\)\)/);
  assert.ok(branch.indexOf("authorizeCompanySettings(") < branch.indexOf("withLedgerLock("));
  assert.ok(branch.indexOf("authorizeCompanySettings(") < branch.indexOf("addActivity("));
});
