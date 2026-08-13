async function evaluateTarget(target, expression) {
  return await new Promise((resolve) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      socket.close();
      resolve("");
    }, 5000);
    socket.addEventListener("open", () => socket.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true }
    })));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result?.result?.value || "");
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [port, mode] = process.argv.slice(2);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const pages = targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
  const installed = path.join(process.env.APPDATA, "Codex++", "user_scripts", "codex-status-suite.js");
  const hotloadSource = mode === "hotload" ? fs.readFileSync(installed, "utf8") : "";
  const hotload = hotloadSource ? `(0, eval)(${JSON.stringify(hotloadSource)}); "hotloaded"` : "";
  const expression = hotload || `JSON.stringify({
    url: location.href,
    auto: window.__inputStatusAutoSwitch?.version || null,
    recovery: window.__codexTaskRecovery?.version || null,
    suite: window.__codexStatusSuite?.version || null,
    suiteCount: document.querySelectorAll("body > #codex-status-suite").length,
    standaloneAuto: Boolean(document.querySelector("body > #input-status-auto-switch")),
    standaloneRecovery: Boolean(document.querySelector("body > #codex-task-recovery")),
    autoParent: document.getElementById("input-status-auto-switch")?.parentElement?.dataset?.suitePane || null,
    recoveryParent: document.getElementById("codex-task-recovery")?.parentElement?.dataset?.suitePane || null,
    autoUi: Boolean(document.getElementById("input-status-auto-switch")),
    recoveryUi: Boolean(document.getElementById("codex-task-recovery")),
    autoCollapsed: document.getElementById("input-status-auto-switch")?.dataset.collapsed || null,
    recoveryCollapsed: document.getElementById("codex-task-recovery")?.dataset.collapsed || null,
    recoveryError: window.__codexTaskRecovery?.getState?.().lastError || null,
    checkpoint: window.__codexTaskRecovery?.getState?.().checkpoint || null,
    visibleVersion: document.querySelector("#codex-status-suite .css-version")?.textContent || null,
    selectedTask: document.querySelector("[aria-current=page]")?.innerText?.trim() || null
  })`;

  for (const target of pages) {
    let value = await evaluateTarget(target, expression);
    if (mode === "hotload" && value !== "") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      value = await evaluateTarget(target, `JSON.stringify({ url: location.href, auto: window.__inputStatusAutoSwitch?.version || null, recovery: window.__codexTaskRecovery?.version || null, suite: window.__codexStatusSuite?.version || null, suiteCount: document.querySelectorAll("body > #codex-status-suite").length, visibleVersion: document.querySelector("#codex-status-suite .css-version")?.textContent || null, checkpoint: window.__codexTaskRecovery?.getState?.().checkpoint || null, selectedTask: document.querySelector("[aria-current=page]")?.innerText?.trim() || null })`);
    }
    if (!value) continue;
    const state = JSON.parse(value);
    const autoOk = state.auto === "0.4.0" && state.autoUi && state.autoCollapsed === "true";
    const recoveryOk = state.recovery === "0.4.1" && state.recoveryUi &&
      state.recoveryCollapsed === "true" && !state.recoveryError;
    const suiteOk = state.suite === "0.5.1" && state.suiteCount === 1 &&
      !state.standaloneAuto && !state.standaloneRecovery &&
      state.autoParent === "models" && state.recoveryParent === "recovery";
    if ((mode === "baseline") ||
        (mode === "hotload" && state.recovery === "0.4.1" && state.suite === "0.5.1" && state.visibleVersion === "v0.5.1") ||
        (mode === "auto" && autoOk) ||
        (mode === "recovery" && recoveryOk) ||
        (mode === "both" && autoOk && recoveryOk && suiteOk)) {
      console.log(value);
      return;
    }
  }
  throw new Error(`Expected state was not found for mode: ${mode}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
