import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./customer-directory-api.js", import.meta.url), "utf8");

test("customer directory API stays tenant-scoped and sends optimistic versions only on edits", () => {
  assert.match(source, /\/api\/customers\?\$\{companyQuery\(companyId\)\}/);
  assert.match(source, /\/api\/customers\/\$\{encodeURIComponent\(customerId\)\}/);
  assert.match(source, /contacts\?\$\{companyQuery\(companyId\)\}/);
  assert.match(source, /companyId, name, address: address \|\| undefined, version/);
  assert.match(source, /companyId, name, email: email \|\| undefined, phone: phone \|\| undefined, version/);
});
