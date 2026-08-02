import { chromium } from "playwright";

async function visibleText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}

async function signIn(page, config, role) {
  await page.goto(config.baseUrl.href, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Username or email").fill(config.accounts[role].username);
  await page.locator('input[name="password"]').fill(config.password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 }),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  await page.locator("main").first().waitFor({ state: "visible", timeout: 15_000 });
}

async function assertRoleSurface({ browser, config, role, workflow }) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await signIn(page, config, role);
    const sectionByRole = {
      admin: "activity",
      office: "chat",
      mechanic: "parts",
    };
    if (role === "surveillance") {
      await page.getByRole("button", { name: /^Entered, \d+ workorders$/ }).click();
      await page.getByLabel("Search workorders").fill(workflow.serial);
      await page.getByRole("button", { name: new RegExp(workflow.serial) }).click();
    } else {
      await page.goto(
        new URL(`/?workorder=${encodeURIComponent(workflow.workorderId)}&section=${sectionByRole[role]}`, config.baseUrl).href,
        { waitUntil: "domcontentloaded" },
      );
    }
    await visibleText(page, workflow.concern);

    if (role === "office") {
      await page.getByRole("tab", { name: /Chat with mechanic/ }).click();
      await visibleText(page, workflow.chatBody);
    }
    if (role === "mechanic") await visibleText(page, workflow.partNumber);
    if (role === "surveillance") {
      await page.getByText(/Odoo_entered|Entered in Odoo/i).first().waitFor({ state: "visible", timeout: 15_000 });
    }

    return { role, url: page.url(), passed: true };
  } catch (error) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    error.message = `${role} browser assertion failed at ${page.url()}: ${error.message}\nVisible text: ${bodyText.slice(0, 500) || "[empty]"}`;
    throw error;
  } finally {
    await context.close();
  }
}

export async function assertCriticalRoleSurfaces({ config, workflow }) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: config.browser.headless,
      ...(config.browser.channel ? { channel: config.browser.channel } : {}),
    });
  } catch (error) {
    if (!config.browser.channel) throw error;
    browser = await chromium.launch({ headless: config.browser.headless });
  }

  try {
    const assertions = [];
    for (const role of Object.keys(config.accounts)) {
      assertions.push(await assertRoleSurface({ browser, config, role, workflow }));
    }
    return assertions;
  } finally {
    await browser.close();
  }
}
