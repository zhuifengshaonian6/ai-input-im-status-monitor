const DEFAULT_CONFIG = {
  sourceUrl: "https://status.input.im/api/status",
  monitorModel: "gpt-5.6-sol",
  modelPriority: [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini"
  ],
  intervalMinutes: 1,
  timezone: "Asia/Shanghai",
  notificationsEnabled: true
};

const STORAGE_KEYS = {
  config: "config",
  state: "state",
  snapshot: "snapshot"
};

async function storageGet(keys) {
  return await chrome.storage.local.get(keys);
}

async function storageSet(items) {
  await chrome.storage.local.set(items);
}

async function getConfig() {
  const stored = await storageGet(STORAGE_KEYS.config);
  const savedConfig = stored[STORAGE_KEYS.config] || {};
  const config = { ...DEFAULT_CONFIG, ...savedConfig };
  config.modelPriority = normalizeModelPriority({
    modelPriority: Array.isArray(savedConfig.modelPriority) ? savedConfig.modelPriority : [],
    monitorModel: savedConfig.monitorModel || config.monitorModel
  });
  config.monitorModel = config.modelPriority[0];
  return config;
}

async function getState() {
  const stored = await storageGet(STORAGE_KEYS.state);
  return {
    models: {},
    lastError: null,
    sourceOnline: null,
    sourceDownSinceTs: null,
    sourceRecoveredAtTs: null,
    activeModel: null,
    activeModelSinceTs: null,
    selectionReason: null,
    ...(stored[STORAGE_KEYS.state] || {}),
    version: 2
  };
}

function normalizeModelPriority(config) {
  const configured = Array.isArray(config.modelPriority)
    ? config.modelPriority.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (configured.length) return [...new Set(configured)];

  const candidates = [config.monitorModel, ...DEFAULT_CONFIG.modelPriority];
  return [...new Set(candidates.map((item) => String(item || "").trim()).filter(Boolean))];
}

function selectService(services, priority) {
  const validServices = (services || []).filter((service) => service?.model);
  if (!validServices.length) return null;

  const byModel = new Map(validServices.map((service) => [service.model, service]));
  for (let index = 0; index < priority.length; index += 1) {
    const service = byModel.get(priority[index]);
    if (service?.last?.ok === true) {
      return { service, priorityIndex: index, reason: "priority-ok" };
    }
  }

  for (let index = 0; index < priority.length; index += 1) {
    const service = byModel.get(priority[index]);
    if (service) return { service, priorityIndex: index, reason: "priority-present" };
  }

  const available = validServices.find((service) => service.last?.ok === true);
  return {
    service: available || validServices[0],
    priorityIndex: -1,
    reason: available ? "unlisted-ok" : "first-present"
  };
}

function ensureModelState(state, model) {
  state.models ||= {};
  state.models[model] ||= {
    lastOk: null,
    statusSinceTs: null,
    lastProcessedTs: null,
    daily: {},
    history: []
  };
  return state.models[model];
}

