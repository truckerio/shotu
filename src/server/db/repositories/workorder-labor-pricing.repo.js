import { getPool, query } from "../pool.js";

const terminalStatuses = new Set(["closed", "odoo_entered", "cancelled"]);

function rate(row) {
  return row && {
    id: row.id,
    productId: row.labor_product_id,
    locationId: row.location_id || null,
    priceKind: row.price_kind,
    version: Number(row.version),
    status: row.amount === null ? "unknown" : "known",
    amount: row.amount === null ? null : String(row.amount),
    currency: row.currency || null,
    createdAt: row.created_at,
  };
}

function snapshot(row) {
  return row && {
    id: row.id,
    productId: row.labor_product_id,
    rateVersionId: row.rate_version_id,
    selection: row.selection,
    hours: String(row.hours),
    unitPrice: String(row.unit_price),
    totalPrice: String(row.total_price),
    currency: row.currency,
    baseUnitPrice: row.base_unit_price === null || row.base_unit_price === undefined ? null : String(row.base_unit_price),
    manualOverride: row.manual_override === true,
    createdAt: row.created_at,
  };
}

function normalizedHours(value) {
  const raw = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(raw)) return null;
  const hours = Number(raw);
  return hours > 0 && hours <= 9999 ? hours : null;
}

function scaledPrice(value) {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) throw new TypeError("Invalid local labor rate.");
  return BigInt(match[1]) * 10000n + BigInt((match[2] || "").padEnd(4, "0"));
}

async function currentRate(client, companyId, locationId, productId, priceKind) {
  const result = await client.query(
    `select * from labor_rate_versions
     where company_id=$1 and labor_product_id=$3 and price_kind=$4
       and (location_id is null or location_id=$2)
     order by (location_id is not null) desc,version desc limit 1`,
    [companyId, locationId, productId, priceKind],
  );
  return result.rows[0] || null;
}

