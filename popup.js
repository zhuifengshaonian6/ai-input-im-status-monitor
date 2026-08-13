const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  hero: document.getElementById("hero"),
  statusPill: document.getElementById("statusPill"),
  modelName: document.getElementById("modelName"),
  statusLine: document.getElementById("statusLine"),
  ringValue: document.getElementById("ringValue"),
  ring: document.querySelector(".ring"),
  okToday: document.getElementById("okToday"),
  badToday: document.getElementById("badToday"),
  badCount: document.getElementById("badCount"),
  lastCheck: document.getElementById("lastCheck"),
  bars: document.getElementById("bars"),
  sourceStatus: document.getElementById("sourceStatus"),
  statusDuration: document.getElementById("statusDuration"),
  latency: document.getElementById("latency"),
  selectionMode: document.getElementById("selectionMode"),
  sourceDuration: document.getElementById("sourceDuration"),
  errorText: document.getElementById("errorText"),
  services: document.getElementById("services"),
  servicesCount: document.getElementById("servicesCount"),
  currentVersion: document.getElementById("currentVersion"),
  updateStatus: document.getElementById("updateStatus"),
  checkUpdateBtn: document.getElementById("checkUpdateBtn"),
  downloadUpdateLink: document.getElementById("downloadUpdateLink"),
  optionsBtn: document.getElementById("optionsBtn")
};

const UPDATE_API_URL = "https://api.github.com/repos/zhuifengshaonian6/ai-input-im-status-monitor/releases/latest";
const UPDATE_DOWNLOAD_URL = "https://github.com/zhuifengshaonian6/ai-input-im-status-monitor/releases/latest/download/ai-input-im-status-monitor-extension.zip";

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function compareVersions(left, right) {
  const parse = (value) => String(value || "").replace(/^v/i, "").split(".").map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function checkForUpdate() {
  const currentVersion = chrome.runtime.getManifest().version;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(UPDATE_API_URL, {
      cache: "no-store",
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const release = await response.json();
    const latestVersion = String(release.tag_name || "").replace(/^v/i, "");
    if (!latestVersion) throw new Error("GitHub Release 未返回版本号");
    return {
      currentVersion,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
      releaseUrl: release.html_url,
      downloadUrl: UPDATE_DOWNLOAD_URL,
      checkedAt: Date.now(),
      error: null
    };
  } finally {
    clearTimeout(timeout);
  }
}
function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function fmtTime(ts) {
  if (!ts) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(ts * 1000));
}

function secondsToChinese(seconds) {
  const total = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (hours && minutes) return `${hours} 小时 ${minutes} 分钟`;
  if (hours) return `${hours} 小时`;
  if (minutes && sec && minutes < 10) return `${(total / 60).toFixed(1)} 分钟`;
  if (minutes) return `${minutes} 分钟`;
  return `${sec} 秒`;
}

function dayKey(ts) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ts * 1000));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function todayStats(modelState, state) {
  const today = dayKey(nowTs());
  const stats = { ...(modelState.daily?.[today] || { okSeconds: 0, badSeconds: 0, badCount: 0 }) };
  if (modelState.lastOk !== null && modelState.lastProcessedTs) {
    const effectiveNow = state.sourceOnline === false && state.sourceDownSinceTs
      ? state.sourceDownSinceTs
      : nowTs();
    const key = modelState.lastOk ? "okSeconds" : "badSeconds";
    stats[key] += Math.max(0, effectiveNow - modelState.lastProcessedTs);
  }
  return stats;
}

function setLoading(loading) {
  document.body.classList.toggle("is-loading", loading);
  els.refreshBtn.disabled = loading;
}

function barTitle(sample) {
  if (!sample) return "";
  const status = sample.ok ? "正常" : "异常";
  const latency = sample.latencyMs ? `，${sample.latencyMs}ms` : "";
  const error = sample.error ? `\n${sample.error}` : "";
  return `${fmtTime(sample.ts)} ${status}${latency}${error}`;
}

function renderBars(history = []) {
  const pad = Math.max(0, 60 - history.length);
  const all = Array.from({ length: pad }, () => null).concat(history.slice(-60));
  els.bars.textContent = "";
  for (const sample of all) {
    const item = document.createElement("span");
    item.className = sample ? `bar ${sample.ok ? "ok" : "bad"}` : "bar";
    item.title = barTitle(sample);
    els.bars.append(item);
  }
}

function renderServices(snapshot, activeModel, priority = []) {
  els.services.textContent = "";
  const returned = new Map((snapshot?.services || []).map((service) => [service.model, service]));
  const orderedModels = [...new Set([
    ...priority,
    ...(snapshot?.services || []).map((service) => service.model)
  ])];
  const services = orderedModels.map((model) => returned.get(model) || {
    model,
    uptimePct: 0,
    last: null,
    unavailable: true
  });
  const availableCount = services.filter((service) => !service.unavailable).length;
  els.servicesCount.textContent = `${availableCount}/${services.length}`;

  for (const service of services) {
    const row = document.createElement("div");
    row.className = "service-row";
    const main = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = service.model;
    const meta = document.createElement("span");
    const latency = service.last?.latencyMs ? `${service.last.latencyMs}ms` : "--";
    const priorityIndex = priority.indexOf(service.model);
    const priorityText = priorityIndex >= 0 ? ` · 优先级 ${priorityIndex + 1}` : "";
    const availabilityText = service.unavailable
      ? "状态源未返回"
      : `${service.uptimePct.toFixed(2)}% uptime · ${latency}`;
    meta.textContent = `${availabilityText}${priorityText}`;
    main.append(name, meta);

    const dot = document.createElement("i");
    dot.className = `dot ${service.unavailable ? "unknown" : service.last?.ok ? "" : "bad"}`;
    dot.title = service.unavailable ? "状态源未返回" : service.last?.ok ? "正常" : "异常";
    if (service.model === activeModel) row.style.borderColor = "rgba(102, 217, 232, 0.45)";
    row.append(main, dot);
    els.services.append(row);
  }
}

