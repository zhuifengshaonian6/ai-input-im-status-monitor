/*
@codex-plus-script
name: Codex Task Recovery
description: Preserve task checkpoints and safely resume the current Codex task after network or upstream interruptions.
version: 0.3.0
author: AI.INPUT.IM Status Monitor
*/

(() => {
  "use strict";

  const API_KEY = "__codexTaskRecovery";
  const STYLE_ID = "codex-task-recovery-style";
  const ROOT_ID = "codex-task-recovery";
  const STORAGE_KEY = "codexTaskRecovery.v1";
  const POLL_MS = 5000;
  const CHECKPOINT_MS = 30_000;
  const RETRY_COOLDOWN_MS = 12_000;
  const MAX_AUTO_ATTEMPTS = 3;
  const ERROR_RE = /failed to fetch|network|offline|connection|timed out|timeout|upstream|temporarily unavailable|service unavailable|中断|网络|连接|超时|上游|不可用|失败|重试/i;
  const RESUME_RE = /^(retry|try again|retry response|regenerate|continue|resume|重新生成|重试|继续|恢复|再试一次)$/i;
  const RESUME_HINT_RE = /retry|try again|regenerate|continue|resume|重新生成|重试|继续|恢复|再试一次/i;

  function readSavedState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
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
      const genericContinue = /^(continue|resume|继续|恢复)$/i.test(label);
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

  function checkpoint(documentRef = document) {
    const url = location.href;
    const threadKey = new URL(url).searchParams.get("threadId")
      || new URL(url).searchParams.get("conversationId")
      || url;
    const messages = [...documentRef.querySelectorAll(
      "[data-message-author='user'],[data-role='user'],[role='article']"
    )].map((node) => cleanText(node.innerText || node.textContent)).filter(Boolean);
    return {
      threadKey,
      url,
      lastUserMessage: messages.at(-1)?.slice(0, 2000) || null,
      savedAt: Date.now()
    };
  }

  if (globalThis.__CODEX_TASK_RECOVERY_TEST__) {
    globalThis.__codexTaskRecoveryTestHooks = {
      checkpoint,
      findResumeButton,
      hasRecoverySignal
    };
    return;
  }

  window[API_KEY]?.dispose?.();
  const saved = readSavedState();
  const state = {
    enabled: saved.enabled !== false,
    collapsed: saved.collapsed !== false,
    phase: "watching",
    attempts: 0,
    lastAttemptAt: 0,
    lastError: null,
    checkpoint: null,
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
    if (state.lastCheckpointAt && now - state.lastCheckpointAt < CHECKPOINT_MS) return false;
    state.lastCheckpointAt = now;
    const next = checkpoint(document);
    const previous = state.checkpoint;
    if (previous
      && previous.threadKey === next.threadKey
      && previous.url === next.url
      && previous.lastUserMessage === next.lastUserMessage) return false;
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
        #${ROOT_ID} .tr-title{font-weight:800}
        #${ROOT_ID} .tr-state{color:#66d9e8;font-size:11px}
        #${ROOT_ID} .tr-body{display:grid;gap:5px;padding:10px 11px;color:#9aa4b2;line-height:1.4}
        #${ROOT_ID} .tr-body strong{color:#f1f4f8;font-family:ui-monospace,Consolas,monospace;overflow-wrap:anywhere}
        #${ROOT_ID} button{min-height:30px;border:1px solid rgba(255,255,255,.14);border-radius:7px;background:#1e232c;color:#f1f4f8;padding:0 10px;cursor:pointer}
        #${ROOT_ID} button:hover{background:#292f3a}
        #${ROOT_ID} button[data-primary=true]{border-color:rgba(102,217,232,.6);color:#66d9e8}
        #${ROOT_ID} .tr-collapse{display:grid;place-items:center;width:28px;min-height:28px;padding:0;font-size:16px}
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
          <div class="tr-head"><span class="tr-title">Task Recovery</span><span class="tr-state"></span><button class="tr-collapse" data-collapse aria-label="Collapse" title="Collapse">&#8722;</button></div>
          <div class="tr-body">
            <span>Checkpoint <strong data-checkpoint>--</strong></span>
            <span data-message>Watching the current task</span>
          </div>
          <div class="tr-actions">
            <button data-toggle data-primary="true"></button>
            <button data-resume>Resume current task</button>
          </div>
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
    if (state.enabled && navigator.onLine && Date.now() - state.lastAttemptAt >= RETRY_COOLDOWN_MS) {
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
    if (!manual && state.attempts >= MAX_AUTO_ATTEMPTS) {
      state.phase = "attention";
      safeRender("Automatic attempts paused after 3 tries; click Resume to continue");
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
    if (window[API_KEY]?.version === "0.3.0") delete window[API_KEY];
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
    state.timer = setInterval(inspect, POLL_MS);
    safeRender();
    inspect();
  }

  window[API_KEY] = {
    version: "0.3.0",
    getState: () => ({ ...state, timer: undefined }),
    saveCheckpoint,
    resume: () => resume(true),
    setEnabled(enabled) {
      state.enabled = Boolean(enabled);
      persist();
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
