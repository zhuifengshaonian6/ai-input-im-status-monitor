const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("codex-plus-plus/codex-task-recovery.js", "utf8");
assert.match(source, /version: 0\.4\.1/);
assert.match(source, /data-local-conversation-user-anchor/);
assert.equal(source.includes("new MutationObserver"), false);
assert.equal(source.includes("body?.innerText"), false);
assert.match(source, /removeEventListener\("online"/);
assert.match(source, /state\.bootstrapTimer = setTimeout\(start, 1000\)/);
assert.match(source, /Checkpoint remains available in memory/);
assert.match(source, /data-settings-toggle/);
assert.match(source, /updateSettings\(settings = \{\}\)/);
const context = {
  __CODEX_TASK_RECOVERY_TEST__: true,
  console,
  URL,
  navigator: { onLine: true },
  location: { href: "app://-/index.html?threadId=thread-123" },
  document: {
    body: {
      querySelectorAll(selector) {
        return selector.includes("[data-local-conversation-user-anchor")
          ? [{ innerText: "Original task request" }]
          : [];
      }
    },
    querySelectorAll() {
      return [{ innerText: "Original task request" }];
    }
  }
};
vm.createContext(context);
vm.runInContext(source, context);

const hooks = context.__codexTaskRecoveryTestHooks;
assert.equal(typeof hooks.checkpoint, "function");
assert.equal(typeof hooks.findResumeButton, "function");
assert.equal(typeof hooks.hasRecoverySignal, "function");

const checkpoint = hooks.checkpoint(context.document);
assert.equal(checkpoint.threadKey, "id:thread-123");
assert.equal(checkpoint.lastUserMessage, "Original task request");
function node(text, order) {
  return {
    innerText: text,
    children: [],
    getAttribute() { return null; },
    compareDocumentPosition(other) { return order < other.order ? 4 : 2; },
    order
  };
}
const oldAnchor = node("\u4f60\u8bf4\uff1a \u87ba\u65cb\u6321\u677f", 1);
const latestTurn = node("\u4f60\u8bf4\uff1a \u4fee\u590d Codex++ \u5f53\u524d\u4efb\u52a1\u8bc6\u522b", 2);
const main = {
  querySelectorAll(selector) {
    if (selector.includes("data-local-conversation")) return [oldAnchor];
    if (selector === "article,section,div") return [oldAnchor, latestTurn];
    return [];
  }
};
const selected = {
  innerText: "\u5f00\u53d1\u6d4f\u89c8\u5668\u63d2\u4ef6 \u7b49\u5f85\u6279\u51c6",
  parentElement: null,
  getAttribute() { return null; }
};
const virtualizedDocument = {
  body: main,
  querySelector(selector) {
    if (selector === "main") return main;
    if (selector === "[aria-current='page']") return selected;
    return null;
  }
};
context.location.href = "app://-/index.html";
const virtualizedCheckpoint = hooks.checkpoint(virtualizedDocument);
assert.equal(virtualizedCheckpoint.threadKey, "title:-:\u5f00\u53d1\u6d4f\u89c8\u5668\u63d2\u4ef6");
assert.equal(virtualizedCheckpoint.lastUserMessage, "\u4fee\u590d Codex++ \u5f53\u524d\u4efb\u52a1\u8bc6\u522b");
assert.equal(virtualizedCheckpoint.lastUserMessage.includes("\u87ba\u65cb\u6321\u677f"), false);

const retryButton = {
  disabled: false,
  getAttribute(name) {
    return name === "aria-label" ? "Retry response" : null;
  },
  getBoundingClientRect() {
    return { width: 80, height: 30 };
  },
  parentElement: { textContent: "Network error Retry response" }
};
const retryDocument = {
  querySelectorAll(selector) {
    return selector.includes("role='alert'")
      ? [{ textContent: "Network error" }]
      : [retryButton];
  }
};
assert.equal(hooks.hasRecoverySignal(retryDocument), true);
assert.equal(hooks.findResumeButton(retryDocument).label, "Retry response");

const unrelatedButton = {
  disabled: false,
  getAttribute() {
    return "Continue";
  },
  getBoundingClientRect() {
    return { width: 80, height: 30 };
  },
  parentElement: { textContent: "Continue reading documentation" }
};
assert.equal(
  hooks.findResumeButton({
    querySelectorAll() {
      return [unrelatedButton];
    }
  }),
  null
);

const pluginButton = {
  ...retryButton,
  closest(selector) {
    return selector === "#codex-task-recovery" ? {} : null;
  }
};
assert.equal(
  hooks.findResumeButton({
    querySelectorAll() {
      return [pluginButton];
    }
  }),
  null
);

const pluginAlert = {
  textContent: "Network offline Resume current task",
  closest(selector) {
    return selector === "#codex-task-recovery" ? {} : null;
  }
};
assert.equal(
  hooks.hasRecoverySignal({
    querySelectorAll() {
      return [pluginAlert];
    }
  }),
  false
);

console.log("task recovery tests passed");