function renderUpdate(updateState = {}) {
  els.currentVersion.textContent = `v${updateState.currentVersion || chrome.runtime.getManifest().version}`;
  els.downloadUpdateLink.hidden = !updateState.updateAvailable;
  if (updateState.downloadUrl) els.downloadUpdateLink.href = updateState.downloadUrl;
  els.updateStatus.textContent = updateState.error
    ? `检查失败：${updateState.error}`
    : updateState.updateAvailable
      ? `发现 v${updateState.latestVersion}`
      : updateState.checkedAt
        ? "已是最新版本"
        : "尚未检查更新";
}
if (globalThis.__STATUS_POPUP_TEST__) {
  globalThis.__statusPopupTestHooks = { renderServices, renderUpdate };
}


async function render() {
  const data = await send("getDashboard");
  if (!data?.ok) return;

  const { config, state, snapshot, updateState } = data;
  renderUpdate(updateState);
  const activeModel = state.activeModel || config.monitorModel || config.modelPriority?.[0];
  const modelState = state.models?.[activeModel] || {
    lastOk: null,
    statusSinceTs: null,
    lastProcessedTs: null,
    daily: {},
    history: []
  };
  const service = snapshot?.services?.find((item) => item.model === activeModel);
  const isOk = modelState.lastOk;
  const stats = todayStats(modelState, state);
  const uptime = service?.uptimePct ?? 0;

  const sourceOffline = state.sourceOnline === false;
  els.hero.className = `hero ${sourceOffline ? "warn" : isOk === false ? "bad" : isOk === null ? "warn" : ""}`;
  els.statusPill.textContent = sourceOffline
    ? "接口中断"
    : isOk === null
      ? "等待样本"
      : isOk
        ? "运行正常"
        : "发生异常";
  els.modelName.textContent = activeModel || "等待选择";
  els.statusLine.textContent = state.lastError
    ? `状态源暂时不可用，后台会继续重试：${state.lastError}`
    : snapshot?.allOk
      ? "已按优先级选择可用模型，后台持续监听。"
      : "部分模型异常，已按顺序选择当前可用项。";
  els.ring.style.setProperty("--ring", `${Math.max(0, Math.min(100, uptime))}%`);
  els.ringValue.textContent = service ? `${uptime.toFixed(0)}%` : "--";
  els.okToday.textContent = secondsToChinese(stats.okSeconds);
  els.badToday.textContent = secondsToChinese(stats.badSeconds);
  els.badCount.textContent = `${stats.badCount} 次`;
  els.lastCheck.textContent = `更新 ${fmtTime(state.lastFetchTs || snapshot?.generatedAt)}`;
  els.sourceStatus.textContent = state.lastError
    ? "读取失败"
    : state.sourceOnline === true
      ? "读取正常"
      : "等待数据";
  const statusNow = state.sourceOnline === false && state.sourceDownSinceTs ? state.sourceDownSinceTs : nowTs();
  els.statusDuration.textContent = modelState.statusSinceTs
    ? secondsToChinese(statusNow - modelState.statusSinceTs)
    : "--";
  els.latency.textContent = service?.last?.latencyMs ? `${service.last.latencyMs} ms` : "--";
  els.selectionMode.textContent = Number.isInteger(state.activePriorityIndex) && state.activePriorityIndex >= 0
    ? `优先级 ${state.activePriorityIndex + 1}`
    : "接口回退项";
  els.sourceDuration.textContent = state.sourceOnline === false && state.sourceDownSinceTs
    ? `中断 ${secondsToChinese(nowTs() - state.sourceDownSinceTs)}`
    : state.sourceRecoveredAtTs
      ? `已恢复 ${fmtTime(state.sourceRecoveredAtTs)}`
      : "在线";
  els.errorText.textContent = service?.last?.error || "无";

  renderBars(service?.history || modelState.history || []);
  renderServices(snapshot, activeModel, config.modelPriority || []);
}

els.refreshBtn.addEventListener("click", async () => {
  setLoading(true);
  await send("refresh");
  await render();
  setLoading(false);
});

els.optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

els.checkUpdateBtn.addEventListener("click", async () => {
  els.checkUpdateBtn.disabled = true;
  els.updateStatus.textContent = "正在检查...";
  try {
    renderUpdate(await checkForUpdate());
  } catch (error) {
    renderUpdate({
      currentVersion: chrome.runtime.getManifest().version,
      updateAvailable: false,
      error: error?.name === "AbortError" ? "版本检查超时" : String(error?.message || error)
    });
  } finally {
    els.checkUpdateBtn.disabled = false;
  }
});

render();
