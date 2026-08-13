const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function findChromium() {
  const preferred = chromium.executablePath();
  if (fs.existsSync(preferred)) return preferred;
  const browserRoot = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(browserRoot)) return undefined;
  const candidates = fs.readdirSync(browserRoot)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]))
    .map((name) => path.join(browserRoot, name, "chrome-win64", "chrome.exe"));
  return candidates.find(fs.existsSync);
}

async function main() {
  const extensionPath = path.resolve(__dirname, "..");
  const userDataDir = path.resolve(extensionPath, "..", ".status-extension-playwright");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    executablePath: findChromium(),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  const errors = [];
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
  });

  try {
    let workers = context.serviceWorkers();
    if (!workers.length) {
      workers = [await context.waitForEvent("serviceworker", { timeout: 10_000 })];
    }
    const worker = workers.find((item) => item.url().startsWith("chrome-extension://"));
    if (!worker) throw new Error("Extension service worker did not start");

    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.click("#refreshBtn");
    await page.waitForFunction(
      () => document.querySelector("#servicesCount")?.textContent === "6/6",
      null,
      { timeout: 20_000 }
    );
    await page.waitForTimeout(1000);

    const result = await page.evaluate(() => ({
      title: document.title,
      model: document.querySelector("#modelName")?.textContent,
      status: document.querySelector("#statusPill")?.textContent,
      source: document.querySelector("#sourceStatus")?.textContent,
      services: document.querySelector("#servicesCount")?.textContent,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: innerWidth,
      bodyHeight: document.body.scrollHeight,
      viewportHeight: innerHeight
    }));
    await page.screenshot({
      path: path.join(extensionPath, "popup-audit.png"),
      fullPage: true
    });
    if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
    if (result.source !== "读取正常") throw new Error(`Status source: ${result.source}`);
    if (result.services !== "6/6") throw new Error(`Service count: ${result.services}`);
    if (result.bodyWidth > result.viewportWidth) throw new Error("Popup has horizontal overflow");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
