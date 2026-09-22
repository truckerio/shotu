import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

function config() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOOPBACK.has(database.hostname)) throw new Error("Invoice browser QA only runs against a local PostgreSQL database.");
  const password = required("QA_ACCOUNT_PASSWORD");
  if (password.length < 12) throw new Error("QA_ACCOUNT_PASSWORD must be at least 12 characters.");
  return {
    database,
    password,
    namespace: required("QA_ACCOUNT_NAMESPACE"),
    companySlug: process.env.QA_COMPANY_SLUG || "default",
    locationName: required("QA_LOCATION_NAME"),
  };
}

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function ocrResult() {
  const cells = [
    ["Fleet QA Parts", 0.08, 0.08], ["Invoice # QA-1001", 0.08, 0.16], ["Date invoice 2026-09-19", 0.08, 0.21],
    ["Qty", 0.08, 0.38], ["Part number", 0.20, 0.38], ["Description", 0.43, 0.38], ["Unit price", 0.68, 0.38], ["Amount", 0.84, 0.38],
    ["2", 0.08, 0.45], ["QA-BOLT-01", 0.20, 0.45], ["QA wheel bolt", 0.43, 0.45], ["12.50", 0.68, 0.45], ["25.00", 0.84, 0.45],
    ["Subtotal 25.00", 0.65, 0.72], ["Total 25.00", 0.65, 0.79],
  ];
  const regions = cells.map(([text, x, y]) => ({ text, confidence: 0.95, pageNumber: 1, x, y, width: 0.08, height: 0.025, polygon: [[x, y], [x + 0.08, y], [x + 0.08, y + 0.025], [x, y + 0.025]] }));
  return { provider: "paddleocr", providerVersion: "qa-fixture", confidence: 0.95, text: cells.map(([text]) => text).join("\n"), pageCount: 1, regions, durationMs: 1 };
}

async function startOcrFixture(token) {
  const calls = { nativeText: 0, ocr: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.headers["x-ocr-token"] !== token) { res.writeHead(401); res.end(); return; }
    if (req.url === "/v1/native-text") {
      calls.nativeText += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ provider: "pdfium", providerVersion: "qa-fixture", text: "short fixture", pageCount: 1, characterCount: 13, durationMs: 1 }));
      return;
    }
    if (req.url === "/v1/ocr") {
      calls.ocr += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ocrResult()));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, calls };
}

async function waitFor(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated app exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(new URL("/health/ready", url));
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for isolated invoice QA app.");
}

async function startApp({ port, publicUrl, ocrPort, token }) {
  const app = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port), HOST: "127.0.0.1", BETTER_AUTH_URL: publicUrl.origin, AUTH_TRUSTED_ORIGINS: publicUrl.origin,
      INVOICE_EXTRACTION_REMOTE_ENABLED: "false", INVOICE_OCR_BASE_URL: `http://127.0.0.1:${ocrPort}`, INVOICE_OCR_TOKEN: token,
      INVOICE_DOCUMENT_ENCRYPTION_KEY: randomBytes(32).toString("base64"), INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION: "invoice-browser-qa",
      INVOICE_EXTRACTION_WORKER_POLL_MS: "250", INVOICE_EXTRACTION_WORKER_CONCURRENCY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  app.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  const appUrl = new URL(`http://127.0.0.1:${port}`);
  try { await waitFor(appUrl, app); } catch (error) { app.kill("SIGTERM"); throw new Error(`${error.message}\n${output}`); }
  return { app };
}

