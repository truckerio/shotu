import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const target = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/workorder_pricing_test_[a-f0-9]{32}$/.test(target.pathname)) {
  throw new Error("Legacy pricing rehearsal requires a dedicated disposable loopback database.");
}
const client = new pg.Client({ connectionString: target.href });
const mode = process.argv[2];
const legacySnapshotId = process.env.LEGACY_SNAPSHOT_ID;
if (!/^[0-9a-f-]{36}$/i.test(legacySnapshotId || "")) throw new Error("LEGACY_SNAPSHOT_ID is required.");
await client.connect();
try {
  if (mode === "prepare") {
    await client.query("begin");
    await client.query("create table if not exists schema_migrations(name text primary key,checksum text not null,applied_at timestamptz not null default now())");
    const directory = join(process.cwd(), "src/server/db/migrations");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".sql") && name < "202_physical_configured_internal_prices.sql").sort();
    for (const name of names) {
      const sql = await readFile(join(directory, name), "utf8");
      await client.query(sql);
      await client.query("insert into schema_migrations(name,checksum) values($1,$2)", [name, createHash("sha256").update(sql).digest("hex")]);
    }
    const ids = Object.fromEntries(["actor", "company", "location", "asset", "part", "workorder", "receipt", "invoiceRun", "line", "unit", "usage"].map((key) => [key, randomUUID()]));
    ids.snapshot = legacySnapshotId;
    await client.query("insert into user_profiles(id,display_name) values($1,'Legacy pricing migration')", [ids.actor]);
    await client.query("insert into companies(id,slug,name) values($1,$2,'Legacy pricing migration')", [ids.company, `legacy-price-${ids.company}`]);
    await client.query("insert into locations(id,company_id,name) values($1,$2,'Legacy pricing shop')", [ids.location, ids.company]);
    await client.query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Legacy truck','LEGACY')", [ids.asset, ids.company, ids.location]);
    await client.query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,'LEGACY','LEGACY','Legacy part','ea','serialized')", [ids.part, ids.company]);
    await client.query("insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status) values($1,$2,'LEGACY-WO',$3,$4,$5,'Legacy','accepted')", [ids.workorder, ids.company, ids.asset, ids.location, ids.actor]);
    // Reuse the canonical local invoice-backed receipt shape from the pricing integration fixture.
    await client.query(`insert into invoice_extraction_runs(
      id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,
      byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at
    ) values($1,$2,$3,$4,$4,$5,'legacy-priced-serial.pdf','application/pdf',1,'legacy-run',
      'reviewed','integration','integration','integration-v1','{}'::jsonb,now())`,
      [ids.invoiceRun, ids.company, ids.location, ids.actor, createHash("sha256").update(ids.invoiceRun).digest("hex")]);
    await client.query("insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,'legacy-receipt','local','legacy-pricing-receipt','confirmed',now())", [ids.receipt, ids.company, ids.location, ids.invoiceRun, ids.actor]);
    await client.query("insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode,unit_cost,line_total,currency,cost_source) values($1,$2,$3,0,$4,'local:legacy-part','LEGACY','Legacy part',1,'ea','serial',12,12,'USD','invoice_line')", [ids.line, ids.company, ids.receipt, ids.part]);
    await client.query("insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id) values($1,$2,$3,$4,$5,1,'LEGACY-SERIAL','reserved','new','inventory_location',$3)", [ids.unit, ids.company, ids.location, ids.receipt, ids.line]);
    await client.query("insert into workorder_serialized_part_usages(id,company_id,workorder_id,asset_id,location_id,unit_id,catalog_part_id,uom_code,status,issued_by_user_id,issue_idempotency_key,issue_request_hash) values($1,$2,$3,$4,$5,$6,$7,'ea','reserved',$8,'legacy-issue',$9)", [ids.usage, ids.company, ids.workorder, ids.asset, ids.location, ids.unit, ids.part, ids.actor, "a".repeat(64)]);
    await client.query("insert into workorder_part_price_snapshots(id,company_id,workorder_id,serialized_usage_id,selection,unit_price,quantity,total_price,currency,receipt_line_id,created_by,reason,idempotency_key,request_hash) values($1,$2,$3,$4,'batch_cost',12,1,12,'USD',$5,$6,'Legacy exact batch','legacy-price',$7)", [ids.snapshot, ids.company, ids.workorder, ids.usage, ids.line, ids.actor, "b".repeat(64)]);
    await client.query("commit");
  } else if (mode === "verify") {
    const result = await client.query("select selection,receipt_line_id,configured_price_version_id from workorder_part_price_snapshots where id=$1", [legacySnapshotId]);
    if (result.rows.length !== 1 || result.rows[0].selection !== "batch_cost" || !result.rows[0].receipt_line_id || result.rows[0].configured_price_version_id !== null) {
      throw new Error("Legacy exact-batch snapshot did not survive pricing migration.");
    }
    console.log("Legacy pricing migration rehearsal passed.");
  } else throw new Error("Expected prepare or verify mode.");
} catch (error) {
  if (mode === "prepare") await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
