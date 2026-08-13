const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("background.js", "utf8");
const listener = { addListener() {} };
const context = {
  AbortController,
  clearTimeout,
  chrome: {
    alarms: {
      clear: async () => {},
      create: async () => {},
      onAlarm: listener
    },
    notifications: { create: async () => {} },
    runtime: {
      getManifest: () => ({ version: "1.4.0" }),
      onInstalled: listener,
      onStartup: listener,
      onMessage: listener
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {}
      }
    }
  },
  console,
  Date,
  Intl,
  Map,
  Math,
  Number,
  Set
  ,setTimeout
};

vm.createContext(context);
vm.runInContext(
  `${source}\n;globalThis.testHooks = { selectService, processSample, validateStatusData, compareVersions };`,
  context
);

const { selectService, processSample, validateStatusData, compareVersions } = context.testHooks;
const priority = ["sol", "terra", "luna"];

assert.ok(compareVersions("1.4.0", "1.3.0") > 0);
assert.equal(compareVersions("v1.4.0", "1.4.0"), 0);
assert.ok(compareVersions("1.3.9", "1.4.0") < 0);

assert.equal(
  selectService([
    { model: "sol", last: { ok: false } },
    { model: "terra", last: { ok: true } },
    { model: "luna", last: { ok: true } }
  ], priority).service.model,
  "terra",
  "selects the first healthy model in priority order"
);

assert.equal(
  selectService([
    { model: "terra", last: { ok: false } },
    { model: "luna", last: { ok: false } }
  ], priority).service.model,
  "terra",
  "tracks the highest-priority visible model when all are unhealthy"
);

const config = { timezone: "Asia/Shanghai" };
const modelState = {
  lastOk: null,
  statusSinceTs: null,
  lastProcessedTs: null,
  daily: {},
  history: []
};
const startTs = 1_786_521_600;

assert.equal(
  processSample(config, "sol", modelState, { ts: startTs, ok: true }, true),
  null
);

const failureMessage = processSample(
  config,
  "sol",
  modelState,
  { ts: startTs + 600, ok: false },
  true
);
assert.ok(failureMessage.includes("\u6b63\u5e38\u8fd0\u884c\u65f6\u95f4\uff1a10 \u5206\u949f"));
assert.ok(failureMessage.includes("\u4eca\u65e5\u8fd0\u884c\u65f6\u95f4\uff1a10 \u5206\u949f"));
assert.equal(modelState.daily["2026-08-12"].okSeconds, 600);
assert.equal(modelState.daily["2026-08-12"].badCount, 1);

const recoveryMessage = processSample(
  config,
  "sol",
  modelState,
  { ts: startTs + 780, ok: true },
  true
);
assert.ok(recoveryMessage.includes("\u5f02\u5e38\u6301\u7eed\u65f6\u95f4\uff1a3 \u5206\u949f"));
assert.ok(recoveryMessage.includes("\u4eca\u65e5\u5f02\u5e38\u65f6\u95f4\uff1a3 \u5206\u949f"));
assert.equal(modelState.daily["2026-08-12"].badSeconds, 180);

assert.equal(
  processSample(config, "sol", modelState, { ts: startTs + 780, ok: true }, true),
  null,
  "ignores duplicate samples"
);
assert.equal(modelState.history.length, 3);

assert.throws(
  () => validateStatusData({ services: [{ model: "sol", last: null }] }),
  /未返回有效模型/
);
assert.equal(
  validateStatusData({
    services: [{ model: "sol", last: { ts: startTs, ok: true } }]
  }).services.length,
  1
);


console.log("background tests passed");
