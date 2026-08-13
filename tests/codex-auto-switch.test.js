const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("codex-plus-plus/status-model-auto-switch.js", "utf8");
assert.match(source, /version: 0\.4\.0/);
assert.match(source, /if \(state\.inFlight\) return state\.inFlight/);
assert.match(source, /state\.bootstrapTimer = setTimeout\(start, 1000\)/);
assert.match(source, /Continue in memory when the host disables storage/);
assert.match(source, /updateSettings\(settings = \{\}\)/);
assert.match(source, /data-settings-toggle/);
const context = {
  __CODEX_STATUS_TEST__: true,
  console,
  Map,
  Set,
  document: {
    querySelector() {
      return null;
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);

const {
  chooseHealthyService,
  nativeMenuInUse,
  selectWithBridge
} = context.__inputStatusTestHooks;
assert.equal(typeof nativeMenuInUse, 'function');
assert.equal(nativeMenuInUse(), false);
const priority = ["sol", "terra", "luna"];

assert.equal(
  chooseHealthyService([
    { model: "sol", last: { ok: false } },
    { model: "terra", last: { ok: true } },
    { model: "luna", last: { ok: true } }
  ], priority).model,
  "terra"
);
assert.equal(
  chooseHealthyService([{ model: "sol", last: { ok: false } }], priority),
  null
);

let selected = null;
const catalogBridge = {
  model: "sol",
  reasoningEffort: "high",
  models: [{
    model: "terra",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"]
  }],
  onSelectModel(model, effort) {
    selected = { model, effort };
  }
};
assert.equal(selectWithBridge(catalogBridge, "terra"), true);
assert.deepEqual(selected, { model: "terra", effort: "high" });

let powerSelection = null;
const powerBridge = {
  powerSelections: [{ model: "luna", reasoningEffort: "medium" }],
  onSelectPower(option) {
    powerSelection = option;
  }
};
assert.equal(selectWithBridge(powerBridge, "luna"), true);
assert.equal(powerSelection.model, "luna");
assert.equal(selectWithBridge(powerBridge, "missing"), false);

console.log("codex auto-switch tests passed");
