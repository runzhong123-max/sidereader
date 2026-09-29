import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Exercise the real menu handlers with explicit DOM focus/commit boundaries.
// This does not claim browser Tab ordering, pointer delivery or native focus.
const hooks = `
let slots = [], cursor = 0;
export const reset = () => { slots = []; cursor = 0; };
export const beginRender = () => { cursor = 0; };
export const useState = initial => {
  const index = cursor++;
  if (!(index in slots)) slots[index] = initial;
  return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }];
};
export const useRef = value => { const index = cursor++; return slots[index] ??= { current: value }; };
export const useEffect = () => {};
export const useId = () => 'menu-test';
`;
const compiled = await build({
  stdin: { contents: `export { default as ActionMenu } from './src/components/ActionMenu.tsx'; export { reset, beginRender } from 'react';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "menu-state-boundary", setup(builder) {
    builder.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, ({ path }) => ({ path, namespace: "menu-test" }));
    builder.onLoad({ filter: /.*/, namespace: "menu-test" }, ({ path }) => ({ contents: path === "react" ? hooks
      : "export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;", loader: "js" }));
  } }],
});
const { ActionMenu, reset, beginRender } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const originalGlobals = Object.fromEntries(["Node", "Element", "HTMLElement", "document", "requestAnimationFrame", "cancelAnimationFrame"].map((key) => [key, globalThis[key]]));
afterEach(() => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});

class FocusElement {
  constructor(tag, parent = null, keepOpen = false) { this.tag = tag; this.parent = parent; this.keepOpen = keepOpen; this.isConnected = true; this.focusCalls = []; }
  contains(element) { for (let current = element; current; current = current.parent) if (current === this) return true; return false; }
  closest(selector) {
    for (let current = this; current; current = current.parent) {
      if (selector === "button, a" && ["button", "a"].includes(current.tag)) return current;
      if (selector === "[data-menu-keep-open]" && current.keepOpen) return current;
    }
    return null;
  }
  focus(options) { this.focusCalls.push(options); globalThis.document.activeElement = this; }
}

function mount({ keepOpen = false } = {}) {
  reset();
  globalThis.Node = globalThis.Element = globalThis.HTMLElement = FocusElement;
  const body = new FocusElement("body"), documentElement = new FocusElement("html");
  globalThis.document = { body, documentElement, activeElement: body };
  const frames = new Map(); let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const root = new FocusElement("div"), trigger = new FocusElement("button", root);
  const panel = new FocusElement("div", root), row = new FocusElement("div", panel, keepOpen), item = new FocusElement("button", row);
  const editor = new FocusElement("input");
  let tree;
  function render() {
    beginRender();
    tree = ActionMenu({ label: "图谱菜单", trigger: "展开方式", children: "示例操作" });
    tree.props.ref.current = root;
    tree.props.children[0].props.ref.current = trigger;
    if (!tree.props.children[1]) {
      panel.isConnected = item.isConnected = false;
      if (document.activeElement === item) document.activeElement = body;
    } else panel.isConnected = item.isConnected = true;
  }
  render();
  const open = () => { tree.props.children[0].props.onClick(); render(); };
  open();
  const activate = (action = () => {}) => {
    item.focus();
    action(); // A child's action runs before the click bubbles to ActionMenu.
    tree.props.children[1].props.onClick({ target: item, currentTarget: panel });
    render(); // Model removal of the focused menu item during React's commit.
  };
  const flushFrames = () => { for (const [id, callback] of [...frames]) { frames.delete(id); callback(); } };
  return { activate, flushFrames, open, editor, trigger, item, isOpen: () => Boolean(tree.props.children[1]), pendingFrames: () => frames.size };
}

test("keyboard layout and scale actions return lost menu focus to their trigger", () => {
  for (const actionName of ["切换自由网络", "恢复100%", "取消关注"]) {
    const ui = mount(); let actions = 0;
    ui.activate(() => actions++);
    assert.equal(actions, 1, actionName);
    assert.equal(ui.isOpen(), false);
    assert.equal(ui.trigger.focusCalls.length, 0, "focus return waits for the commit and new autofocus destinations");
    ui.flushFrames();
    assert.equal(document.activeElement, ui.trigger, actionName);
    assert.deepEqual(ui.trigger.focusCalls, [{ preventScroll: true }]);
  }
});

test("an action that immediately focuses an editor is not overridden", () => {
  const ui = mount();
  ui.activate(() => ui.editor.focus());
  assert.equal(ui.isOpen(), false);
  assert.equal(ui.pendingFrames(), 0);
  ui.flushFrames();
  assert.equal(document.activeElement, ui.editor);
  assert.equal(ui.trigger.focusCalls.length, 0);
});

test("an editor autofocus during the commit wins over a pending trigger restoration", () => {
  const ui = mount();
  ui.activate();
  assert.equal(ui.pendingFrames(), 1);
  ui.editor.focus();
  ui.flushFrames();
  assert.equal(document.activeElement, ui.editor);
  assert.equal(ui.trigger.focusCalls.length, 0);
});

test("continuous zoom and settings actions keep the menu open and retain item focus", () => {
  const ui = mount({ keepOpen: true });
  let zooms = 0;
  for (let index = 0; index < 3; index++) ui.activate(() => zooms++);
  assert.equal(zooms, 3);
  assert.equal(ui.isOpen(), true);
  assert.equal(ui.pendingFrames(), 0);
  ui.flushFrames();
  assert.equal(document.activeElement, ui.item);
  assert.equal(ui.trigger.focusCalls.length, 0);
});

test("reopening the menu cancels an earlier pending focus return", () => {
  const ui = mount();
  ui.activate();
  assert.equal(ui.pendingFrames(), 1);
  ui.open(); ui.item.focus();
  assert.equal(ui.pendingFrames(), 0);
  ui.flushFrames();
  assert.equal(ui.isOpen(), true);
  assert.equal(document.activeElement, ui.item);
  assert.equal(ui.trigger.focusCalls.length, 0);
});
