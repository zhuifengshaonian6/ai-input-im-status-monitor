const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("background.js", "utf8");
const storage = {};
const notifications = [];
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
    notifications: {
      create: async (item) => notifications.push(item)
    },
    runtime: {
      onInstalled: listener,
      onStartup: listener,
      onMessage: listener
    },
    storage: {
      local: {
        get: async (key) => ({ [key]: storage[key] }),
        set: async (items) => Object.assign(storage, items)
      }
    }
  },
  console,
  Date,
  Intl,
  Map,
  Math,
  Number,
  Set,
  setTimeout
};

vm.createContext(context);
vm.runInContext(
  `${source}\n;globalThis.testHooks = { fetchAndProcess };`,
  context
);

async function run() {
  context.fetch = async () => {
    throw new Error("source offline");
  };
  const failed = await context.testHooks.fetchAndProcess();
  assert.equal(failed.ok, false);
  assert.equal(storage.state.sourceOnline, false);
  assert.ok(Number.isFinite(storage.state.sourceDownSinceTs));

  const sampleTs = 1_786_522_500;
  context.fetch = async () => ({
    ok: true,
    json: async () => ({
      all_ok: true,
      generated_at: sampleTs,
      services: [{
        model: "gpt-5.6-sol",
        uptime_pct: 100,
        last: {
          ts: sampleTs,
          ok: true,
          latency_ms: 120,
          error: null
        },
        history: []
      }]
    })
  });

  const recovered = await context.testHooks.fetchAndProcess();
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.activeModel, "gpt-5.6-sol");
  assert.equal(storage.state.sourceOnline, true);
  assert.equal(storage.state.sourceDownSinceTs, null);
  assert.ok(
    notifications.some((item) =>
      item.title.includes("\u63a5\u53e3\u6062\u590d")
    ),
    "emits a recovery notification"
  );

  console.log("recovery tests passed");
}

run();
