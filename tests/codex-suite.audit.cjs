const { chromium } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function findChromium() {
  const preferred = chromium.executablePath();
  if (fs.existsSync(preferred)) return preferred;
  const root = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  if (!fs.existsSync(root)) return undefined;
  return fs.readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((left, right) => Number(right.split("-")[1]) - Number(left.split("-")[1]))
    .map((name) => path.join(root, name, "chrome-win64", "chrome.exe"))
    .find(fs.existsSync);
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("https://status.input.im/api/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ services: [
      { model: "gpt-5.6-sol", last: { ok: false } },
      { model: "gpt-5.6-terra", last: { ok: true } }
    ] })
  }));
  await page.setContent(`
    <main>
      <div role="alert">Network connection failed</div>
      <div>Network error <button id="retry" aria-label="Retry response">Retry response</button></div>
      <article data-role="user">Keep this task context</article>
    </main>
    <footer><button id="model" aria-haspopup="menu">Model</button></footer>
  `);
  await page.evaluate(() => {
    window.__retryClicks = 0;
    document.querySelector("#retry").addEventListener("click", () => window.__retryClicks += 1);
    document.querySelector("#model").__reactFiber$audit = {
      memoizedProps: {
        models: [{ model: "gpt-5.6-terra", supportedReasoningEfforts: ["high"] }],
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        onSelectModel(model, effort) { window.__selectedModel = { model, effort }; }
      },
      return: null
    };
  });
  await page.addScriptTag({ path: path.join(root, "codex-plus-plus", "codex-status-suite.js") });
  await page.waitForFunction(() =>
    window.__inputStatusAutoSwitch?.version === "0.4.0" &&
    window.__codexTaskRecovery?.version === "0.4.0"
  );
  await page.evaluate(async () => {
    window.__inputStatusAutoSwitch.updateSettings({ pollSeconds: 17, requiredConfirmations: 1 });
    window.__codexTaskRecovery.updateSettings({ pollSeconds: 7, maxAttempts: 4 });
    await window.__inputStatusAutoSwitch.check();
  });
  await page.waitForFunction(() => window.__selectedModel?.model === "gpt-5.6-terra");
  await page.waitForFunction(() => window.__retryClicks > 0);
  const result = await page.evaluate(() => {
    const autoRoot = document.querySelector("#input-status-auto-switch");
    const recoveryRoot = document.querySelector("#codex-task-recovery");
    return {
      auto: window.__inputStatusAutoSwitch.getState(),
      recovery: window.__codexTaskRecovery.getState(),
      selected: window.__selectedModel,
      retryClicks: window.__retryClicks,
      autoSettings: Boolean(autoRoot?.querySelector("[data-settings-toggle]")),
      recoverySettings: Boolean(recoveryRoot?.querySelector("[data-settings-toggle]")),
      autoRight: getComputedStyle(autoRoot).right,
      recoveryRight: getComputedStyle(recoveryRoot).right
    };
  });
  if (errors.length) throw new Error(errors.join(" | "));
  if (result.auto.pollSeconds !== 17 || result.recovery.pollSeconds !== 7) {
    throw new Error("Suite settings were not applied");
  }
  if (!result.autoSettings || !result.recoverySettings) throw new Error("Suite settings UI is missing");
  if (result.autoRight === result.recoveryRight) throw new Error("Suite launchers overlap");
  await page.evaluate(() => {
    window.__inputStatusAutoSwitch.dispose();
    window.__codexTaskRecovery.dispose();
  });
  if (await page.locator("#input-status-auto-switch,#codex-task-recovery").count()) {
    throw new Error("Suite did not dispose cleanly");
  }
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
