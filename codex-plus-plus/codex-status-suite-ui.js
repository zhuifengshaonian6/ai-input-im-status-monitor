(() => {
  "use strict";

  const API_KEY = "__codexStatusSuite";
  const ROOT_ID = "codex-status-suite";
  const STYLE_ID = "codex-status-suite-style";
  const STORAGE_KEY = "codexStatusSuite.v1";
  const AUTO_ID = "input-status-auto-switch";
  const RECOVERY_ID = "codex-task-recovery";

  window[API_KEY]?.dispose?.();

  function readSaved() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  const saved = readSaved();
  const state = {
    collapsed: saved.collapsed !== false,
    activeTab: saved.activeTab === "recovery" ? "recovery" : "models",
    timer: null
  };

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        collapsed: state.collapsed,
        activeTab: state.activeTab
      }));
    } catch {
      // Continue when host storage is unavailable.
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;right:16px;bottom:16px;z-index:2147482100;width:min(348px,calc(100vw - 32px));font:12px ui-sans-serif,system-ui,sans-serif;color:#f1f4f8}
      #${ROOT_ID} *{box-sizing:border-box}
      #${ROOT_ID}[data-collapsed=true]{width:40px;height:40px}
      #${ROOT_ID} .css-shell{border:1px solid rgba(255,255,255,.14);border-radius:8px;background:#171a21;box-shadow:0 16px 40px rgba(0,0,0,.35);overflow:hidden}
      #${ROOT_ID} .css-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.09)}
      #${ROOT_ID} .css-brand{display:flex;align-items:center;gap:8px;font-weight:800}
      #${ROOT_ID} .css-brand::before{content:"";width:9px;height:9px;border-radius:50%;background:#35d07f;box-shadow:0 0 0 3px rgba(53,208,127,.16)}
      #${ROOT_ID} .css-actions{display:flex;align-items:center;gap:6px}
      #${ROOT_ID} button{min-height:28px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:#1e232c;color:#f1f4f8;padding:0 9px;cursor:pointer}
      #${ROOT_ID} button:hover{background:#292f3a}
      #${ROOT_ID} .css-icon{display:grid;place-items:center;width:28px;padding:0;font-size:15px}
      #${ROOT_ID} .css-tabs{display:grid;grid-template-columns:1fr 1fr;padding:6px;background:#11151b;border-bottom:1px solid rgba(255,255,255,.09)}
      #${ROOT_ID} .css-tab{border:0;background:transparent;color:#9aa4b2;font-size:11px}
      #${ROOT_ID} .css-tab[data-active=true]{background:#242a33;color:#f1f4f8}
      #${ROOT_ID} .css-pane{display:none}
      #${ROOT_ID} .css-pane[data-active=true]{display:block}
      #${ROOT_ID} .css-launcher{display:none;width:40px;height:40px;padding:0;border-color:rgba(53,208,127,.55);background:#171a21;box-shadow:0 8px 22px rgba(0,0,0,.3)}
      #${ROOT_ID} .css-launcher::before{content:"";width:10px;height:10px;border-radius:50%;background:#35d07f;box-shadow:0 0 0 3px rgba(53,208,127,.16)}
      #${ROOT_ID}[data-collapsed=true] .css-shell{display:none}
      #${ROOT_ID}[data-collapsed=true] .css-launcher{display:grid;place-items:center}
      #${ROOT_ID} #${AUTO_ID},#${ROOT_ID} #${RECOVERY_ID}{position:static!important;right:auto!important;bottom:auto!important;width:auto!important;height:auto!important;font:inherit!important}
      #${ROOT_ID} #${AUTO_ID} .isw-panel,#${ROOT_ID} #${RECOVERY_ID} .tr-panel{display:block!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}
      #${ROOT_ID} #${AUTO_ID} .isw-head,#${ROOT_ID} #${RECOVERY_ID} .tr-head{display:none!important}
      #${ROOT_ID} #${AUTO_ID} .isw-launcher,#${ROOT_ID} #${RECOVERY_ID} .tr-launcher{display:none!important}
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    ensureStyle();
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    root = document.createElement("aside");
    root.id = ROOT_ID;
    root.innerHTML = `
      <section class="css-shell">
        <header class="css-head">
          <span class="css-brand">AI.INPUT.IM</span>
          <div class="css-actions">
            <button type="button" class="css-icon" data-suite-settings title="Settings" aria-label="Settings">&#9881;</button>
            <button type="button" class="css-icon" data-suite-collapse title="Collapse" aria-label="Collapse">&#8722;</button>
          </div>
        </header>
        <nav class="css-tabs" aria-label="Status suite views">
          <button type="button" class="css-tab" data-suite-tab="models">Model status</button>
          <button type="button" class="css-tab" data-suite-tab="recovery">Task recovery</button>
        </nav>
        <div class="css-pane" data-suite-pane="models"></div>
        <div class="css-pane" data-suite-pane="recovery"></div>
      </section>
      <button type="button" class="css-launcher" data-suite-expand title="AI.INPUT.IM status suite" aria-label="Open AI.INPUT.IM status suite"></button>
    `;
    root.querySelector("[data-suite-collapse]").addEventListener("click", () => {
      state.collapsed = true;
      persist();
      render();
    });
    root.querySelector("[data-suite-expand]").addEventListener("click", () => {
      state.collapsed = false;
      persist();
      render();
    });
    root.querySelectorAll("[data-suite-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.suiteTab;
        persist();
        render();
      });
    });
    root.querySelector("[data-suite-settings]").addEventListener("click", () => {
      const moduleId = state.activeTab === "models" ? AUTO_ID : RECOVERY_ID;
      document.getElementById(moduleId)?.querySelector("[data-settings-toggle]")?.click();
    });
    document.body.appendChild(root);
    return root;
  }

  function adoptModules() {
    const root = ensureRoot();
    const autoRoot = document.getElementById(AUTO_ID);
    const recoveryRoot = document.getElementById(RECOVERY_ID);
    const autoPane = root.querySelector('[data-suite-pane="models"]');
    const recoveryPane = root.querySelector('[data-suite-pane="recovery"]');
    if (autoRoot && autoRoot.parentElement !== autoPane) autoPane.appendChild(autoRoot);
    if (recoveryRoot && recoveryRoot.parentElement !== recoveryPane) recoveryPane.appendChild(recoveryRoot);
    return Boolean(autoRoot && recoveryRoot);
  }

  function render() {
    const root = ensureRoot();
    root.dataset.collapsed = String(state.collapsed);
    root.querySelectorAll("[data-suite-tab]").forEach((button) => {
      button.dataset.active = String(button.dataset.suiteTab === state.activeTab);
    });
    root.querySelectorAll("[data-suite-pane]").forEach((pane) => {
      pane.dataset.active = String(pane.dataset.suitePane === state.activeTab);
    });
  }

  function start() {
    adoptModules();
    render();
    state.timer = setInterval(() => {
      if (adoptModules()) {
        clearInterval(state.timer);
        state.timer = null;
      }
    }, 250);
  }

  function dispose() {
    if (state.timer) clearInterval(state.timer);
    const root = document.getElementById(ROOT_ID);
    const autoRoot = document.getElementById(AUTO_ID);
    const recoveryRoot = document.getElementById(RECOVERY_ID);
    if (autoRoot) document.body.appendChild(autoRoot);
    if (recoveryRoot) document.body.appendChild(recoveryRoot);
    root?.remove();
    document.getElementById(STYLE_ID)?.remove();
    if (window[API_KEY]?.version === "0.5.0") delete window[API_KEY];
  }

  window[API_KEY] = {
    version: "0.5.0",
    getState: () => ({ ...state, timer: undefined }),
    selectTab(tab) {
      state.activeTab = tab === "recovery" ? "recovery" : "models";
      state.collapsed = false;
      persist();
      render();
    },
    dispose
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