async function startUi({ port, appPort }) {
  const vite = await createServer({
    configFile: false,
    root: "frontend",
    plugins: [react()],
    server: { host: "127.0.0.1", port, strictPort: true, fs: { allow: [".."] }, proxy: { "/api": { target: `http://127.0.0.1:${appPort}`, changeOrigin: true } } },
  });
  await vite.listen();
  return vite;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function scope(pool, settings) {
  const result = await pool.query(
    `select company.id company_id, location.id location_id
     from companies company join locations location on location.company_id=company.id
     where company.slug=$1 and company.active=true and location.active=true and lower(location.name)=lower($2) limit 1`,
    [settings.companySlug, settings.locationName],
  );
  if (!result.rows[0]) throw new Error("QA company/location was not found.");
  return result.rows[0];
}

async function inventoryCounts(pool, { company_id: companyId, location_id: locationId }) {
  const result = await pool.query(
    `select
      (select count(*)::integer from local_inventory_receipts where company_id=$1 and location_id=$2) receipts,
      (select count(*)::integer from inventory_stock_movements where company_id=$1 and location_id=$2) movements,
      (select count(*)::integer from inventory_items where company_id=$1 and location_id=$2) items,
      (select count(*)::integer from inventory_position_balances where company_id=$1 and location_id=$2) position_balances`,
    [companyId, locationId],
  );
  return result.rows[0];
}

async function cleanup(pool, companyId, runIds) {
  if (!companyId || !runIds.size) return;
  await pool.query("delete from integration_jobs where company_id=$1 and payload->>'runId'=any($2::text[])", [companyId, [...runIds]]);
  await pool.query("delete from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])", [companyId, [...runIds]]);
  const left = await pool.query(
    `select (select count(*)::integer from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])) runs,
            (select count(*)::integer from integration_jobs where company_id=$1 and payload->>'runId'=any($3::text[])) jobs`,
    [companyId, [...runIds], [...runIds]],
  );
  assert.deepEqual(left.rows[0], { runs: 0, jobs: 0 }, "invoice QA residue remains");
}

async function browserGate({ baseUrl, client, locationId, runIds }) {
  const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ storageState: await client.storageState(), viewport });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL("/?view=inventory&adminView=inventory&inventoryAction=upload-invoice", baseUrl).href, { waitUntil: "domcontentloaded" });
      if (viewport.width === 1440) {
        const dialog = page.getByRole("dialog", { name: "Upload invoices", exact: true });
        await dialog.waitFor();
        await dialog.locator("input[type=file]").setInputFiles({ name: "invoice-qa.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nInvoice QA\n%%EOF") });
        const upload = page.waitForResponse((response) => response.url().endsWith("/api/office/invoice-extractions") && response.request().method() === "POST" && response.status() === 202);
        await dialog.getByRole("button", { name: /Extract 1 invoice/ }).click();
        const uploadResponse = await upload;
        const body = await uploadResponse.json();
        runIds.add(body.run.id);
        await page.getByRole("heading", { name: /Review invoice-qa\.pdf/ }).waitFor({ timeout: 30_000 });
        assert.ok(new URL(page.url()).searchParams.get("invoiceRun"), "review URL must retain the extraction run");
      } else {
        const runId = [...runIds][0];
        await page.goto(new URL(`/?view=inventory&adminView=inventory&invoiceRun=${encodeURIComponent(runId)}`, baseUrl).href, { waitUntil: "domcontentloaded" });
        await page.getByRole("heading", { name: /Review invoice-qa\.pdf/ }).waitFor({ timeout: 30_000 });
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /Review invoice-qa\.pdf/ }).waitFor({ timeout: 30_000 });
      await page.getByText("Saved invoice draft and secure source restored.").waitFor();
      if (viewport.width <= 900) await page.getByRole("tab", { name: "Document", exact: true }).click();
      await page.locator("object, img").first().waitFor({ state: "visible" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `horizontal overflow at ${viewport.width}px`);
      const sourceStatus = await page.evaluate(async (runId) => (await fetch(`/api/office/invoice-extractions/${encodeURIComponent(runId)}/source`)).status, [...runIds][0]);
      assert.equal(sourceStatus, 200, `authenticated source missing at ${viewport.width}px`);
      await context.close();
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}

