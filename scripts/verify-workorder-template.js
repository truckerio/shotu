import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { renderWorkorderDocument } from "../shared/workorder-template.js";

const outputDir = process.argv[2] || "/tmp/workorder-template-verification";
const parts = Array.from({ length: 7 }, (_, index) => ({
  partNo: `LF9009-CROSS-${index + 1}`,
  qty: String(index + 1),
  repairOrder: `Replaced engine oil filter component ${index + 1}. Checked for leaks after service and verified normal operation.`,
}));
const form = {
  headerTitle: "CHINO YARD WORKORDER",
  brandTop: "PRO TEC",
  brandBottom: "REPAIR",
  mechanicConcern: "Driver reports an engine oil leak near the filter housing after the unit reaches operating temperature.",
  unitNo: "G2213",
  unitType: "Truck",
  workStartDate: "2026-07-25",
  workEndDate: "2026-07-27",
  licenseNo: "9F12345",
  mileage: "623175 mi",
  model: "2022 Freightliner Cascadia",
  vinNo: "1FUJHHDR9NLAB1234",
  customerCompanyName: "Long Haul Transportation Services",
  mechanicName: "Chino Mechanic 1",
  startTime: "08:30 AM",
  endTime: "03:45 PM",
  managerName: "Shop Manager",
  authorizedBy: "Office Manager",
  parts,
  warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
  responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
  authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
};

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const html = renderWorkorderDocument(form, ["WO-000036"]);
const htmlPath = path.join(outputDir, "workorder-readability.html");
const pdfPath = path.join(outputDir, "workorder-readability.pdf");
await writeFile(htmlPath, html);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1056, height: 816 } });
await page.setContent(html, { waitUntil: "load" });

const metrics = await page.evaluate(() => ({
  pages: [...document.querySelectorAll(".workorder-page")].map((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
    scrollWidth: node.scrollWidth,
    scrollHeight: node.scrollHeight,
    overflows: [...node.querySelectorAll("*")]
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => ({
        className: element.className,
        text: element.textContent.trim().slice(0, 100),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      })),
  })),
  fontSizes: {
    label: getComputedStyle(document.querySelector(".wo-label")).fontSize,
    value: getComputedStyle(document.querySelector(".wo-value")).fontSize,
    part: getComputedStyle(document.querySelector(".wo-part-row:not(.wo-part-head) > div")).fontSize,
    footer: getComputedStyle(document.querySelector(".wo-footer > div")).fontSize,
    legal: getComputedStyle(document.querySelector(".wo-disclaimer span")).fontSize,
  },
}));

await page.pdf({ path: pdfPath, printBackground: true, preferCSSPageSize: true });
await browser.close();

await writeFile(path.join(outputDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, pdfPath, ...metrics }, null, 2));
