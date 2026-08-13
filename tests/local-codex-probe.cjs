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

async function main() {
  const [port, mode] = process.argv.slice(2);
  const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
  const pages = targets.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
  const expression = `JSON.stringify({
    url: location.href,
    auto: window.__inputStatusAutoSwitch?.version || null,
    recovery: window.__codexTaskRecovery?.version || null,
    autoUi: Boolean(document.getElementById("input-status-auto-switch")),
    recoveryUi: Boolean(document.getElementById("codex-task-recovery")),
    autoCollapsed: document.getElementById("input-status-auto-switch")?.dataset.collapsed || null,
    recoveryCollapsed: document.getElementById("codex-task-recovery")?.dataset.collapsed || null,
    recoveryError: window.__codexTaskRecovery?.getState?.().lastError || null
  })`;

  for (const target of pages) {
    const value = await evaluateTarget(target, expression);
    if (!value) continue;
    const state = JSON.parse(value);
    const autoOk = state.auto === "0.4.0" && state.autoUi && state.autoCollapsed === "true";
    const recoveryOk = state.recovery === "0.4.0" && state.recoveryUi &&
      state.recoveryCollapsed === "true" && !state.recoveryError;
    if ((mode === "baseline") ||
        (mode === "auto" && autoOk) ||
        (mode === "recovery" && recoveryOk) ||
        (mode === "both" && autoOk && recoveryOk)) {
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
