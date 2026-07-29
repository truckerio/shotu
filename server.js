import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { renderWorkorderDocument } from "./shared/workorder-template.js";
import { handleConfigApi } from "./src/server/routes/config.routes.js";
import { handleAdminApi } from "./src/server/routes/admin.routes.js";
import { handleIntegrationsApi } from "./src/server/routes/integrations.routes.js";
import { handleMechanicApi } from "./src/server/routes/mechanic.routes.js";
import { handleOfficeApi } from "./src/server/routes/office.routes.js";
import { handlePartsHelperApi } from "./src/server/routes/parts-helper.routes.js";
import { handleSurveillanceApi } from "./src/server/routes/surveillance.routes.js";
import { handleVehiclesApi } from "./src/server/routes/vehicles.routes.js";
import { handleWorkorderDraftsApi } from "./src/server/routes/workorder-drafts.routes.js";
import { handleWorkorderPreferencesApi } from "./src/server/routes/workorder-preferences.routes.js";
import { handleHealthRoute } from "./src/server/routes/health.routes.js";
import { handleKioskApi } from "./src/server/routes/kiosk.routes.js";
import {
  startSamsaraAutoSync,
  stopSamsaraAutoSync,
} from "./src/server/integrations/samsara/samsara.auto-sync.js";
import { closePool } from "./src/server/db/pool.js";
import { installGracefulShutdown, observeRequest } from "./src/server/operations/runtime.js";
import {
  AuthError,
  handleAuthApi,
  handleCurrentUserApi,
  permissionForRequest,
  requirePermission,
  requireWorkorderAccess,
  resolveRequestContext,
} from "./src/server/auth/index.js";
import { getLocationById } from "./src/server/db/repositories/locations.repo.js";
import {
  getWorkorderSerialSettings,
} from "./src/server/db/repositories/serial-counters.repo.js";
import { invalidRequest, resourceNotFound } from "./src/server/auth/errors.js";
import {
  SecurityHttpError,
  applyRateLimitHeaders,
  applySecurityHeaders,
  assertSameOriginMutation,
  createSensitiveRouteRateLimiter,
  readJsonBody,
} from "./src/server/security/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const storageRoot = resolve(process.env.WORKORDER_STORAGE_DIR || __dirname);
const dataDir = join(storageRoot, "data");
const outputDir = join(storageRoot, "printed-workorders");
const uploadDir = join(storageRoot, "uploaded-workorders");
const shareDir = join(storageRoot, "share-packages");
const tempDir = join(__dirname, ".tmp");
const ledgerPath = join(dataDir, "serial-ledger.json");
const frontendDistDir = join(__dirname, "frontend", "dist");

const staticTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
};

let ledgerQueue = Promise.resolve();
const sensitiveRouteRateLimiter = createSensitiveRouteRateLimiter();
const trustedOrigins = String(process.env.AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const trustedIpHeaders = process.env.NODE_ENV === "production"
  ? String(process.env.AUTH_IP_ADDRESS_HEADERS || "x-real-ip")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  : [];

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function sendPdfDownload(res, filePath, fileName) {
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(resolve(outputDir)) || !existsSync(resolvedPath)) {
    sendJson(res, 404, { error: "PDF not found." });
    return;
  }

  const body = await readFile(resolvedPath);
  const safeName = sanitizeFileName(fileName || basename(resolvedPath));
  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": Buffer.byteLength(body),
    "content-disposition": `attachment; filename="${safeName}"`,
    "cache-control": "no-store",
  });
  res.end(body);
}

function downloadNameForJob(job) {
  const serials = Array.isArray(job?.serials) ? job.serials.filter(Boolean) : [];
  if (serials.length === 1) return `${serials[0]}.pdf`;
  if (serials.length > 1) return `${serials[0]}_to_${serials.at(-1)}.pdf`;
  return basename(job?.pdfPath || "workorder.pdf");
}

