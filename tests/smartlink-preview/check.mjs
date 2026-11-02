import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
// Use a locally installed browser; no download or external network is required.
const modulePath = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = await import(
  modulePath.includes(":") ? pathToFileURL(modulePath).href : modulePath
);
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  // Fulfill compiled local assets from disk: browser makes no network requests.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "smartlink-preview.test") return route.abort();
    const file = path.resolve(".smartlink-temp/preview", "." + url.pathname);
    if (!file.startsWith(path.resolve(".smartlink-temp/preview") + path.sep)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  const base = "https://smartlink-preview.test/tests/smartlink-preview/index.html";
  await page.goto(base + "?mode=analytics");
  if (errors.length) throw Error(errors.join("\n"));
  await page.getByText("1428", { exact: true }).waitFor();
  await page.screenshot({ path: "docs/smartlink-analytics.png", fullPage: true });
  await page.getByLabel(/Land/).fill("D");
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "?mode=links");
  await page.getByText("SmartLinks generieren", { exact: true }).waitFor();
  await page.screenshot({ path: "docs/smartlink-mobile.png", fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByLabel(/^Kampagne/).selectOption("11111111-1111-4111-8111-111111111111");
  await page.getByLabel("Ziel-URL", { exact: true }).fill("https://example.com/new-offer");
  await page.getByRole("button", { name: "1.000 Links erstellen", exact: true }).click();
  await page.getByText(/1.100 \/ 1000/).waitFor();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Kampagnenlinks exportieren" }).click();
  const file = await download;
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString("utf8").split("\r\n").length, 1001);
  await page.getByRole("checkbox", { name: "Alle Links dieser Seite auswählen" }).check();
  await page.getByRole("button", { name: "Deaktivieren", exact: true }).click();
  await page.getByText("Deaktiviert", { exact: true }).first().waitFor();
  await page.screenshot({ path: "docs/smartlink-generator.png", fullPage: false });
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: real UI with fixtures, 1,000-link generation, CSV 1,000 rows, bulk deactivate, mobile overflow and analytics render.",
  );
} finally {
  await browser.close();
}