function localParts(ts, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date(ts * 1000));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function dayKey(ts, timeZone) {
  const p = localParts(ts, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function fmtDateTime(ts, timeZone) {
  const p = localParts(ts, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function startOfNextBeijingDay(ts) {
  const local = new Date((ts + 8 * 3600) * 1000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  return Date.UTC(y, m, d + 1, -8, 0, 0) / 1000;
}

function bucketFor(modelState, day) {
  modelState.daily ||= {};
  modelState.daily[day] ||= { okSeconds: 0, badSeconds: 0, badCount: 0 };
  return modelState.daily[day];
}

function addDuration(modelState, startTs, endTs, ok, timeZone) {
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return;
  let cursor = startTs;
  while (cursor < endTs) {
    const day = dayKey(cursor, timeZone);
    const boundary = Math.min(endTs, startOfNextBeijingDay(cursor));
    const bucket = bucketFor(modelState, day);
    if (ok) bucket.okSeconds += Math.round(boundary - cursor);
    else bucket.badSeconds += Math.round(boundary - cursor);
    cursor = boundary;
  }
}

function incrementBadCount(modelState, ts, timeZone) {
  const bucket = bucketFor(modelState, dayKey(ts, timeZone));
  bucket.badCount += 1;
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

function todayStats(modelState, nowTs, timeZone) {
  const day = dayKey(nowTs, timeZone);
  const saved = modelState.daily?.[day] || { okSeconds: 0, badSeconds: 0, badCount: 0 };
  const stats = { ...saved };
  if (modelState.lastOk !== null && modelState.lastProcessedTs && nowTs > modelState.lastProcessedTs) {
    const key = modelState.lastOk ? "okSeconds" : "badSeconds";
    stats[key] += nowTs - modelState.lastProcessedTs;
  }
  return stats;
}

function changeMessage(model, previousOk, sample, previousSinceTs, modelState, timeZone) {
  const nowTs = sample.ts;
  const stats = todayStats(modelState, nowTs, timeZone);
  const title = sample.ok ? "✅ 模型状态变更：恢复正常" : "❌ 模型状态变更：发生异常";
  const durationLabel = sample.ok ? "⏱️ 异常持续时间" : "⏱️ 正常运行时间";
  return [
    title,
    `${durationLabel}：${secondsToChinese(nowTs - previousSinceTs)}`,
    `监控模型：${model}`,
    `确认时间：${fmtDateTime(nowTs, timeZone)}`,
    "",
    `📊 今日统计（${dayKey(nowTs, timeZone)}，北京时间）`,
    `✅ 今日运行时间：${secondsToChinese(stats.okSeconds)}`,
    `❌ 今日异常时间：${secondsToChinese(stats.badSeconds)}`,
    `🔢 今日异常次数：${stats.badCount} 次`
  ].join("\n");
}

function samplesFromService(service) {
  const byTs = new Map();
  for (const row of service.history || []) {
    if (row.ts == null || row.ok == null) continue;
    byTs.set(Number(row.ts), {
      ts: Number(row.ts),
      ok: Boolean(row.ok),
      latencyMs: row.latency_ms ?? null,
      error: row.error ?? null
    });
  }
  if (service.last?.ts != null && service.last?.ok != null) {
    byTs.set(Number(service.last.ts), {
      ts: Number(service.last.ts),
      ok: Boolean(service.last.ok),
      latencyMs: service.last.latency_ms ?? null,
      error: service.last.error ?? null
    });
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function appendHistory(modelState, sample) {
  modelState.history ||= [];
  modelState.history.push(sample);
  if (modelState.history.length > 5000) {
    modelState.history.splice(0, modelState.history.length - 5000);
  }
}

function processSample(config, model, modelState, sample, emitMessages) {
  if (modelState.lastProcessedTs && sample.ts <= modelState.lastProcessedTs) return null;

  const previousOk = modelState.lastOk;
  const previousSinceTs = modelState.statusSinceTs ?? sample.ts;

  if (previousOk === null) {
    modelState.lastOk = sample.ok;
    modelState.statusSinceTs = sample.ts;
    modelState.lastProcessedTs = sample.ts;
    appendHistory(modelState, sample);
    return null;
  }

  addDuration(
    modelState,
    modelState.lastProcessedTs ?? previousSinceTs,
    sample.ts,
    previousOk,
    config.timezone
  );
  modelState.lastProcessedTs = sample.ts;

  let message = null;
  if (previousOk !== sample.ok) {
    if (!sample.ok) incrementBadCount(modelState, sample.ts, config.timezone);
    if (emitMessages) {
      message = changeMessage(
        model,
        previousOk,
        sample,
        previousSinceTs,
        modelState,
        config.timezone
      );
    }
    modelState.lastOk = sample.ok;
    modelState.statusSinceTs = sample.ts;
  }

  appendHistory(modelState, sample);
  return message;
}

function modelSwitchMessage(previousModel, nextModel, selection, timeZone) {
  const nowTs = Math.floor(Date.now() / 1000);
  const reason = selection.reason === "priority-ok"
    ? `已按优先级选择第 ${selection.priorityIndex + 1} 个正常模型`
    : selection.reason === "priority-present"
      ? "优先列表中的模型均异常，继续跟踪最高优先级可见模型"
      : "优先列表未匹配，已选择接口返回的可用模型";
  return [
    "🔀 监控模型已切换",
    `原模型：${previousModel || "未选择"}`,
    `当前模型：${nextModel}`,
    `切换原因：${reason}`,
    `确认时间：${fmtDateTime(nowTs, timeZone)}`
  ].join("\n");
}

function sourceRecoveryMessage(state, nowTs, timeZone) {
  const duration = state.sourceDownSinceTs ? nowTs - state.sourceDownSinceTs : 0;
  return [
    "✅ 状态接口已恢复",
    `中断时间：${secondsToChinese(duration)}`,
    `恢复时间：${fmtDateTime(nowTs, timeZone)}`,
    "监控任务已自动继续运行。"
  ].join("\n");
}

function compactSnapshot(data) {
  return {
    allOk: Boolean(data.all_ok),
    generatedAt: Number(data.generated_at || Math.floor(Date.now() / 1000)),
    services: (data.services || []).map((service) => ({
      model: service.model,
      uptimePct: Number(service.uptime_pct || 0),
      last: service.last
        ? {
            ts: Number(service.last.ts),
            ok: Boolean(service.last.ok),
            latencyMs: service.last.latency_ms ?? null,
            error: service.last.error ?? null
          }
        : null,
      history: samplesFromService(service).slice(-60)
    }))
  };
}

async function notify(message, ok) {
  const title = ok ? "AI.INPUT.IM 已恢复" : "AI.INPUT.IM 发生异常";
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: ok ? 0 : 2
  });
}

async function notifyInfo(title, message) {
  await chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority: 1
  });
}

async function fetchAndProcess({ emitMessages = true } = {}) {
  const config = await getConfig();
  const state = await getState();

  try {
    const res = await fetch(config.sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const selection = selectService(data.services, config.modelPriority);
    if (!selection) throw new Error("状态接口未返回任何模型");

    const nowTs = Math.floor(Date.now() / 1000);
    const recovered = state.sourceOnline === false;
    const previousModel = state.activeModel;
    const activeModel = selection.service.model;
    const modelChanged = previousModel !== activeModel;

    if (modelChanged) {
      state.activeModel = activeModel;
      state.activeModelSinceTs = nowTs;
    }
    state.selectionReason = selection.reason;
    state.activePriorityIndex = selection.priorityIndex;

    const modelState = ensureModelState(state, activeModel);
    const firstRun = modelState.lastProcessedTs == null;
    const messages = [];
    for (const sample of samplesFromService(selection.service)) {
      const message = processSample(
        config,
        activeModel,
        modelState,
        sample,
        emitMessages && !firstRun && !modelChanged
      );
      if (message) messages.push({ message, ok: sample.ok });
    }

    state.lastError = null;
    state.lastFetchTs = nowTs;
    state.lastSuccessTs = nowTs;
    state.sourceOnline = true;
    if (recovered) state.sourceRecoveredAtTs = nowTs;
    await storageSet({
      [STORAGE_KEYS.state]: state,
      [STORAGE_KEYS.snapshot]: compactSnapshot(data)
    });

    if (config.notificationsEnabled) {
      try {
        for (const item of messages) {
          await notify(item.message, item.ok);
        }
        if (recovered && emitMessages) {
          await notifyInfo("AI.INPUT.IM 接口恢复", sourceRecoveryMessage(state, nowTs, config.timezone));
        }
        if (modelChanged && previousModel && emitMessages) {
          await notifyInfo(
            "AI.INPUT.IM 自动切换模型",
            modelSwitchMessage(previousModel, activeModel, selection, config.timezone)
          );
        }
      } catch (notificationError) {
        state.lastNotificationError = String(notificationError?.message || notificationError);
      }
    }
    if (recovered) state.sourceDownSinceTs = null;
    await storageSet({ [STORAGE_KEYS.state]: state });
    return {
      ok: true,
      activeModel,
      recovered,
      modelChanged,
      messages: messages.map((item) => item.message)
    };
  } catch (error) {
    const nowTs = Math.floor(Date.now() / 1000);
    state.lastError = String(error?.message || error);
    state.lastFetchTs = nowTs;
    if (state.sourceOnline !== false) state.sourceDownSinceTs = nowTs;
    state.sourceOnline = false;
    await storageSet({ [STORAGE_KEYS.state]: state });
    return { ok: false, error: state.lastError };
  }
}

async function scheduleAlarm() {
  const config = await getConfig();
  await chrome.alarms.clear("status-poll");
  await chrome.alarms.create("status-poll", {
    periodInMinutes: Math.max(1, Number(config.intervalMinutes || 1))
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await storageGet(STORAGE_KEYS.config);
  if (!existing[STORAGE_KEYS.config]) {
    await storageSet({ [STORAGE_KEYS.config]: DEFAULT_CONFIG });
  }
  await scheduleAlarm();
  await fetchAndProcess({ emitMessages: false });
});

chrome.runtime.onStartup.addListener(async () => {
  await scheduleAlarm();
  await fetchAndProcess({ emitMessages: false });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "status-poll") fetchAndProcess();
});

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  (async () => {
    if (request?.type === "refresh") {
      sendResponse(await fetchAndProcess({ emitMessages: true }));
      return;
    }
    if (request?.type === "getDashboard") {
      const config = await getConfig();
      const state = await getState();
      const stored = await storageGet(STORAGE_KEYS.snapshot);
      sendResponse({ ok: true, config, state, snapshot: stored[STORAGE_KEYS.snapshot] || null });
      return;
    }
    if (request?.type === "saveConfig") {
      const nextConfig = { ...DEFAULT_CONFIG, ...(request.config || {}) };
      nextConfig.modelPriority = normalizeModelPriority(nextConfig);
      nextConfig.monitorModel = nextConfig.modelPriority[0];
      await storageSet({ [STORAGE_KEYS.config]: nextConfig });
      await scheduleAlarm();
      await fetchAndProcess({ emitMessages: false });
      sendResponse({ ok: true, config: nextConfig });
      return;
    }
    sendResponse({ ok: false, error: "unknown message" });
  })();
  return true;
});