export async function appendLaborRateVersion(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `labor-rate:${input.companyId}:${input.productId}:${input.locationId || "company"}:${input.priceKind}`,
    ]);
    const replay = await client.query(
      `select * from labor_rate_versions where company_id=$1 and created_by=$2 and idempotency_key=$3`,
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "saved", rate: rate(replay.rows[0]), replayed: true }
        : { kind: "idempotency_conflict" };
    }
    const valid = await client.query(
      `select product.id from local_labor_products product
       where product.company_id=$1 and product.id=$2 and product.active=true
         and ($3::uuid is null or exists (
           select 1 from locations location
           where location.company_id=$1 and location.id=$3 and location.active=true
         ))`,
      [input.companyId, input.productId, input.locationId],
    );
    if (!valid.rows[0]) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    const current = await client.query(
      `select * from labor_rate_versions
       where company_id=$1 and labor_product_id=$2 and price_kind=$3
         and location_id is not distinct from $4::uuid
       order by version desc limit 1`,
      [input.companyId, input.productId, input.priceKind, input.locationId],
    );
    const previous = current.rows[0] || null;
    if (Number(previous?.version || 0) !== input.expectedVersion) {
      await client.query("rollback");
      return { kind: "version_conflict", current: rate(previous) };
    }
    const result = await client.query(
      `insert into labor_rate_versions(
         company_id,location_id,labor_product_id,price_kind,version,amount,currency,
         previous_version_id,reason,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
      [input.companyId, input.locationId, input.productId, input.priceKind,
        input.expectedVersion + 1, input.amount, input.currency, previous?.id || null,
        input.reason, input.actorId, input.idempotencyKey, input.requestHash],
    );
    await client.query("commit");
    return { kind: "saved", rate: rate(result.rows[0]), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function saveWorkorderLaborPriceSnapshot(input, transactionClient = null) {
  const client = transactionClient || await getPool().connect();
  try {
    if (!transactionClient) await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `workorder-labor-price:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const replay = await client.query(
      `select * from workorder_labor_price_snapshots
       where company_id=any($1::uuid[]) and created_by=$2 and idempotency_key=$3 limit 1`,
      [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (!transactionClient) await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "saved", laborPrice: snapshot(replay.rows[0]), replayed: true }
        : { kind: "idempotency_conflict" };
    }
    const selected = await client.query(
      `select id,company_id,location_id,status,form_data
       from operational_workorders
       where id=$1 and company_id=any($2::uuid[])
         and ($4::boolean or location_id=any($3::uuid[]))
       for update`,
      [input.workorderId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const workorder = selected.rows[0];
    if (!workorder) {
      if (!transactionClient) await client.query("rollback");
      return { kind: "not_found" };
    }
    if (terminalStatuses.has(workorder.status)) {
      if (!transactionClient) await client.query("rollback");
      return { kind: "locked" };
    }
    const productId = workorder.form_data?.laborProduct?.productId;
    const hours = normalizedHours(workorder.form_data?.laborHours);
    if (!productId || !hours) {
      if (!transactionClient) await client.query("rollback");
      return { kind: "labor_incomplete" };
    }
    const selectedRate = await currentRate(client, workorder.company_id, workorder.location_id, productId, input.selection);
    if (!selectedRate || selectedRate.amount === null || !selectedRate.currency) {
      if (!transactionClient) await client.query("rollback");
      return { kind: "rate_unavailable" };
    }
    if (input.expectedRateVersionId && selectedRate.id !== input.expectedRateVersionId) {
      if (!transactionClient) await client.query("rollback");
      return { kind: "rate_changed", current: rate(selectedRate) };
    }
    const amount = scaledPrice(selectedRate.amount);
    const customAmount = input.customUnitPrice === undefined ? null : scaledPrice(input.customUnitPrice);
    const manualOverride = customAmount !== null && customAmount !== amount;
    const effectiveAmount = manualOverride ? customAmount : amount;
    const centsHours = BigInt(Math.round(hours * 100));
    const total = (effectiveAmount * centsHours + 50n) / 100n;
    const totalPrice = `${total / 10000n}.${(total % 10000n).toString().padStart(4, "0")}`;
    const unitPrice = `${effectiveAmount / 10000n}.${(effectiveAmount % 10000n).toString().padStart(4, "0")}`;
    const result = await client.query(
      `insert into workorder_labor_price_snapshots(
         company_id,workorder_id,labor_product_id,rate_version_id,selection,hours,
         unit_price,total_price,currency,base_unit_price,manual_override,
         created_by,reason,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [workorder.company_id, workorder.id, productId, selectedRate.id, input.selection,
        hours, unitPrice, totalPrice, selectedRate.currency,
        manualOverride ? selectedRate.amount : null, manualOverride,
        input.actorId, input.reason, input.idempotencyKey, input.requestHash],
    );
    if (!transactionClient) await client.query("commit");
    return { kind: "saved", laborPrice: snapshot(result.rows[0]), replayed: false };
  } catch (error) {
    if (!transactionClient) await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}

export async function readWorkorderLaborPricing({ companyId, locationId, workorderId, productId }) {
  const [snapshotResult, rates] = await Promise.all([
    query(`select * from workorder_labor_price_snapshots
           where company_id=$1 and workorder_id=$2
           order by created_at desc,id desc limit 1`, [companyId, workorderId]),
    productId ? query(
      `select distinct on (price_kind) * from labor_rate_versions
       where company_id=$1 and labor_product_id=$2
         and (location_id is null or location_id=$3)
       order by price_kind,(location_id is not null) desc,version desc`,
      [companyId, productId, locationId],
    ) : Promise.resolve({ rows: [] }),
  ]);
  return {
    laborPrice: snapshot(snapshotResult.rows[0]) || null,
    currentLaborRates: Object.fromEntries(rates.rows.map((row) => [row.price_kind, rate(row)])),
  };
}
