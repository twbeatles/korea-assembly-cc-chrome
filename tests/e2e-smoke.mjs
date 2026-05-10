import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { chromium } from "playwright";

const extensionPath = resolve("dist");
const userDataDir = await mkdtemp(resolve(tmpdir(), "assembly-cc-e2e-"));

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = worker.url().split("/")[2];

  for (const pageName of ["history.html", "options.html", "sidepanel.html"]) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${pageName}`);
    await page.waitForLoadState("domcontentloaded");
    const title = await page.title();
    if (!title) {
      throw new Error(`${pageName} did not render a document title`);
    }
    await page.close();
  }
} finally {
  await context?.close();
  await rm(userDataDir, { recursive: true, force: true });
}

