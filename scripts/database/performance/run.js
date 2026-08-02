#!/usr/bin/env node
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { closePool, getPool } from "../../../src/server/db/pool.js";
import { INDEX_RECOMMENDATIONS, PLAN_QUERIES, REQUIRED_INDEXES } from "./query-manifest.js";
import { planMetrics, recommendationStatus, sanitizePlan } from "./plan-utils.js";

function integer(value, fallback, name, minimum = 1) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`${name} must be an integer of at least ${minimum}.`);
  return parsed;
}

function number(value, fallback, name, minimum = 0.1) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be at least ${minimum}.`);
  return parsed;
}

function config(env = process.env) {
  return {
    companySlug: String(env.PERF_COMPANY_SLUG || "default").trim(),
    locationName: String(env.PERF_LOCATION_NAME || "Chino Yard").trim(),
    minimumWorkorders: integer(env.PERF_MIN_WORKORDERS, 500, "PERF_MIN_WORKORDERS"),
    budgetScale: number(env.PERF_DB_BUDGET_SCALE, 1, "PERF_DB_BUDGET_SCALE"),
    strictIndexes: String(env.PERF_STRICT_INDEXES || "false").toLowerCase() === "true",
    reportPath: String(env.PERF_DB_REPORT_PATH || ".tmp/performance/postgres-baseline.json").trim(),
  };
}

async function baselineContext(client, input) {
  const result = await client.query(
    `select company.id as company_id,
            location.id as location_id,
            count(distinct workorder.id)::integer as workorder_count,
            (array_agg(assignment.mechanic_user_id) filter (where assignment.mechanic_user_id is not null))[1] as mechanic_id
       from companies company
       join locations location
         on location.company_id = company.id
        and lower(btrim(location.name)) = lower($2)
       left join operational_workorders workorder
         on workorder.company_id = company.id
        and workorder.location_id = location.id
       left join workorder_mechanic_assignments assignment
         on assignment.workorder_id = workorder.id
        and assignment.active = true
      where company.slug = $1
      group by company.id, location.id`,
    [input.companySlug, input.locationName],
  );
  if (!result.rows[0]) throw new Error(`No active baseline context found for ${input.locationName}.`);
  return {
    companyId: result.rows[0].company_id,
    locationId: result.rows[0].location_id,
    mechanicId: result.rows[0].mechanic_id,
    workorderCount: Number(result.rows[0].workorder_count || 0),
  };
}

async function indexAudit(client) {
  const result = await client.query(
    `select tablename, indexname, indexdef
       from pg_indexes
      where schemaname = current_schema()
      order by tablename, indexname`,
  );
  const names = new Set(result.rows.map((row) => row.indexname));
  return {
    missingRequired: REQUIRED_INDEXES.filter((name) => !names.has(name)),
    recommendations: INDEX_RECOMMENDATIONS.map((item) => recommendationStatus(result.rows, item)),
  };
}

async function explain(client, item, context, budgetScale) {
  if (item.requiresMechanic && !context.mechanicId) {
    return { key: item.key, skipped: true, reason: "No assigned mechanic exists in the baseline fixture." };
  }
  const result = await client.query(
    `explain (analyze, buffers, format json) ${item.sql}`,
    item.params(context),
  );
  const raw = result.rows[0]["QUERY PLAN"];
  const metrics = planMetrics(raw);
  const budgetMs = item.budgetMs * budgetScale;
  return {
    key: item.key,
    budgetMs,
    passed: metrics.executionTimeMs <= budgetMs
      && metrics.temporaryWrittenBlocks === 0
      && metrics.actualRows >= (item.minimumRows || 0),
    metrics,
    plan: sanitizePlan(raw),
  };
}

async function writeReport(path, report) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

async function main() {
  const input = config();
  const client = await getPool().connect();
  let transactionOpen = false;
  try {
    await client.query("begin read only");
    transactionOpen = true;
    const versionResult = await client.query("select current_setting('server_version') as server_version");
    const context = await baselineContext(client, input);
    const indexes = await indexAudit(client);
    if (context.workorderCount < input.minimumWorkorders) {
      throw new Error(`Baseline requires at least ${input.minimumWorkorders} workorders; found ${context.workorderCount}.`);
    }
    const plans = [];
    for (const item of PLAN_QUERIES) {
      plans.push(await explain(client, item, context, input.budgetScale));
    }
    await client.query("rollback");
    transactionOpen = false;

    const failures = plans.filter((plan) => plan.passed === false).map((plan) => `${plan.key} exceeded its database budget.`);
    if (input.strictIndexes) failures.push(...indexes.missingRequired.map((name) => `Required index ${name} is missing.`));
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      database: { serverVersion: versionResult.rows[0].server_version },
      fixture: { locationName: input.locationName, workorderCount: context.workorderCount, minimumWorkorders: input.minimumWorkorders },
      budgetScale: input.budgetScale,
      indexes,
      plans,
      failures,
    };
    const path = await writeReport(input.reportPath, report);
    console.table(plans.map((plan) => ({
      query: plan.key,
      status: plan.skipped ? "skipped" : plan.passed ? "pass" : "fail",
      "execution ms": plan.metrics?.executionTimeMs ?? "-",
      "budget ms": plan.budgetMs ?? "-",
      rows: plan.metrics?.actualRows ?? "-",
      "shared reads": plan.metrics?.sharedReadBlocks ?? "-",
    })));
    console.log(`Fixture: ${input.locationName}, ${context.workorderCount} workorders.`);
    console.log(`Missing required indexes: ${indexes.missingRequired.length ? indexes.missingRequired.join(", ") : "none"}.`);
    console.log(`Sanitized report written to ${path}.`);
    if (failures.length) {
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    }
  } finally {
    if (transactionOpen) await client.query("rollback").catch(() => {});
    client.release();
  }
}

main()
  .then(() => closePool())
  .catch(async (error) => {
    await closePool().catch(() => {});
    console.error(`DATABASE PERFORMANCE BASELINE ERROR: ${error.message}`);
    process.exit(1);
  });
