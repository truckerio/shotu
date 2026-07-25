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
import { handleWorkorderPreferencesApi } from "./src/server/routes/workorder-preferences.routes.js";
import { startSamsaraAutoSync } from "./src/server/integrations/samsara/samsara.auto-sync.js";
import {
  AuthError,
  handleAuthApi,
  handleCurrentUserApi,
  permissionForRequest,
  requirePermission,
  resolveRequestContext,
} from "./src/server/auth/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const dataDir = join(__dirname, "data");
const outputDir = join(__dirname, "printed-workorders");
const uploadDir = join(__dirname, "uploaded-workorders");
const shareDir = join(__dirname, "share-packages");
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

function readBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 75_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        rejectBody(error);
      }
    });
    req.on("error", rejectBody);
  });
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

function ensureCompany(ledger, input) {
  const name = String(input.companyName || input.name || "Default Company").trim() || "Default Company";
  const id = sanitizeCompanyId(name);
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

function formatSerial(company, number) {
  return `${company.prefix}${String(number).padStart(company.digits, "0")}`;
}

async function allocateSerials(input) {
  return withLedgerLock(async () => {
    const ledger = normalizeLedger(await loadLedger());
    const company = ensureCompany(ledger, input);
    const count = clampInt(input.count, 1, 1, 250);
    const issuedSet = new Set(company.issued.map((entry) => entry.serial));
    const now = new Date().toISOString();
    const jobId = crypto.randomUUID();
    const serials = [];
    let current = company.nextNumber;

    while (serials.length < count) {
      const serial = formatSerial(company, current);
      if (!issuedSet.has(serial)) {
        serials.push({ serial, number: current });
        issuedSet.add(serial);
      }
      current += 1;
    }

    for (const entry of serials) {
      company.issued.push({
        serial: entry.serial,
        number: entry.number,
        jobId,
        printerName: input.printerName || "",
        createdAt: now,
      });
      ledger.workorders[entry.serial] = {
        id: crypto.randomUUID(),
        serial: entry.serial,
        number: entry.number,
        companyId: company.id,
        companyName: company.name,
        jobId,
        printerName: input.printerName || "",
        createdAt: now,
        printedAt: null,
        uploadHistory: [],
        shareHistory: [],
      };
    }
    company.nextNumber = current;

    const job = {
      id: jobId,
      companyId: company.id,
      companyName: company.name,
      serials: serials.map((entry) => entry.serial),
      printerName: input.printerName || "",
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

async function markJob(jobId, updates) {
  return withLedgerLock(async () => {
    const ledger = normalizeLedger(await loadLedger());
    const job = ledger.jobs.find((item) => item.id === jobId);
    if (job) Object.assign(job, updates);
    if (job && updates.status) {
      const printedAt = new Date().toISOString();
      for (const serial of job.serials || []) {
        if (ledger.workorders[serial]) ledger.workorders[serial].printedAt = printedAt;
      }
      addActivity(ledger, "print_job_updated", {
        companyId: job.companyId,
        companyName: job.companyName,
        serials: job.serials || [],
        jobId,
        status: updates.status,
      });
    }
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

async function listPrinters() {
  if (process.platform === "darwin" || process.platform === "linux") {
    const defaultResult = await run("lpstat", ["-d"]);
    const result = await run("lpstat", ["-p"]);
    const defaultPrinter = /system default destination:\s*(.+)/i.exec(defaultResult.stdout)?.[1]?.trim() || "";
    const printers = result.stdout
      .split(/\r?\n/)
      .map((lineText) => /^printer\s+(\S+)/.exec(lineText)?.[1])
      .filter(Boolean)
      .map((name) => ({ name, isDefault: name === defaultPrinter }));
    return { platform: process.platform, defaultPrinter, printers };
  }

  if (process.platform === "win32") {
    const script = "Get-Printer | Select-Object Name,Default | ConvertTo-Json -Compress";
    const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    if (!result.ok) return { platform: process.platform, defaultPrinter: "", printers: [] };
    const parsed = JSON.parse(result.stdout || "[]");
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const printers = list.filter(Boolean).map((printer) => ({ name: printer.Name, isDefault: Boolean(printer.Default) }));
    return { platform: process.platform, defaultPrinter: printers.find((printer) => printer.isDefault)?.name || "", printers };
  }

  return { platform: process.platform, defaultPrinter: "", printers: [] };
}

async function printPdf(filePath, printerName) {
  if (!printerName) {
    return { ok: true, skipped: true, message: "No printer selected; PDF saved only." };
  }

  if (process.platform === "darwin" || process.platform === "linux") {
    const result = await run("lp", ["-d", printerName, "-o", "landscape", filePath]);
    return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
  }

  if (process.platform === "win32") {
    const script = `Start-Process -FilePath ${JSON.stringify(filePath)} -Verb PrintTo -ArgumentList ${JSON.stringify(printerName)}`;
    const result = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
    return { ok: result.ok, stdout: result.stdout, stderr: result.stderr };
  }

  return { ok: false, stderr: `Printing unsupported on ${process.platform}` };
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

  if (await handleAuthApi(req, res, url)) return;
  if (await handleCurrentUserApi(req, res, url, { sendJson, resolveRequestContext })) return;

  const requiredPermission = permissionForRequest(req.method, url.pathname);
  let requestContext = null;
  if (requiredPermission) {
    requestContext = await resolveRequestContext(req);
    requirePermission(requestContext, requiredPermission);
  }

  const helpers = { sendJson, readBody, requestContext };

  if (await handleAdminApi(req, res, url, helpers)) return;
  if (await handleConfigApi(req, res, url, helpers)) return;
  if (await handleVehiclesApi(req, res, url, helpers)) return;
  if (await handleIntegrationsApi(req, res, url, helpers)) return;
  if (await handleMechanicApi(req, res, url, helpers)) return;
  if (await handleOfficeApi(req, res, url, helpers)) return;
  if (await handleSurveillanceApi(req, res, url, helpers)) return;
  if (await handlePartsHelperApi(req, res, url, helpers)) return;
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

  if (req.method === "GET" && url.pathname === "/api/printers") {
    sendJson(res, 200, await listPrinters());
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
    const form = input.form || {};
    form.companyName = input.companyName || form.companyName || "Default Company";
    if (input.printerName) {
      const availablePrinters = await listPrinters();
      const printerExists = availablePrinters.printers.some((printer) => printer.name === input.printerName);
      if (!printerExists) {
        sendJson(res, 400, {
          ok: false,
          error: `Printer "${input.printerName}" is not available on this server.`,
          printers: availablePrinters.printers,
        });
        return;
      }
    }
    const allocation = await allocateSerials({ ...input, ...form });
    const pdfPath = await writeWorkorderPdf(form, allocation.company, allocation.job, allocation.serials);
    const printResult = await printPdf(pdfPath, input.printerName || "");
    await markJob(allocation.job.id, {
      status: printResult.ok ? (printResult.skipped ? "saved" : "printed") : "print_failed_serials_consumed",
      pdfPath,
      printMessage: printResult.stderr || printResult.stdout || printResult.message || "",
    });

    sendJson(res, printResult.ok ? 200 : 500, {
      ok: printResult.ok,
      jobId: allocation.job.id,
      serials: allocation.serials,
      nextNumber: allocation.company.nextNumber,
      pdfPath,
      downloadUrl: `/api/jobs/${encodeURIComponent(allocation.job.id)}/pdf`,
      printerName: input.printerName || "",
      printMessage: printResult.stderr || printResult.stdout || printResult.message || "",
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
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (error) {
    if (error instanceof AuthError) {
      sendJson(res, error.statusCode, { error: error.message, code: error.code });
      return;
    }
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Workorder generator running at http://localhost:${port}`);
  startSamsaraAutoSync();
});
