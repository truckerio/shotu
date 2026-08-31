import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("serialized-unit detail projects tenant-scoped invoice identity", async () => {
  const repository = await readFile(new URL("../../db/repositories/inventory-receipts.repo.js", import.meta.url), "utf8");
  const start = repository.indexOf("export async function getSerializedInventoryUnitInvoiceSource");
  const end = repository.indexOf("export async function getSerializedInventoryUnit({", start + 1);
  const projection = repository.slice(start, end);
  assert.match(projection, /join invoice_extraction_runs invoice\s+on invoice\.company_id = receipt\.company_id and invoice\.id = receipt\.invoice_run_id/);
  assert.match(projection, /coalesce\(invoice\.reviewed_draft, invoice\.extracted_draft\) #>> '\{vendorName,value\}' as vendor_name/);
  assert.match(projection, /coalesce\(invoice\.reviewed_draft, invoice\.extracted_draft\) #>> '\{invoiceNumber,value\}' as invoice_number/);
  assert.match(projection, /unit\.company_id = any\(\$2::uuid\[\]\)/);
  assert.match(projection, /\$4::boolean or unit\.location_id = any\(\$3::uuid\[\]\)/);
});
