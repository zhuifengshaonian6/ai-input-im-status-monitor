const form = document.getElementById("form");
const sourceUrl = document.getElementById("sourceUrl");
const modelPriority = document.getElementById("modelPriority");
const intervalMinutes = document.getElementById("intervalMinutes");
const notificationsEnabled = document.getElementById("notificationsEnabled");
const result = document.getElementById("result");

function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function load() {
  const data = await send("getDashboard");
  const config = data.config;
  sourceUrl.value = config.sourceUrl;
  modelPriority.value = (config.modelPriority || [config.monitorModel]).join("\n");
  intervalMinutes.value = config.intervalMinutes;
  notificationsEnabled.checked = Boolean(config.notificationsEnabled);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.textContent = "正在保存...";
  const config = {
    sourceUrl: sourceUrl.value.trim(),
    modelPriority: modelPriority.value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    intervalMinutes: Number(intervalMinutes.value),
    timezone: "Asia/Shanghai",
    notificationsEnabled: notificationsEnabled.checked
  };
  if (!config.modelPriority.length) {
    result.textContent = "请至少填写一个模型。";
    return;
  }
  config.monitorModel = config.modelPriority[0];
  const saved = await send("saveConfig", { config });
  result.textContent = saved.ok ? "已保存，并立即刷新了一次状态。" : `保存失败：${saved.error}`;
});

load();
