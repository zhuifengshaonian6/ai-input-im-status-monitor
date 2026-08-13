const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function findChromium() {
  const preferred = chromium.executablePath();
  if (fs.existsSync(preferred)) return preferred;
  const browserRoot = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  const candidates = fs.existsSync(browserRoot)
    ? fs.readdirSync(browserRoot)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]))
      .map((name) => path.join(browserRoot, name, "chrome-win64", "chrome.exe"))
    : [];
  return candidates.find(fs.existsSync);
}

async function auditAutoSwitch(browser, root) {
  const page = await browser.newPage();
  await page.route("https://status.input.im/api/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      services: [
        { model: "gpt-5.6-sol", last: { ok: false } },
        { model: "gpt-5.6-terra", last: { ok: true } }
      ]
    })
  }));
  await page.setContent('<footer><button id="model" aria-haspopup="menu">Model</button></footer>');
  await page.evaluate(() => {
    const trigger = document.querySelector("#model");
    trigger.__reactFiber$audit = {
      memoizedProps: {
        models: [{
          model: "gpt-5.6-terra",
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["medium", "high"]
        }],
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        onSelectModel(model, effort) {
          window.__selectedModel = { model, effort };
        }
      },
      return: null
    };
  });
  await page.addScriptTag({
    path: path.join(root, "codex-plus-plus", "status-model-auto-switch.js")
  });
  await page.waitForFunction(() => window.__inputStatusAutoSwitch?.version === "0.4.0");
  await page.evaluate(() => window.__inputStatusAutoSwitch.check());
  await page.waitForFunction(() => window.__selectedModel?.model === "gpt-5.6-terra");
  const result = await page.evaluate(() => ({
    selected: window.__selectedModel,
    collapsed: document.querySelector("#input-status-auto-switch")?.dataset.collapsed,
    version: window.__inputStatusAutoSwitch.version,
    settingsButton: Boolean(document.querySelector("#input-status-auto-switch [data-settings-toggle]"))
  }));
  await page.evaluate(() => window.__inputStatusAutoSwitch.dispose());
  if (await page.locator("#input-status-auto-switch").count()) {
    throw new Error("Auto-switch UI was not disposed");
  }
  await page.close();
  return result;
}

async function auditTaskRecovery(browser, root) {
  const page = await browser.newPage();
  await page.setContent(`
    <main>
      <div role="alert">Network connection failed</div>
      <div>Network error <button aria-label="Retry response">Retry response</button></div>
      <article data-role="user">Keep this task context</article>
    </main>
  `);
  await page.evaluate(() => {
    window.__retryClicks = 0;
    document.querySelector("button").addEventListener("click", () => {
      window.__retryClicks += 1;
    });
  });
  await page.addScriptTag({
    path: path.join(root, "codex-plus-plus", "codex-task-recovery.js")
  });
  await page.waitForFunction(() => window.__codexTaskRecovery?.version === "0.4.0");
  await page.waitForFunction(() => window.__retryClicks > 0, null, { timeout: 8000 }).catch(async () => {
    const diagnostics = await page.evaluate(() => {
      const button = document.querySelector("button");
      const alert = document.querySelector("[role='alert']");
      const rect = button?.getBoundingClientRect();
      return {
        online: navigator.onLine,
        buttonLabel: button?.getAttribute("aria-label"),
        buttonRect: rect && { width: rect.width, height: rect.height },
        alertText: alert?.textContent,
        state: window.__codexTaskRecovery?.getState?.(),
        clicks: window.__retryClicks
      };
    });
    throw new Error(`Task recovery did not click Retry: ${JSON.stringify(diagnostics)}`);
  });
  const result = await page.evaluate(() => ({
    clicks: window.__retryClicks,
    checkpoint: window.__codexTaskRecovery.getState().checkpoint?.lastUserMessage,
    collapsed: document.querySelector("#codex-task-recovery")?.dataset.collapsed,
    version: window.__codexTaskRecovery.version,
    settingsButton: Boolean(document.querySelector("#codex-task-recovery [data-settings-toggle]"))
  }));
  await page.evaluate(() => window.__codexTaskRecovery.dispose());
  if (await page.locator("#codex-task-recovery").count()) {
    throw new Error("Task recovery UI was not disposed");
  }
  await page.close();
  return result;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  try {
    const autoSwitch = await auditAutoSwitch(browser, root);
    const taskRecovery = await auditTaskRecovery(browser, root);
    console.log(JSON.stringify({ autoSwitch, taskRecovery }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
