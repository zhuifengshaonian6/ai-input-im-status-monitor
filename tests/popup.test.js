const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.textContent = "";
    this.className = "";
    this.title = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  addEventListener() {}
}

const elements = new Map();
const document = {
  getElementById(id) {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  },
  querySelector() {
    return new Element();
  },
  createElement() {
    return new Element();
  },
  body: new Element()
};
const source = fs.readFileSync("popup.js", "utf8").replace(/\nrender\(\);\s*$/, "");
assert.match(source, /state\.sourceOnline === true/);
const context = {
  __STATUS_POPUP_TEST__: true,
  chrome: {
    runtime: {
      getManifest: () => ({ version: "1.4.1" }),
      sendMessage: async () => ({ ok: false }),
      openOptionsPage() {}
    }
  },
  document,
  console,
  Date,
  Intl,
  Map,
  Math,
  Number,
  Set
};

vm.createContext(context);
vm.runInContext(source, context);

const priority = ["sol", "terra", "luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];
context.__statusPopupTestHooks.renderServices({
  services: [{
    model: "sol",
    uptimePct: 99,
    last: { ok: true, latencyMs: 100 }
  }]
}, "sol", priority);

const rows = elements.get("services").children;
assert.equal(rows.length, 6);
assert.equal(elements.get("servicesCount").textContent, "1/6");
assert.equal(rows[0].children[0].children[0].textContent, "sol");
assert.equal(rows[1].children[1].className, "dot unknown");

context.__statusPopupTestHooks.renderUpdate({
  currentVersion: "1.4.1",
  latestVersion: "1.5.0",
  updateAvailable: true,
  downloadUrl: "https://example.test/update.zip",
  checkedAt: Date.now(),
  error: null
});
assert.equal(elements.get("currentVersion").textContent, "v1.4.1");
assert.equal(elements.get("downloadUpdateLink").hidden, false);
assert.equal(elements.get("downloadUpdateLink").href, "https://example.test/update.zip");
console.log("popup tests passed");
