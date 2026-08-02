#!/usr/bin/env node
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { parseBrowserBenchmarkConfig, publicBrowserConfig } from "./browser-config.js";
import { authenticateRole, LoadHttpClient } from "./http-client.js";

async function writeReport(path, report) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return absolute;
}

async function main() {
  const config = parseBrowserBenchmarkConfig();
  console.log(JSON.stringify(publicBrowserConfig(config), null, 2));
  const client = new LoadHttpClient({ baseUrl: config.baseUrl, requestTimeoutMs: 5000, role: config.role });
  await authenticateRole(client, { identifier: config.identifier, password: config.password });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: config.viewport });
    await context.addCookies(client.jar.browserCookies(config.baseUrl));
    await context.addInitScript(() => {
      window.__workorderLongTasks = [];
      new PerformanceObserver((entries) => {
        window.__workorderLongTasks.push(...entries.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    const started = performance.now();
    await page.goto(new URL(config.path, config.baseUrl).href, { waitUntil: "domcontentloaded" });
    let listVisible = true;
    await page.locator(config.rowSelector).first().waitFor({
      state: "visible",
      timeout: config.budgets.listReadyMs * 2,
    }).catch(() => {
      listVisible = false;
    });
    const listReadyMs = performance.now() - started;
    const metrics = await page.evaluate(async (rowSelector) => {
      const rows = document.querySelectorAll(rowSelector);
      const frameDurations = [];
      let previous = performance.now();
      for (let index = 0; index < 20; index += 1) {
        await new Promise((resolveFrame) => requestAnimationFrame((now) => {
          frameDurations.push(now - previous);
          previous = now;
          window.scrollTo(0, index % 2 ? 0 : document.documentElement.scrollHeight);
          resolveFrame();
        }));
      }
      const navigation = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((entry) => [entry.name, entry.startTime]));
      const longTasks = window.__workorderLongTasks || [];
      return {
        renderedRows: rows.length,
        domContentLoadedMs: navigation?.domContentLoadedEventEnd || 0,
        loadEventMs: navigation?.loadEventEnd || 0,
        firstContentfulPaintMs: paints["first-contentful-paint"] || 0,
        maxLongTaskMs: Math.max(0, ...longTasks),
        longTaskCount: longTasks.length,
        maxFrameMs: Math.max(0, ...frameDurations),
        horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      };
    }, config.rowSelector);
    const failures = [];
    if (!listVisible) failures.push("No role list became visible before the benchmark timeout.");
    if (runtimeErrors.length) failures.push(`Application runtime reported ${runtimeErrors.length} error(s).`);
    if (listReadyMs > config.budgets.listReadyMs) failures.push(`List ready ${listReadyMs.toFixed(1)}ms exceeded ${config.budgets.listReadyMs}ms.`);
    if (metrics.maxLongTaskMs > config.budgets.maxLongTaskMs) failures.push(`Long task ${metrics.maxLongTaskMs.toFixed(1)}ms exceeded ${config.budgets.maxLongTaskMs}ms.`);
    if (metrics.maxFrameMs > config.budgets.maxFrameMs) failures.push(`Frame ${metrics.maxFrameMs.toFixed(1)}ms exceeded ${config.budgets.maxFrameMs}ms.`);
    if (metrics.horizontalOverflowPx > 0) failures.push(`Mobile document overflowed horizontally by ${metrics.horizontalOverflowPx}px.`);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      targetOrigin: config.baseUrl.origin,
      role: config.role,
      viewport: config.viewport,
      budgets: config.budgets,
      metrics: { listReadyMs, ...metrics },
      runtime: { errorCount: runtimeErrors.length },
      failures,
    };
    const path = await writeReport(config.reportPath, report);
    console.table([{ role: config.role, ...report.metrics }]);
    console.log(`Sanitized report written to ${path}.`);
    if (failures.length) {
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`MOBILE RENDER BASELINE ERROR: ${error.message}`);
  process.exit(1);
});