async function main() {
  const settings = config();
  const pool = getPool();
  const runIds = new Set();
  let client; let app; let ocr; let ocrCalls; let vite; let companyId; let baseline; let baseUrl;
  const failures = [];
  try {
    const ocrToken = randomBytes(24).toString("hex");
    ({ server: ocr, calls: ocrCalls } = await startOcrFixture(ocrToken));
    const ocrPort = ocr.address().port;
    const appPort = await freePort();
    const uiPort = await freePort();
    baseUrl = new URL(`http://127.0.0.1:${uiPort}`);
    ({ app } = await startApp({ port: appPort, publicUrl: baseUrl, ocrPort, token: ocrToken }));
    vite = await startUi({ port: uiPort, appPort });
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${settings.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(settings.namespace).find((entry) => entry.role === "admin");
    client = await RoleApiClient.create({ role: "admin", baseUrl, timeoutMs: 15_000 });
    await client.authenticate({ ...account, password: settings.password });
    const activeScope = await scope(pool, settings);
    companyId = activeScope.company_id;
    baseline = await inventoryCounts(pool, activeScope);

    const anonymousUpload = await fetch(new URL("/api/office/invoice-extractions", baseUrl), {
      method: "POST",
      headers: { origin: baseUrl.origin, "content-type": "application/json" },
      body: JSON.stringify({ locationId: activeScope.location_id, fileName: "anonymous.pdf", mimeType: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK", idempotencyKey: randomUUID() }),
    });
    assert.equal(anonymousUpload.status, 401, "anonymous invoice upload must be rejected");

    await browserGate({ baseUrl, client, locationId: activeScope.location_id, runIds });
    const runId = [...runIds][0];
    assert.ok(runId, "browser upload did not expose an extraction run");
    const anonymousSource = await fetch(new URL(`/api/office/invoice-extractions/${encodeURIComponent(runId)}/source`, baseUrl));
    assert.equal(anonymousSource.status, 401, "anonymous invoice source must be rejected");
    const authenticatedRun = await client.request(`/api/office/invoice-extractions/${encodeURIComponent(runId)}`);
    assert.equal(authenticatedRun.body.run.id, runId);
    assert.equal(authenticatedRun.body.run.sourceAvailable, true);
    assert.ok(ocrCalls.nativeText > 0 && ocrCalls.ocr > 0, "invoice extraction must use both native-text and OCR fixture boundaries");
    assert.equal(authenticatedRun.body.run.draft.invoiceNumber.value, "QA-1001");
    assert.equal(authenticatedRun.body.run.draft.lines[0].partNumber.value, "QA-BOLT-01");
    assert.equal(Number(authenticatedRun.body.run.draft.lines[0].quantity.value), 2);
    const authenticatedSource = await client.requestBytes(`/api/office/invoice-extractions/${encodeURIComponent(runId)}/source`, { expectedContentType: "application/pdf" });
    assert.ok(authenticatedSource.bytes.length > 0);
    assert.deepEqual(await inventoryCounts(pool, activeScope), baseline, "invoice upload/recovery changed inventory");
    console.log(JSON.stringify({ passed: true, runId, viewports: [1440, 820, 390], inventoryUnchanged: true, cleanup: "pending" }));
  } catch (error) {
    failures.push(error);
  } finally {
    try { await cleanup(pool, companyId, runIds); } catch (error) { failures.push(error); }
    try { await client?.dispose(); } catch (error) { failures.push(error); }
    try { await vite?.close(); } catch (error) { failures.push(error); }
    try { if (app) await stopProcess(app); } catch (error) { failures.push(error); }
    try { if (ocr) await new Promise((resolve) => ocr.close(() => resolve())); } catch (error) { failures.push(error); }
    try { await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${settings.namespace}`], environment: process.env }); } catch (error) { failures.push(error); }
    try { await closePool(); } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Invoice browser QA or cleanup failed.");
  }
}

main().catch((error) => { console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD])); process.exitCode = 1; });