function requestBodyLimit(req) {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === "/api/upload") return 75_000_000;
  if (pathname.endsWith("/messages")) return 12_000_000;
  return 1_000_000;
}

function readBody(req) {
  return readJsonBody(req, { maxBytes: requestBodyLimit(req) });
}

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    execFile(command, args, { windowsHide: true, ...options }, (error, stdout, stderr) => {
      resolveRun({ ok: !error, stdout, stderr, error });
    });
  });
}

function sanitizeCompanyId(name) {
  return String(name || "default")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "default";
}

function sanitizeFileName(name) {
  return String(name || "workorders")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "workorders";
}

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

async function ensureData() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
  await mkdir(shareDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });
}

async function loadLedger() {
  await ensureData();
  try {
    const raw = await readFile(ledgerPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return { version: 2, companies: {}, workorders: {}, jobs: [], shares: [], activity: [] };
  }
}

function normalizeLedger(ledger) {
  ledger.version = 2;
  ledger.companies ||= {};
  ledger.workorders ||= {};
  ledger.jobs ||= [];
  ledger.shares ||= [];
  ledger.activity ||= [];
  for (const company of Object.values(ledger.companies)) {
    company.issued ||= [];
  }
  return ledger;
}

async function saveLedger(ledger) {
  await ensureData();
  const tempPath = `${ledgerPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(ledger, null, 2));
  await rename(tempPath, ledgerPath);
}

function withLedgerLock(work) {
  const next = ledgerQueue.then(work, work);
  ledgerQueue = next.catch(() => {});
  return next;
}

function companyView(company) {
  return {
    id: company.id,
    name: company.name,
    prefix: company.prefix,
    nextNumber: company.nextNumber,
    digits: company.digits,
    issuedCount: company.issued.length,
    lastIssuedAt: company.issued.at(-1)?.createdAt || null,
  };
}

function addActivity(ledger, type, details) {
  ledger.activity.unshift({
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    ...details,
  });
  ledger.activity = ledger.activity.slice(0, 1000);
}

function publicWorkorder(workorder) {
  return {
    id: workorder.id,
    serial: workorder.serial,
    companyId: workorder.companyId,
    companyName: workorder.companyName,
    createdAt: workorder.createdAt,
    generatedAt: workorder.generatedAt || null,
    printedAt: workorder.printedAt || null,
    uploadedAt: workorder.uploadedAt || null,
    uploadedBy: workorder.uploadedBy || "",
    originalFileName: workorder.originalFileName || "",
    uploadedFilePath: workorder.uploadedFilePath || "",
    status: workorder.uploadedAt ? "uploaded" : "waiting_upload",
    lastSharedAt: workorder.lastSharedAt || null,
    lastSharedTo: workorder.lastSharedTo || "",
    shareCount: workorder.shareCount || 0,
  };
}

function operationalWorkorderPrintForm(workorder) {
  const saved = workorder.formData || {};
  const asset = workorder.asset || {};
  const mechanicName = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
    || workorder.mechanic?.name
    || saved.mechanicName
    || "";
  const model = [asset.year, asset.make, asset.model].filter(Boolean).join(" ");

  return {
    ...saved,
    companyName: saved.companyName || workorder.location?.name || "",
    unitNo: saved.unitNo || asset.unitNo || asset.name || "",
    unitType: saved.unitType || asset.unitType || "",
    licenseNo: saved.licenseNo || asset.licensePlate || "",
    mileage: saved.mileage || (asset.lastOdometerMiles ? String(Math.round(Number(asset.lastOdometerMiles))) : ""),
    model: saved.model || model,
    vinNo: saved.vinNo || asset.vin || "",
    mechanicConcern: saved.mechanicConcern || workorder.concern || "",
    mechanicName,
    officeNotes: workorder.officeNotes || saved.officeNotes || "",
    parts: Array.isArray(saved.parts) ? saved.parts : [],
  };
}

function ensureCompany(ledger, input) {
  const name = String(input.companyName || input.name || "Default Company").trim() || "Default Company";
  const id = String(input.companyId || sanitizeCompanyId(name));
  const existing = ledger.companies[id];
  if (existing) {
    existing.name = name;
    existing.prefix = String(input.prefix ?? existing.prefix ?? "WO-");
    existing.digits = clampInt(input.digits ?? existing.digits, 6, 1, 12);
    const requestedNext = Number.parseInt(input.nextNumber, 10);
    if (Number.isFinite(requestedNext) && requestedNext > existing.nextNumber) {
      existing.nextNumber = requestedNext;
    }
    return existing;
  }

  ledger.companies[id] = {
    id,
    name,
    prefix: String(input.prefix || "WO-"),
    nextNumber: clampInt(input.nextNumber, 1, 1, 999_999_999),
    digits: clampInt(input.digits, 6, 1, 12),
    issued: [],
  };
  return ledger.companies[id];
}

async function recordSerialAllocation(input, reservation) {
  return withLedgerLock(async () => {
    const ledger = normalizeLedger(await loadLedger());
    const company = ensureCompany(ledger, {
      ...input,
      companyId: reservation.companyId,
      prefix: reservation.prefix,
      nextNumber: reservation.nextNumber,
      digits: reservation.digits,
    });
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const serials = reservation.serials.map((serial) => ({
      serial,
      number: Number(/\d+$/.exec(serial)?.[0] || 0),
    }));

    for (const entry of serials) {
      if (!company.issued.some((issued) => issued.serial === entry.serial)) {
        company.issued.push({
          serial: entry.serial,
          number: entry.number,
          jobId,
          createdAt: now,
        });
      }
      const existing = ledger.workorders[entry.serial];
      ledger.workorders[entry.serial] = {
        ...(existing || {}),
        id: existing?.id || crypto.randomUUID(),
        serial: entry.serial,
        number: entry.number,
        companyId: company.id,
        companyName: company.name,
        jobId,
        jobIds: [...new Set([...(existing?.jobIds || (existing?.jobId ? [existing.jobId] : [])), jobId])],
        createdAt: existing?.createdAt || now,
        generatedAt: existing?.generatedAt || null,
        printedAt: existing?.printedAt || null,
        uploadHistory: existing?.uploadHistory || [],
        shareHistory: existing?.shareHistory || [],
      };
    }
    company.nextNumber = reservation.nextNumber;

    const job = {
      id: jobId,
      companyId: company.id,
      companyName: company.name,
      locationId: input.locationId || null,
      workorderId: input.workorderId || null,
      serials: serials.map((entry) => entry.serial),
      createdAt: now,
      status: "allocated",
    };
    ledger.jobs.unshift(job);
    ledger.jobs = ledger.jobs.slice(0, 500);
    addActivity(ledger, "serials_allocated", {
      companyId: company.id,
      companyName: company.name,
      serials: serials.map((entry) => entry.serial),
      jobId,
    });
    await saveLedger(ledger);

    return { ledger, company, job, serials: serials.map((entry) => entry.serial) };
  });
}

async function printCompanyContext(requestContext, locationId = "") {
  const companyIds = [...(requestContext?.companyIds || [])];
  if (!companyIds.length) throw invalidRequest("Your account is not assigned to a company.");
  if (!locationId) return { companyId: companyIds[0], location: null };

  const location = await getLocationById(locationId, companyIds);
  if (!location) throw resourceNotFound("Location");
  if (requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(locationId)) {
    throw resourceNotFound("Location");
  }
  return { companyId: location.company_id, location };
}

async function markPdfGenerated(jobId, pdfPath) {
  return withLedgerLock(async () => {
    const ledger = normalizeLedger(await loadLedger());
    const job = ledger.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Generated PDF job was not found in the serial ledger.");

    const generatedAt = new Date().toISOString();
    Object.assign(job, {
      status: "generated",
      pdfPath,
      generatedAt,
      message: "PDF generated and saved.",
    });
    for (const serial of job.serials || []) {
      if (ledger.workorders[serial]) ledger.workorders[serial].generatedAt = generatedAt;
    }
    addActivity(ledger, "pdf_generated", {
      companyId: job.companyId,
      companyName: job.companyName,
      serials: job.serials || [],
      jobId,
      status: "generated",
    });
    await saveLedger(ledger);
    return job;
  });
}

function chromeExecutable() {
  const pathCandidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  const existingPath = pathCandidates.find((candidate) => existsSync(candidate));
  return existingPath || "google-chrome";
}

async function renderHtmlToPdf(htmlPath, pdfPath) {
  const userDataDir = join(tempDir, `chrome-${crypto.randomUUID()}`);
  await mkdir(userDataDir, { recursive: true });
  const result = await run(chromeExecutable(), [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-dev-shm-usage",
    "--disable-sync",
    "--noerrdialogs",
    "--no-first-run",
    "--no-default-browser-check",
    "--run-all-compositor-stages-before-draw",
    "--print-to-pdf-no-header",
    "--no-pdf-header-footer",
    `--user-data-dir=${userDataDir}`,
    `--print-to-pdf=${pdfPath}`,
    pathToFileURL(htmlPath).href,
  ], { timeout: 12_000 });
  await rm(userDataDir, { recursive: true, force: true });
  if (!result.ok && !existsSync(pdfPath)) {
    throw new Error(result.stderr || result.stdout || "Chrome failed to render workorder PDF.");
  }
}

async function writeWorkorderPdf(form, company, job, serials) {
  const date = new Date().toISOString().slice(0, 10);
  const companyDir = join(outputDir, sanitizeFileName(company.name));
  await mkdir(companyDir, { recursive: true });
  const serialRange = serials.length === 1 ? serials[0] : `${serials[0]}_to_${serials.at(-1)}`;
  const filePath = join(companyDir, `${date}_${sanitizeFileName(serialRange)}_${job.id.slice(0, 8)}.pdf`);
  const htmlPath = join(tempDir, `${job.id}.html`);
  await writeFile(htmlPath, renderWorkorderDocument(form, serials));
  try {
    await renderHtmlToPdf(htmlPath, filePath);
  } finally {
    await rm(htmlPath, { force: true });
  }
  return filePath;
}

function dateInRange(value, from, to) {
  if (!value) return false;
  const day = value.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function filteredWorkorders(ledger, query) {
  const from = query.get("from") || "";
  const to = query.get("to") || "";
  const companyId = query.get("companyId") || "";
  const status = query.get("status") || "";
  const dateField = query.get("dateField") || "createdAt";
  const rows = Object.values(ledger.workorders || {})
    .filter((workorder) => !companyId || workorder.companyId === companyId)
    .filter((workorder) => {
      if (!status) return true;
      if (status === "uploaded") return Boolean(workorder.uploadedAt);
      if (status === "waiting_upload") return !workorder.uploadedAt;
      return true;
    })
    .filter((workorder) => {
      if (!from && !to) return true;
      return dateInRange(workorder[dateField], from, to);
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows.map(publicWorkorder);
}

function decodeBase64File(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Invalid file data.");
  return { mimeType: match[1], buffer: Buffer.from(match[2], "base64") };
}

async function uploadWorkorder(input) {
  return withLedgerLock(async () => {
    const serial = String(input.serial || "").trim();
    if (!serial) throw new Error("Serial number required.");
    const { buffer, mimeType } = decodeBase64File(input.fileData);
    const ledger = normalizeLedger(await loadLedger());
    const workorder = ledger.workorders[serial];
    if (!workorder) throw new Error(`Serial ${serial} was not generated by this app.`);

    const now = new Date().toISOString();
    const companyDir = join(uploadDir, sanitizeFileName(workorder.companyName));
    await mkdir(companyDir, { recursive: true });
    const originalName = sanitizeFileName(input.fileName || `${serial}.pdf`);
    const extension = extname(originalName) || ".pdf";
    const fileName = `${sanitizeFileName(serial)}_${now.replace(/[:.]/g, "-")}${extension}`;
    const filePath = join(companyDir, fileName);
    await writeFile(filePath, buffer);

    workorder.uploadedAt = now;
    workorder.uploadedBy = String(input.uploadedBy || "").trim();
    workorder.originalFileName = input.fileName || fileName;
    workorder.uploadedFilePath = filePath;
    workorder.uploadedMimeType = mimeType;
    workorder.uploadHistory ||= [];
    workorder.uploadHistory.unshift({
      uploadedAt: now,
      uploadedBy: workorder.uploadedBy,
      originalFileName: workorder.originalFileName,
      uploadedFilePath: filePath,
      mimeType,
    });
    addActivity(ledger, "workorder_uploaded", {
      companyId: workorder.companyId,
      companyName: workorder.companyName,
      serials: [serial],
      uploadedBy: workorder.uploadedBy,
      fileName: workorder.originalFileName,
    });
    await saveLedger(ledger);
    return publicWorkorder(workorder);
  });
}

async function createShare(input) {
  return withLedgerLock(async () => {
    const ledger = normalizeLedger(await loadLedger());
    const from = String(input.from || "").slice(0, 10);
    const to = String(input.to || "").slice(0, 10);
    const recipients = String(input.recipients || "").trim();
    if (!from || !to) throw new Error("Date range required.");
    if (!recipients) throw new Error("Recipient email required.");

    const query = new URLSearchParams({
      from,
      to,
      status: "uploaded",
      dateField: input.dateField === "uploadedAt" ? "uploadedAt" : "createdAt",
    });
    if (input.companyId) query.set("companyId", input.companyId);
    const rows = filteredWorkorders(ledger, query);
    if (!rows.length) throw new Error("No uploaded workorders found in this date range.");

    const now = new Date().toISOString();
    const shareId = crypto.randomUUID();
    const folder = join(shareDir, `${from}_to_${to}_${shareId.slice(0, 8)}`);
    await mkdir(folder, { recursive: true });
    const manifestRows = [
      "serial,company,createdAt,uploadedAt,uploadedBy,fileName,filePath",
      ...rows.map((row) => [
        row.serial,
        row.companyName,
        row.createdAt,
        row.uploadedAt,
        row.uploadedBy,
        row.originalFileName,
        row.uploadedFilePath,
      ].map((value) => `"${String(value || "").replaceAll('"', '""')}"`).join(",")),
    ].join("\n");
    await writeFile(join(folder, "manifest.csv"), manifestRows);
    await writeFile(join(folder, "manifest.json"), JSON.stringify(rows, null, 2));

    for (const row of rows) {
      if (!row.uploadedFilePath) continue;
      const destination = join(folder, `${sanitizeFileName(row.serial)}_${sanitizeFileName(row.originalFileName || "workorder.pdf")}`);
      await copyFile(row.uploadedFilePath, destination);
    }

    const share = {
      id: shareId,
      from,
      to,
      dateField: input.dateField === "uploadedAt" ? "uploadedAt" : "createdAt",
      companyId: input.companyId || "",
      recipients,
      note: String(input.note || "").trim(),
      serials: rows.map((row) => row.serial),
      packagePath: folder,
      createdAt: now,
      emailStatus: "prepared",
      emailedAt: now,
    };
    ledger.shares.unshift(share);
    ledger.shares = ledger.shares.slice(0, 500);

    for (const serial of share.serials) {
      const workorder = ledger.workorders[serial];
      if (!workorder) continue;
      workorder.lastSharedAt = now;
      workorder.lastSharedTo = recipients;
      workorder.shareCount = (workorder.shareCount || 0) + 1;
      workorder.shareHistory ||= [];
      workorder.shareHistory.unshift({
        shareId,
        recipients,
        sharedAt: now,
        packagePath: folder,
      });
    }

    addActivity(ledger, "share_prepared", {
      serials: share.serials,
      recipients,
      from,
      to,
      packagePath: folder,
    });
    await saveLedger(ledger);
    return share;
  });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/samsara-logo.png") {
    for (const logoPath of [join(frontendDistDir, "samsara-logo.png"), join(__dirname, "frontend", "public", "samsara-logo.png")]) {
      if (!existsSync(logoPath)) continue;
      const body = await readFile(logoPath);
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" });
      res.end(body);
      return;
    }
  }
  const cleanPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  let filePath = resolve(frontendDistDir, cleanPath);
  if (!filePath.startsWith(resolve(frontendDistDir))) {
    sendText(res, 404, "Not found");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": staticTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    filePath = resolve(__dirname, cleanPath);
    if (!filePath.startsWith(resolve(__dirname)) || filePath.includes(`${basename(dataDir)}/`)) {
      sendText(res, 404, "Not found");
      return;
    }
    try {
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": staticTypes[extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      sendText(res, 404, "Not found");
    }
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rateLimit = sensitiveRouteRateLimiter.check(req, url, { trustedIpHeaders });
  applyRateLimitHeaders(res, rateLimit.result);

  if (await handleAuthApi(req, res, url)) return;
  if (await handleCurrentUserApi(req, res, url, { sendJson, resolveRequestContext })) return;

  assertSameOriginMutation(req, {
    allowedOrigins: trustedOrigins,
    allowMissingOrigin: process.env.NODE_ENV !== "production",
    publicOrigin: process.env.BETTER_AUTH_URL,
  });

  const requiredPermission = permissionForRequest(req.method, url.pathname);
  let requestContext = null;
  if (requiredPermission) {
    requestContext = await resolveRequestContext(req);
    requirePermission(requestContext, requiredPermission);
  }

  const helpers = { sendJson, readBody, requestContext };

  if (await handleAdminApi(req, res, url, helpers)) return;
  if (await handleKioskApi(req, res, url, helpers)) return;
  if (await handleConfigApi(req, res, url, helpers)) return;
  if (await handleVehiclesApi(req, res, url, helpers)) return;
  if (await handleIntegrationsApi(req, res, url, helpers)) return;
  if (await handleMechanicApi(req, res, url, helpers)) return;
  if (await handleOfficeApi(req, res, url, helpers)) return;
  if (await handleSurveillanceApi(req, res, url, helpers)) return;
  if (await handlePartsHelperApi(req, res, url, helpers)) return;
  if (await handleWorkorderDraftsApi(req, res, url, helpers)) return;
  if (await handleWorkorderPreferencesApi(req, res, url, helpers)) return;

  if (req.method === "GET" && url.pathname === "/api/state") {
    const ledger = normalizeLedger(await loadLedger());
    sendJson(res, 200, {
      companies: Object.values(ledger.companies).map(companyView),
      workorders: filteredWorkorders(ledger, url.searchParams),
      jobs: ledger.jobs.slice(0, 50),
      shares: ledger.shares.slice(0, 50),
      activity: ledger.activity.slice(0, 100),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/workorders") {
    const ledger = normalizeLedger(await loadLedger());
    sendJson(res, 200, { workorders: filteredWorkorders(ledger, url.searchParams) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/print-settings") {
    const selected = await printCompanyContext(requestContext, url.searchParams.get("locationId") || "");
    sendJson(res, 200, await getWorkorderSerialSettings(selected.companyId));
    return;
  }

  const pdfMatch = /^\/api\/jobs\/([^/]+)\/pdf$/.exec(url.pathname);
  if (req.method === "GET" && pdfMatch) {
    const ledger = normalizeLedger(await loadLedger());
    const jobId = decodeURIComponent(pdfMatch[1]);
    const job = ledger.jobs.find((entry) => entry.id === jobId);
    if (!job?.pdfPath) {
      sendJson(res, 404, { error: "PDF not found for this print job." });
      return;
    }
    if (!requestContext.companyIds?.has(job.companyId)) throw resourceNotFound("Print job");
    if (job.workorderId) {
      await requireWorkorderAccess(requestContext, job.workorderId);
    } else if (job.locationId && requestContext.actor.role !== "admin" && !requestContext.locationIds?.has(job.locationId)) {
      throw resourceNotFound("Print job");
    }

    await sendPdfDownload(res, job.pdfPath, downloadNameForJob(job));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/companies") {
    const input = await readBody(req);
    const result = await withLedgerLock(async () => {
      const ledger = normalizeLedger(await loadLedger());
      const company = ensureCompany(ledger, input);
      addActivity(ledger, "company_saved", {
        companyId: company.id,
        companyName: company.name,
      });
      await saveLedger(ledger);
      return companyView(company);
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/print") {
    const input = await readBody(req);
    if (!input.workorderId) throw invalidRequest("Create the workorder before printing.");
    const workorder = await requireWorkorderAccess(requestContext, input.workorderId);
    const selected = { companyId: workorder.companyId, location: workorder.location || null };
    const form = operationalWorkorderPrintForm(workorder);
    const settings = await getWorkorderSerialSettings(workorder.companyId);
    const reservation = { ...settings, serials: [workorder.serial] };
    const allocation = await recordSerialAllocation({
      ...input,
      ...form,
      companyId: selected.companyId,
      companyName: selected.location?.name || form.companyName,
      locationId: selected.location?.id || input.locationId || null,
    }, reservation);
    const pdfPath = await writeWorkorderPdf(form, allocation.company, allocation.job, allocation.serials);
    await markPdfGenerated(allocation.job.id, pdfPath);

    sendJson(res, 200, {
      ok: true,
      status: "generated",
      message: "PDF generated and saved. Open it to print with your browser.",
      jobId: allocation.job.id,
      serials: allocation.serials,
      nextNumber: allocation.company.nextNumber,
      downloadUrl: `/api/jobs/${encodeURIComponent(allocation.job.id)}/pdf`,
      printForm: form,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    sendJson(res, 200, await uploadWorkorder(await readBody(req)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/share") {
    sendJson(res, 200, await createShare(await readBody(req)));
    return;
  }

  sendJson(res, 404, { error: "Unknown API route" });
}

const server = createServer(async (req, res) => {
  applySecurityHeaders(res);
  observeRequest(req, res);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (await handleHealthRoute(req, res, url, { sendJson })) {
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, error.statusCode, { error: error.message, code: error.code });
      return;
    }
    if (error instanceof SecurityHttpError) {
      if (error.result) applyRateLimitHeaders(res, error.result);
      sendJson(res, error.statusCode, { error: error.message, code: error.code });
      return;
    }
    console.error(JSON.stringify({
      type: "request_error",
      requestId: req.requestId,
      method: req.method,
      path: new URL(req.url, `http://${req.headers.host}`).pathname,
      errorName: error.name || "Error",
      errorCode: error.code || null,
      message: error.message,
    }));
    const message = process.env.NODE_ENV === "production"
      ? "The request could not be completed."
      : error.message;
    sendJson(res, 500, { error: message, code: "internal_error" });
  }
});

server.listen(port, process.env.HOST || "0.0.0.0", () => {
  console.log(`Workorder generator running at http://localhost:${port}`);
  startSamsaraAutoSync();
});

installGracefulShutdown(server, {
  closeDatabase: closePool,
  stopBackgroundJobs: stopSamsaraAutoSync,
});
