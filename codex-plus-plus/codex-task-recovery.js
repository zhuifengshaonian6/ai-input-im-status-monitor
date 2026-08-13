/*
@codex-plus-script
name: Codex Task Recovery
description: Preserve task checkpoints and safely resume the current Codex task after network or upstream interruptions.
version: 0.4.1
author: AI.INPUT.IM Status Monitor
*/

(() => {
  "use strict";

  const API_KEY = "__codexTaskRecovery";
  const STYLE_ID = "codex-task-recovery-style";
  const ROOT_ID = "codex-task-recovery";
  const STORAGE_KEY = "codexTaskRecovery.v1";
  const DEFAULT_POLL_SECONDS = 5;
  const DEFAULT_CHECKPOINT_SECONDS = 30;
  const DEFAULT_RETRY_SECONDS = 12;
  const DEFAULT_MAX_ATTEMPTS = 3;
  const VERSION = "0.4.1";
  const ERROR_RE = /failed to fetch|network|offline|connection|timed out|timeout|upstream|temporarily unavailable|service unavailable|\u4e2d\u65ad|\u7f51\u7edc|\u8fde\u63a5|\u8d85\u65f6|\u4e0a\u6e38|\u4e0d\u53ef\u7528|\u5931\u8d25|\u91cd\u8bd5/i;
  const RESUME_RE = /^(retry|try again|retry response|regenerate|continue|resume|\u91cd\u65b0\u751f\u6210|\u91cd\u8bd5|\u7ee7\u7eed|\u6062\u590d|\u518d\u8bd5\u4e00\u6b21)$/i;
  const RESUME_HINT_RE = /retry|try again|regenerate|continue|resume|\u91cd\u65b0\u751f\u6210|\u91cd\u8bd5|\u7ee7\u7eed|\u6062\u590d|\u518d\u8bd5\u4e00\u6b21/i;
  const USER_PREFIX_RE = /^(?:\u4f60\u8bf4\s*[\uff1a:]|you said\s*:)/i;

  function readSavedState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") return false;
    const rect = element.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0);
  }

  function buttonLabel(element) {
    return cleanText(
      element.getAttribute?.("aria-label")
      || element.getAttribute?.("title")
      || element.textContent
    );
  }

  function isPluginElement(element) {
    return Boolean(element?.closest?.(`#${ROOT_ID}`));
  }

  function findResumeButton(documentRef = document) {
    const candidates = [...documentRef.querySelectorAll(
      "button,[role='button'],input[type='button'],input[type='submit']"
    )].filter((element) => isVisible(element) && !isPluginElement(element));
    const scored = candidates.map((element) => {
      const label = buttonLabel(element);
      if (!label || !RESUME_HINT_RE.test(label)) return null;
      const exact = RESUME_RE.test(label);
      const nearby = cleanText(element.parentElement?.textContent);
      const errorContext = ERROR_RE.test(nearby);
      const genericContinue = /^(continue|resume|\u7ee7\u7eed|\u6062\u590d)$/i.test(label);
      if (genericContinue && !errorContext) return null;
      const score = (exact ? 5 : 2) + (errorContext ? 4 : 0);
      return { element, label, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }

  function hasRecoverySignal(documentRef = document) {
    if (!navigator.onLine) return true;
    const alerts = [...documentRef.querySelectorAll?.(
      "[role='alert'],[aria-live='assertive'],[data-testid*='error'],[data-state='error']"
    ) || []].filter((element) => !isPluginElement(element));
    return alerts.some((element) => ERROR_RE.test(cleanText(element.textContent)));
  }

  function selectedTaskKey(documentRef, parsedUrl) {
    const selected = documentRef.querySelector?.("[aria-current='page']");
    for (let node = selected, depth = 0; node && depth < 6; node = node.parentElement, depth += 1) {
      const href = node.getAttribute?.("href");
      if (href) {
        try { const selectedUrl = new URL(href, parsedUrl); const id = selectedUrl.searchParams.get("threadId") || selectedUrl.searchParams.get("conversationId") || selectedUrl.searchParams.get("taskId"); if (id) return `id:${id}`; if (selectedUrl.pathname && selectedUrl.pathname !== "/" && selectedUrl.pathname !== "/index.html") return `path:${selectedUrl.pathname}${selectedUrl.search}`; } catch {}
      }
      for (const name of ["data-thread-id", "data-conversation-id", "data-task-id", "data-id"]) { const value = cleanText(node.getAttribute?.(name)); if (value) return `${name}:${value}`; }
    }
    const title = cleanText(selected?.innerText || selected?.textContent).replace(/\s+(?:waiting for approval|\u7b49\u5f85\u6279\u51c6)$/i, "");
    if (!title) return null;
    const workspace = cleanText(documentRef.querySelector?.("[data-workspace-id]")?.getAttribute?.("data-workspace-id") || documentRef.querySelector?.("[data-project-id]")?.getAttribute?.("data-project-id") || parsedUrl.host);
    return `title:${workspace}:${title}`;
  }

  function latestUserMessage(documentRef) {
    const scope = documentRef.querySelector?.("main") || documentRef.body || documentRef;
    const explicit = [...scope.querySelectorAll?.("[data-local-conversation-user-anchor='true'],[data-message-author='user'],[data-role='user'],[aria-label^='You said'],[aria-label^='\u4f60\u8bf4']") || []];
    const semantic = [...scope.querySelectorAll?.("article,section,div") || []].filter((node) => {
      if (isPluginElement(node)) return false;
      const text = cleanText(node.innerText || node.textContent);
      if (!USER_PREFIX_RE.test(text) || text.length > 10000) return false;
      return ![...(node.children || [])].some((child) => USER_PREFIX_RE.test(cleanText(child.innerText || child.textContent)));
    });
    const candidates = [...new Set([...explicit, ...semantic])].filter((node) => !isPluginElement(node));
    const ordered = candidates.sort((a, b) => { if (a === b) return 0; const position = a.compareDocumentPosition?.(b) || 0; return position & 4 ? -1 : position & 2 ? 1 : 0; });
    const last = ordered.at(-1);
    const text = cleanText(last?.innerText || last?.textContent);
    return text ? cleanText(text.replace(USER_PREFIX_RE, "")).slice(0, 2000) : null;
  }

  function checkpoint(documentRef = document) {
    const url = location.href;
    const parsedUrl = new URL(url);
    const explicitId = parsedUrl.searchParams.get("threadId") || parsedUrl.searchParams.get("conversationId") || parsedUrl.searchParams.get("taskId");
    const pathKey = parsedUrl.pathname && parsedUrl.pathname !== "/" && parsedUrl.pathname !== "/index.html" ? `path:${parsedUrl.pathname}${parsedUrl.search}` : null;
    return { threadKey: explicitId ? `id:${explicitId}` : pathKey || selectedTaskKey(documentRef, parsedUrl), url, lastUserMessage: latestUserMessage(documentRef), savedAt: Date.now() };
  }

  if (globalThis.__CODEX_TASK_RECOVERY_TEST__) {
    globalThis.__codexTaskRecoveryTestHooks = {
      checkpoint,
      latestUserMessage,
      selectedTaskKey,
      findResumeButton,
      hasRecoverySignal
    };
    return;
  }

  window[API_KEY]?.dispose?.();
  const saved = readSavedState();
  const savedCheckpoint = saved.checkpoint?.threadKey === "app://-/index.html"
    ? null
    : saved.checkpoint;
  const state = {
    enabled: saved.enabled !== false,
    collapsed: saved.collapsed !== false,
    pollSeconds: clampNumber(saved.pollSeconds, 3, 60, DEFAULT_POLL_SECONDS),
    checkpointSeconds: clampNumber(saved.checkpointSeconds, 10, 600, DEFAULT_CHECKPOINT_SECONDS),
    retrySeconds: clampNumber(saved.retrySeconds, 5, 300, DEFAULT_RETRY_SECONDS),
    maxAttempts: clampNumber(saved.maxAttempts, 1, 10, DEFAULT_MAX_ATTEMPTS),
    phase: "watching",
    attempts: 0,
    lastAttemptAt: 0,
    lastError: null,
    checkpoint: savedCheckpoint || null,
    timer: null,
    bootstrapTimer: null,
    lastCheckpointAt: 0,
    onlineHandler: null,
    offlineHandler: null,
    lastPersisted: null,
    started: false,
    disposed: false
  };

  function persist() {
    const serialized = JSON.stringify({
      enabled: state.enabled,
      collapsed: state.collapsed,
      pollSeconds: state.pollSeconds,
      checkpointSeconds: state.checkpointSeconds,
      retrySeconds: state.retrySeconds,
      maxAttempts: state.maxAttempts,
      checkpoint: state.checkpoint
    });
    if (serialized === state.lastPersisted) return;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      state.lastPersisted = serialized;
    } catch {
      // Checkpoint remains available in memory when host storage is unavailable.
    }
  }

  function saveCheckpoint() {
    const now = Date.now();
    if (state.lastCheckpointAt && now - state.lastCheckpointAt < state.checkpointSeconds * 1000) return false;
    state.lastCheckpointAt = now;
    const next = checkpoint(document);
    const previous = state.checkpoint;
    if (previous
      && previous.threadKey === next.threadKey
      && previous.url === next.url
      && previous.lastUserMessage === next.lastUserMessage) return false;
    if (!next.threadKey || !next.lastUserMessage) return false;
    if (previous?.threadKey !== next.threadKey) state.attempts = 0;
    state.checkpoint = next;
    persist();
    return true;
  }

  function ensureUi() {
    if (!document.head || !document.body) return null;
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${ROOT_ID}{position:fixed;right:64px;bottom:16px;z-index:2147481999;width:min(340px,calc(100vw - 32px));font:12px ui-sans-serif,system-ui,sans-serif;color:#f1f4f8}
        #${ROOT_ID}[data-collapsed=true]{width:38px;height:38px}
        #${ROOT_ID} *{box-sizing:border-box}
        #${ROOT_ID} .tr-panel{border:1px solid rgba(255,255,255,.14);border-radius:8px;background:#171a21;box-shadow:0 16px 40px rgba(0,0,0,.35);overflow:hidden}
        #${ROOT_ID} .tr-head,#${ROOT_ID} .tr-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 11px}
        #${ROOT_ID} .tr-head{border-bottom:1px solid rgba(255,255,255,.09)}
        #${ROOT_ID} .tr-head-actions{display:flex;align-items:center;gap:6px}
        #${ROOT_ID} .tr-title{font-weight:800}
        #${ROOT_ID} .tr-state{color:#66d9e8;font-size:11px}
        #${ROOT_ID} .tr-body{display:grid;gap:5px;padding:10px 11px;color:#9aa4b2;line-height:1.4}
        #${ROOT_ID} .tr-body strong{color:#f1f4f8;font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
        #${ROOT_ID} button{min-height:30px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:#1e232c;color:#f1f4f8;padding:0 10px;cursor:pointer}
        #${ROOT_ID} button:hover{background:#292f3a}
        #${ROOT_ID} button[data-primary=true]{border-color:rgba(102,217,232,.6);color:#66d9e8}
        #${ROOT_ID} .tr-collapse{display:grid;place-items:center;width:28px;min-height:28px;padding:0;font-size:16px}
        #${ROOT_ID} .tr-settings-toggle{display:grid;place-items:center;width:28px;min-height:28px;padding:0;font-size:15px}
        #${ROOT_ID} .tr-settings{display:none;gap:9px;padding:11px;border-top:1px solid rgba(255,255,255,.09);font-size:11px}
        #${ROOT_ID}[data-settings=true] .tr-settings{display:grid}
        #${ROOT_ID} .tr-settings label{display:grid;gap:4px;color:#9aa4b2}
        #${ROOT_ID} .tr-settings input{width:100%;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:#11151b;color:#f1f4f8;padding:7px 8px;font:11px ui-monospace,Consolas,monospace}
        #${ROOT_ID} .tr-settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
        #${ROOT_ID} .tr-settings-result{min-height:15px;color:#66d9e8}
        #${ROOT_ID} .tr-launcher{display:none;width:38px;height:38px;min-height:38px;padding:0;border-color:rgba(102,217,232,.6);border-radius:8px;background:#171a21;box-shadow:0 8px 22px rgba(0,0,0,.3)}
        #${ROOT_ID} .tr-launcher::before{content:"";width:9px;height:9px;border-radius:50%;background:#66d9e8;box-shadow:0 0 0 3px rgba(102,217,232,.16)}
        #${ROOT_ID}[data-phase=attention] .tr-launcher::before{background:#f0ad4e;box-shadow:0 0 0 3px rgba(240,173,78,.18)}
        #${ROOT_ID}[data-phase=error] .tr-launcher::before{background:#ff6b6b;box-shadow:0 0 0 3px rgba(255,107,107,.18)}
        #${ROOT_ID}[data-collapsed=true] .tr-panel{display:none}
        #${ROOT_ID}[data-collapsed=true] .tr-launcher{display:grid;place-items:center}
      `;
      document.head.appendChild(style);
    }
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("aside");
      root.id = ROOT_ID;
      root.innerHTML = `
        <section class="tr-panel">
          <div class="tr-head"><span class="tr-title">Task Recovery</span><div class="tr-head-actions"><span class="tr-state"></span><button class="tr-settings-toggle" data-settings-toggle aria-label="Settings" title="Settings">&#9881;</button><button class="tr-collapse" data-collapse aria-label="Collapse" title="Collapse">&#8722;</button></div></div>
          <div class="tr-body">
            <span>Checkpoint <strong data-checkpoint>--</strong></span>
            <span data-message>Watching the current task</span>
          </div>
          <div class="tr-actions">
            <button data-toggle data-primary="true"></button>
            <button data-resume>Resume current task</button>
          </div>
          <form class="tr-settings" data-settings>
            <div class="tr-settings-grid"><label>Scan interval (seconds)<input data-poll type="number" min="3" max="60"></label><label>Checkpoint interval (seconds)<input data-checkpoint-seconds type="number" min="10" max="600"></label><label>Retry cooldown (seconds)<input data-retry type="number" min="5" max="300"></label><label>Max auto attempts<input data-attempts type="number" min="1" max="10"></label></div>
            <button type="submit" data-primary="true">Save settings</button>
            <span class="tr-settings-result" data-settings-result></span>
          </form>
        </section>
        <button class="tr-launcher" data-expand aria-label="Open task recovery" title="Task recovery"></button>
      `;
      root.querySelector("[data-toggle]").addEventListener("click", () => {
        state.enabled = !state.enabled;
        state.phase = state.enabled ? "watching" : "paused";
        persist();
        render();
      });
      root.querySelector("[data-collapse]").addEventListener("click", () => {
        state.collapsed = true;
        persist();
        render();
      });
      root.querySelector("[data-expand]").addEventListener("click", () => {
        state.collapsed = false;
        persist();
        render();
      });
      root.querySelector("[data-resume]").addEventListener("click", () => resume(true));
      root.querySelector("[data-settings-toggle]").addEventListener("click", () => {
        root.dataset.settings = String(root.dataset.settings !== "true");
      });
      root.querySelector("[data-settings]").addEventListener("submit", (event) => {
        event.preventDefault();
        state.pollSeconds = clampNumber(root.querySelector("[data-poll]").value, 3, 60, DEFAULT_POLL_SECONDS);
        state.checkpointSeconds = clampNumber(root.querySelector("[data-checkpoint-seconds]").value, 10, 600, DEFAULT_CHECKPOINT_SECONDS);
        state.retrySeconds = clampNumber(root.querySelector("[data-retry]").value, 5, 300, DEFAULT_RETRY_SECONDS);
        state.maxAttempts = clampNumber(root.querySelector("[data-attempts]").value, 1, 10, DEFAULT_MAX_ATTEMPTS);
        persist();
        schedule();
        root.querySelector("[data-settings-result]").textContent = "Saved";
      });
      document.body.appendChild(root);
    }
    return root;
  }

  function render(message) {
    const root = ensureUi();
    if (!root) return;
    const setText = (selector, value) => {
      const node = root.querySelector(selector);
      if (node && node.textContent !== value) node.textContent = value;
    };
    const collapsed = String(state.collapsed);
    if (root.dataset.collapsed !== collapsed) root.dataset.collapsed = collapsed;
    if (root.dataset.phase !== state.phase) root.dataset.phase = state.phase;
    root.querySelector("[data-poll]").value = String(state.pollSeconds);
    root.querySelector("[data-checkpoint-seconds]").value = String(state.checkpointSeconds);
    root.querySelector("[data-retry]").value = String(state.retrySeconds);
    root.querySelector("[data-attempts]").value = String(state.maxAttempts);
    const labels = {
      watching: "WATCHING",
      paused: "PAUSED",
      attention: "RECOVERABLE",
      recovering: "RESUMING",
      recovered: "RUNNING",
      error: "CHECK REQUIRED"
    };
    setText(".tr-state", labels[state.phase] || state.phase);
    setText("[data-checkpoint]", state.checkpoint
      ? new Date(state.checkpoint.savedAt).toLocaleTimeString()
      : "--");
    setText("[data-message]", message
      || state.lastError
      || (state.checkpoint ? "Task context checkpoint saved locally" : "Watching the current task"));
    setText("[data-toggle]", state.enabled ? "Pause" : "Resume");
  }

  function safeRender(message) {
    try {
      render(message);
    } catch (error) {
      state.lastError = `Recovery UI unavailable: ${String(error?.message || error)}`;
    }
  }

  function inspect() {
    if (state.disposed) return;
    saveCheckpoint();
    const signal = hasRecoverySignal(document);
    const candidate = findResumeButton(document);
    if (!signal) {
      state.attempts = 0;
      if (state.phase !== "recovering") state.phase = "watching";
      safeRender();
      return;
    }
    if (!candidate) {
      state.phase = "attention";
      safeRender("Network or upstream interruption detected; click Resume when Codex shows its native retry action");
      return;
    }
    state.phase = "attention";
    if (state.enabled && navigator.onLine && Date.now() - state.lastAttemptAt >= state.retrySeconds * 1000) {
      void resume(false);
    }
    safeRender(`Native recovery action found: ${candidate.label}`);
  }

  async function resume(manual) {
    if (state.disposed) return false;
    const candidate = findResumeButton(document);
    if (!candidate) {
      state.phase = "error";
      state.lastError = "No native Retry/Continue action is visible yet";
      safeRender();
      return false;
    }
    if (!manual && state.attempts >= state.maxAttempts) {
      state.phase = "attention";
      safeRender(`Automatic attempts paused after ${state.maxAttempts} tries; click Resume to continue`);
      return false;
    }
    state.attempts += 1;
    state.lastAttemptAt = Date.now();
    state.phase = "recovering";
    state.lastError = null;
    safeRender(`Resuming via Codex native action: ${candidate.label}`);
    candidate.element.click();
    window.setTimeout(() => {
      const next = findResumeButton(document);
      if (next) {
        state.phase = "attention";
        safeRender("Codex still shows a recovery action; context was preserved");
      } else {
        state.phase = "recovered";
        safeRender("Recovery action cleared; Codex is running");
      }
    }, 2500);
    return true;
  }

  function dispose() {
    state.disposed = true;
    if (state.timer) clearInterval(state.timer);
    if (state.bootstrapTimer) clearTimeout(state.bootstrapTimer);
    if (state.onlineHandler) window.removeEventListener("online", state.onlineHandler);
    if (state.offlineHandler) window.removeEventListener("offline", state.offlineHandler);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    if (window[API_KEY]?.version === VERSION) delete window[API_KEY];
  }

  function schedule() {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(inspect, state.pollSeconds * 1000);
  }

  function start() {
    if (state.started || state.disposed) return;
    state.started = true;
    if (state.bootstrapTimer) clearTimeout(state.bootstrapTimer);
    saveCheckpoint();
    state.onlineHandler = () => {
      if (!state.enabled) return;
      state.phase = "attention";
      safeRender("Network restored; waiting for Codex native recovery action");
      inspect();
    };
    state.offlineHandler = () => {
      state.phase = "attention";
      safeRender("Network offline; checkpoint saved");
    };
    window.addEventListener("online", state.onlineHandler);
    window.addEventListener("offline", state.offlineHandler);
    schedule();
    safeRender();
    inspect();
  }

  window[API_KEY] = {
    version: VERSION,
    getState: () => ({ ...state, timer: undefined }),
    saveCheckpoint,
    resume: () => resume(true),
    setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      persist();
      safeRender();
    },
    updateSettings(settings = {}) {
      state.pollSeconds = clampNumber(settings.pollSeconds, 3, 60, state.pollSeconds);
      state.checkpointSeconds = clampNumber(settings.checkpointSeconds, 10, 600, state.checkpointSeconds);
      state.retrySeconds = clampNumber(settings.retrySeconds, 5, 300, state.retrySeconds);
      state.maxAttempts = clampNumber(settings.maxAttempts, 1, 10, state.maxAttempts);
      persist();
      schedule();
      safeRender();
    },
    dispose
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
    state.bootstrapTimer = setTimeout(start, 1000);
  } else {
    start();
  }
})();
