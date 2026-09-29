import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { graphFixture } from "../qa/graph-fixtures.mjs";

// Execute the production component's event handlers and rerender its output.
// Only hook storage and DOM boundaries are replaced. This tests state transitions,
// not CSS geometry, native focus or Safari pointer delivery. Optional lifecycle
// mode executes production effects against controlled DOM/ResizeObserver boundaries.
// Child components are not mounted: ActionMenu children remain inspectable here.
// Menu visibility is covered separately by the real SSR component tests.
const hooks = `
let slots = [], cursor = 0, effects = false, pending = [], dirty = false;
export const unmount = () => { for (const slot of slots) if (slot?.cleanup) { const cleanup = slot.cleanup; delete slot.cleanup; cleanup(); } };
export const reset = (withEffects = false) => { unmount(); slots = []; cursor = 0; pending = []; effects = withEffects; };
export const beginRender = () => { cursor = 0; dirty = false; };
export const flushEffects = () => {
  const queue = pending; pending = [];
  for (const item of queue) { item.slot.cleanup?.(); item.slot.cleanup = item.callback(); }
  return dirty;
};
export const useState = initial => {
  const index = cursor++;
  if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
  return [slots[index], value => {
    const next = typeof value === 'function' ? value(slots[index]) : value;
    if (!Object.is(slots[index], next)) { dirty = true; slots[index] = next; }
  }];
};
export const useRef = value => { const index = cursor++; return slots[index] ??= { current: value }; };
export const useMemo = fn => fn();
export const useCallback = fn => fn;
export const useEffect = (callback, deps) => {
  if (!effects) return;
  const index = cursor++, slot = slots[index] ??= {};
  if (!slot.deps || !deps || deps.some((value, i) => !Object.is(value, slot.deps[i]))) {
    slot.deps = deps; pending.push({ slot, callback });
  }
};
export const useLayoutEffect = useEffect;
export const useId = () => 'interaction-test';
export const forwardRef = fn => fn;
export const createElement = (type, props, ...children) => ({ type, props: { ...props, children } });
export const memo = fn => fn;
export const Fragment = 'fragment';
export default { createElement, forwardRef };
`;
const compiled = await build({
  stdin: { contents: `export { default as Graph } from './src/components/Graph.tsx'; export { reset, beginRender, flushEffects, unmount } from 'react';`, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  plugins: [{ name: "component-state-boundary", setup(builder) {
    builder.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom)$/ }, ({ path }) => ({ path, namespace: "state-test" }));
    builder.onLoad({ filter: /.*/, namespace: "state-test" }, ({ path }) => ({ contents: path === "react" ? hooks
      : path === "react-dom" ? "export const createPortal = value => value;"
      : "export const jsx = (type, props) => ({type, props}); export const jsxs = jsx; export const Fragment = 'fragment';", loader: "js" }));
  } }],
});
const { Graph, reset, beginRender, flushEffects, unmount } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const originalGlobals = Object.fromEntries(["requestAnimationFrame", "window", "document", "ResizeObserver"].map((key) => [key, globalThis[key]]));
afterEach(() => {
  unmount();
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});

function descendants(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) { value.forEach((child) => descendants(child, output)); return output; }
  if (value.props) { output.push(value); descendants(value.props.children, output); }
  return output;
}
const text = (value) => typeof value === "string" || typeof value === "number" ? String(value)
  : Array.isArray(value) ? value.map(text).join("") : value?.props ? text(value.props.children) : "";
const event = (extra = {}) => ({ button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...extra });

function mount(concepts, overrides = {}, lifecycle = false) {
  reset(lifecycle);
  globalThis.requestAnimationFrame = (callback) => callback();
  const windowListeners = new Map(), documentListeners = new Map(), canvasListeners = new Map(), captures = new Set();
  globalThis.window = { innerWidth: 1200, innerHeight: 800,
    addEventListener: (name, handler) => windowListeners.set(name, handler),
    removeEventListener: (name) => windowListeners.delete(name) };
  if (lifecycle) globalThis.document = { hidden: false,
    addEventListener: (name, handler) => documentListeners.set(name, handler),
    removeEventListener: (name) => documentListeners.delete(name) };
  let dimensions = { width: 900, height: 570 }, resizeCallback;
  const canvas = { focus() {}, contains: () => false,
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id),
    getBoundingClientRect: () => ({ left: 20, top: 30, right: 20 + dimensions.width, bottom: 30 + dimensions.height }),
    addEventListener: (name, handler) => canvasListeners.set(name, handler), removeEventListener: name => canvasListeners.delete(name) };
  if (lifecycle) globalThis.ResizeObserver = class {
    constructor(callback) { resizeCallback = callback; }
    observe() { resizeCallback([{ contentRect: dimensions }]); }
    disconnect() {}
  };
  const changes = [];
  let props = { concepts: structuredClone(concepts), relationKind: "prerequisite", onChange(next) { changes.push(next); props = { ...props, concepts: next }; }, ...overrides };
  let tree;
  const render = () => {
    let iterations = 0, changed;
    do {
      beginRender(); tree = Graph(props);
      if (lifecycle) {
        for (const element of descendants(tree)) {
          if (element.props.className === 'network-canvas') element.props.ref.current = canvas;
          if (element.props['aria-label'] === '可交互知识网络') element.props.ref.current = canvas;
        }
      }
      changed = lifecycle && flushEffects();
      assert.ok(++iterations < 15, 'production effects settle without a state loop');
    } while (changed);
  };
  const resize = (width, height) => { dimensions = { width, height }; resizeCallback([{ contentRect: dimensions }]); render(); };
  const wheel = extra => { canvasListeners.get('wheel')(event({ deltaY: 0, ...extra })); render(); };
  const blur = () => { windowListeners.get('blur')?.(); render(); };
  const hide = () => { globalThis.document.hidden = true; documentListeners.get('visibilitychange')?.(); render(); };
  const elements = () => descendants(tree);
  const find = (predicate) => { const value = elements().find(predicate); assert.ok(value, "the requested production control is present"); return value; };
  const label = (value) => find((element) => element.props["aria-label"] === value);
  const button = (value) => find((element) => element.type === "button" && text(element) === value);
  const click = (element) => { element.props.onClick(event()); render(); };
  const doubleClick = (element) => { element.props.onDoubleClick(event()); render(); };
  const mode = (name) => click(find((element) => element.type === "button" && element.props["aria-pressed"] !== undefined && text(element).startsWith(name)));
  const controls = () => elements().filter((element) => element.props["aria-label"]?.startsWith("查看概念："));
  const names = () => controls().map((element) => element.props["aria-label"].slice("查看概念：".length));
  const search = (value) => {
    label("搜索图谱概念").props.onChange({ target: { value } }); render();
    label("搜索图谱概念").props.onKeyDown(event({ key: "Enter" })); render();
  };
  const change = (name, value) => { label(name).props.onChange({ target: { value } }); render(); };
  const toggle = (name, checked) => { label(name).props.onChange({ target: { checked } }); render(); };
  const inspect = (name) => click(label(`查看 ${name} 的详情`));
  const hasDetails = () => elements().some((element) => element.props["aria-label"] === "概念详情");
  const depth = (level) => click(label(`高亮${level}级关联`));
  const clearFocus = () => click(find((element) => element.type === "button" && text(element).startsWith("取消关注")));
  const positions = () => new Map(elements().filter((element) => element.type === "g" && /^translate\([^)]*\)$/.test(element.props.transform || ""))
    .flatMap((element) => {
      const node = descendants(element.props.children).find((child) => child.props["aria-label"]?.startsWith("查看概念："));
      return node ? [[node.props["aria-label"].slice("查看概念：".length), element.props.transform]] : [];
    }));
  const camera = () => find((element) => element.type === "g" && /^translate\([^)]*\) scale\(/.test(element.props.transform || "")).props.transform;
  const update = (next) => { props = { ...props, ...next }; render(); };
  render();
  return { render, update, resize, wheel, blur, hide, unmount, canvas, captures, elements, find, label, button, click, doubleClick, mode, controls, names, search, change, toggle, inspect, hasDetails, depth, clearFocus, positions, camera, changes, concepts: () => props.concepts };
}

const chain = (length = 7) => Array.from({ length }, (_, index) => ({
  id: `chain-${index}`, name: `概念 ${index}`, description: `第 ${index} 个概念说明`, x: 0, y: 0, group: 0,
  links: index ? [`chain-${index - 1}`] : [],
  anchors: [{ sourceId: index === length - 1 ? "last-source" : "main-source", title: index === length - 1 ? "独立来源" : "主要来源", page: index + 1 }],
}));

test("all layouts separate single-click attention from explicit detail inspection", () => {
  for (const mode of ["核心展开", "分层关系", "自由网络"]) {
    const references = [], ui = mount(chain(), { onReferenceConcept: (id) => references.push(id) });
    ui.mode(mode);
    ui.click(ui.label("查看概念：概念 0"));
    assert.equal(ui.label("查看概念：概念 0").props["aria-pressed"], true, `${mode}: clicking locks attention`);
    assert.equal(ui.hasDetails(), false, `${mode}: clicking does not cover the graph with an inspector`);
    ui.doubleClick(ui.label("查看概念：概念 0"));
    assert.equal(ui.hasDetails(), true, `${mode}: double-click remains a detail shortcut`);
    ui.click(ui.label("关闭概念详情"));
    ui.label("查看概念：概念 1").props.onKeyDown(event({ key: "Enter" })); ui.render();
    assert.equal(ui.hasDetails(), true, `${mode}: Enter opens details without needing a pointer`);
    assert.equal(ui.label("查看概念：概念 1").props["aria-pressed"], true);
    assert.deepEqual(references, [], "attention and inspection must not send references implicitly");
    assert.equal(ui.changes.length, 0);
  }
});

test("search locates a concept without opening or reserving space for details; the footer is an explicit detail entry", () => {
  for (const mode of ["核心展开", "分层关系", "自由网络"]) {
    const ui = mount(chain());
    ui.mode(mode);
    ui.search("概念 4");
    assert.equal(ui.hasDetails(), false, mode);
    assert.equal(ui.label("查看 概念 4 的详情").props["aria-expanded"], false);
    const located = ui.camera();
    ui.inspect("概念 4");
    assert.equal(ui.hasDetails(), true);
    assert.equal(ui.camera(), located, "opening the footer detail entry preserves the current camera");
    assert.equal(ui.label("查看 概念 4 的详情").props["aria-expanded"], true);
    ui.click(ui.label("关闭概念详情"));
    ui.label("查看概念：概念 4").props.onKeyDown(event({ key: "Enter" })); ui.render();
    const x = (camera) => Number(camera.match(/^translate\(([-\d.e]+),/)[1]);
    assert.ok(Math.abs(x(located) - x(ui.camera()) - 140) < 1e-9, "only explicit centered inspection reserves the 280px inspector width");
    ui.search("概念 3");
    assert.equal(ui.hasDetails(), false, "a new search returns to locating rather than silently showing another inspector");
  }
});

test("the top-level full-graph return clears local, source and custom-root scopes", () => {
  for (const scope of ["local", "source", "root"]) {
    const concepts = chain(), ui = mount(concepts);
    if (scope === "source") ui.change("筛选图谱原文来源", "last-source");
    else {
      ui.search("概念 3"); ui.inspect("概念 3");
      ui.click(ui.button(scope === "local" ? "只看关联" : "以此展开"));
    }
    const header = ui.find((element) => element.type === "header" && element.props.className === "network-toolbar");
    const directReturn = header.props.children.find((element) => element?.props?.["aria-label"] === "返回完整图谱");
    assert.ok(directReturn, `${scope}: escape from a restricted view is visible outside a submenu`);
    ui.click(directReturn);
    assert.deepEqual(ui.names().sort(), concepts.map((concept) => concept.name).sort());
    assert.equal(ui.hasDetails(), false);
    assert.ok(ui.controls().every((element) => !element.props["aria-pressed"] && !element.props.className.includes("is-dim")));
    assert.equal(ui.elements().some((element) => element.props["aria-label"] === "返回完整图谱"), false);
    assert.equal(ui.changes.length, 0);
  }
});

test("graph follow-up has one explicit footer action and is never fired by browsing", () => {
  let asks = 0;
  const ui = mount(chain(), { onAskGraph: () => asks++ });
  const askButtons = () => ui.elements().filter((element) => element.type === "button" && element.props["aria-label"] === "追问这个图谱");
  assert.equal(askButtons().length, 1);
  ui.search("概念 2"); ui.inspect("概念 2"); ui.click(ui.label("关闭概念详情"));
  ui.depth(2); ui.clearFocus(); ui.mode("自由网络");
  assert.equal(asks, 0, "view controls must not create an object conversation");
  ui.click(askButtons()[0]);
  assert.equal(asks, 1, "one activation invokes the supplied conversation callback exactly once");
  const noAsk = mount(chain(), { onAskGraph: undefined });
  assert.ok(!noAsk.elements().some((element) => element.props["aria-label"] === "追问这个图谱"));
});

test("detail neighbors remain inspectable and reference and source actions remain explicit", () => {
  const references = [], sources = [], ui = mount(chain(), { onReferenceConcept: (id) => references.push(id), onReadAnchor: (anchor) => sources.push(anchor) });
  ui.click(ui.label("查看概念：概念 0")); ui.inspect("概念 0");
  const neighbors = ui.find((element) => element.props.activeId === "chain-0" && element.props.onSelect);
  assert.equal(neighbors.props.relationKind, "prerequisite");
  neighbors.props.onSelect("chain-1"); ui.render();
  assert.equal(ui.hasDetails(), true);
  assert.equal(ui.label("查看 概念 1 的详情").props["aria-expanded"], true);
  ui.click(ui.button("引用到对话"));
  assert.deepEqual(references, ["chain-1"]);
  ui.click(ui.find((element) => element.props.className === "network-source"));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].page, 2);
  assert.equal(ui.changes.length, 0);
});

test("returning from a local graph shows every concept rather than only fitting invisible concepts", () => {
  const concepts = graphFixture("chapter").concepts, ui = mount(concepts);
  assert.ok(ui.names().length < concepts.length);
  ui.click(ui.label("查看概念：线性模型基本形式"));
  ui.inspect("线性模型基本形式");
  ui.click(ui.button("只看关联"));
  assert.ok(ui.names().length < concepts.length);
  ui.click(ui.button("查看全部概念"));
  assert.deepEqual(ui.names().sort(), concepts.map((concept) => concept.name).sort());
});

test("source filtering finds matching concepts behind collapsed branches and search reveals a hidden path", () => {
  const ui = mount(chain());
  assert.ok(!ui.names().includes("概念 6"));
  ui.change("筛选图谱原文来源", "last-source");
  assert.deepEqual(ui.names(), ["概念 6"]);
  assert.ok(!ui.elements().some((element) => element.type === "p" && text(element) === "当前筛选下没有概念"));
  ui.search("概念 4");
  assert.ok(ui.names().includes("概念 4"), "search clears an incompatible source restriction");
  assert.equal(ui.label("查看概念：概念 4").props["aria-pressed"], true);
});

test("collapsing to the backbone does not leave all visible nodes dimmed by a hidden selection", () => {
  const ui = mount(graphFixture("chapter").concepts);
  ui.search("正则化");
  assert.equal(ui.hasDetails(), false);
  ui.click(ui.button("收起到主干"));
  assert.ok(!ui.names().includes("正则化"));
  assert.ok(ui.controls().every((element) => !element.props["aria-pressed"] && !element.props.className.includes("is-dim")));
});

test("all branches remain reachable for cyclic, disconnected and 100-concept graphs", () => {
  for (const id of ["chapter", "cycle", "disconnected", "hundred"]) {
    const fixture = graphFixture(id), ui = mount(fixture.concepts, { relationKind: fixture.relationKind });
    let actions = 0;
    for (;;) {
      const next = ui.elements().find((element) => element.props.className === "network-branch-toggle" && element.props["aria-expanded"] === false);
      if (!next) break;
      ui.click(next);
      assert.ok(++actions <= fixture.concepts.length, "each branch needs at most one expansion");
    }
    assert.deepEqual(ui.names().sort(), fixture.concepts.map((concept) => concept.name).sort(), id);
  }
});

test("one, two and three-hop highlighting keeps the whole free network available", () => {
  const concepts = chain(), ui = mount(concepts);
  ui.mode("自由网络");
  ui.click(ui.label("查看概念：概念 0"));
  for (const depth of [1, 2, 3]) {
    ui.depth(depth);
    assert.equal(ui.names().length, concepts.length, "highlighting is not a destructive filter");
    const bright = ui.controls().filter((element) => !element.props.className.includes("is-dim"));
    assert.deepEqual(bright.map((element) => element.props["aria-label"]).sort(), concepts.slice(0, depth + 1).map((concept) => `查看概念：${concept.name}`).sort());
    assert.deepEqual(bright.map((element) => element.props["data-hop"]).sort(), Array.from({ length: depth + 1 }, (_, index) => index));
  }
  ui.toggle("自动舒展拥挤处", false);
  assert.equal(ui.label("自动舒展拥挤处").props.checked, false);
  assert.equal(ui.names().length, concepts.length);
  ui.toggle("自动舒展拥挤处", true);
  assert.equal(ui.label("自动舒展拥挤处").props.checked, true);
  assert.equal(ui.names().length, concepts.length);
  ui.clearFocus();
  assert.ok(ui.controls().every((element) => !element.props.className.includes("is-dim")));
  assert.equal(ui.changes.length, 0, "focus and temporary relaxation never write to the saved graph");
});

test("changing layout or returning from a chosen starting point clears stale focus without losing graph data", () => {
  const concepts = graphFixture("chapter").concepts, ui = mount(concepts);
  ui.search("正则化");
  ui.inspect("正则化");
  ui.click(ui.button("以此展开"));
  ui.click(ui.label("返回完整图谱"));
  assert.equal(ui.names().length, concepts.length);
  for (const mode of ["分层关系", "自由网络", "核心展开"]) {
    ui.mode(mode);
    assert.ok(ui.controls().every((element) => !element.props["aria-pressed"] && !element.props.className.includes("is-dim")));
    if (mode !== "核心展开") assert.equal(ui.names().length, concepts.length);
  }
  assert.deepEqual(ui.concepts(), concepts);
});

test("temporary network focus preserves the focal point and all outside points and can restore the original layout", () => {
  const ui = mount(graphFixture("chapter").concepts);
  ui.mode("自由网络");
  const original = ui.positions();
  for (const name of ["线性模型基本形式", "线性回归", "最小二乘法", "线性模型基本形式"]) {
    const before = ui.positions();
    ui.click(ui.label(`查看概念：${name}`));
    assert.equal(ui.positions().get(name), before.get(name), "the point selected by the user cannot jump out from under the pointer");
    for (const control of ui.controls().filter((node) => node.props["data-hop"] === undefined)) {
      const outside = control.props["aria-label"].slice("查看概念：".length);
      assert.equal(ui.positions().get(outside), before.get(outside), `${outside} is outside the focus neighborhood`);
    }
    for (const depth of [2, 3, 1]) {
      const fixed = ui.positions().get(name);
      ui.depth(depth);
      assert.equal(ui.positions().get(name), fixed, "changing the depth keeps the focal point anchored");
      assert.equal(ui.positions().size, original.size);
    }
  }
  ui.clearFocus();
  assert.deepEqual(ui.positions(), original);
  assert.equal(ui.changes.length, 0);
});

test("keyboard users can dismiss details, return to the graph, pan and clear attention", () => {
  const ui = mount(chain());
  let focused = 0;
  const canvas = { focus() { focused++; } };
  ui.label("可交互知识网络").props.ref.current = canvas;
  ui.label("查看概念：概念 0").props.onKeyDown(event({ key: "Enter" })); ui.render();
  ui.label("概念详情").props.onKeyDown(event({ key: "Escape" })); ui.render();
  assert.ok(!ui.elements().some((element) => element.props["aria-label"] === "概念详情"));
  assert.equal(focused, 1, "closing the inspector returns focus to the graph");
  const before = ui.camera();
  ui.label("可交互知识网络").props.onKeyDown(event({ key: "ArrowRight", target: canvas, currentTarget: canvas })); ui.render();
  assert.notEqual(ui.camera(), before);
  ui.label("可交互知识网络").props.onKeyDown(event({ key: "Escape", target: canvas, currentTarget: canvas })); ui.render();
  assert.ok(ui.controls().every((element) => !element.props["aria-pressed"] && !element.props.className.includes("is-dim")));
});

test("resetting a structured view preserves a manually arranged free-network position", () => {
  const concepts = graphFixture("far-pin").concepts, ui = mount(concepts);
  for (const mode of ["核心展开", "分层关系"]) {
    ui.mode(mode);
    ui.click(ui.button("恢复自动布局"));
    assert.deepEqual(ui.concepts().find((concept) => concept.layout)?.layout, { x: 6000, y: 0 });
  }
  assert.equal(ui.changes.length, 0);
  ui.mode("自由网络");
  ui.click(ui.button("恢复自动布局"));
  assert.ok(ui.concepts().every((concept) => !concept.layout));
});

test("a node dragged inside an inline graph is not mistaken for a reference drop into its enclosing Tutor", () => {
  const drops = [], projectId = "interaction-project";
  const receiver = { getAttribute: (name) => name === "data-concept-drop" ? projectId : null, setAttribute() {}, removeAttribute() {}, dispatchEvent(value) { drops.push(value.detail); } };
  const ownHit = { closest: () => receiver }, outsideHit = { closest: () => receiver };
  let hit = ownHit;
  globalThis.document = { elementFromPoint: () => hit };
  const ui = mount(chain(), { inline: true, projectId });
  ui.mode("自由网络");
  const canvas = { focus() {}, setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {}, contains: (element) => element === ownHit,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 900, bottom: 570 }) };
  ui.label("可交互知识网络").props.ref.current = canvas;
  const gesture = (x) => {
    ui.label("查看概念：概念 0").props.onPointerDown(event()); ui.render();
    ui.label("可交互知识网络").props.onPointerMove(event({ clientX: x })); ui.render();
    ui.label("可交互知识网络").props.onPointerUp(event({ clientX: x })); ui.render();
  };
  gesture(135);
  assert.equal(drops.length, 0, "a drag within the graph must not add an unintended reference");
  assert.equal(ui.changes.length, 1, "a completed free-network adjustment reaches the layout callback");
  hit = outsideHit;
  gesture(950);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].conceptId, "chain-0");
  assert.equal(ui.changes.length, 1, "dropping a reference does not persist a second layout change");
});

const canvasEvent = (ui, handler, extra = {}) => {
  ui.label("可交互知识网络").props[handler](event({ currentTarget: ui.canvas, target: ui.canvas, ...extra })); ui.render();
};
const cancelBy = (ui, reason) => {
  if (reason === "blur" || reason === "hide") ui[reason]();
  else if (reason === "Escape") canvasEvent(ui, "onKeyDown", { key: "Escape" });
  else canvasEvent(ui, reason);
};
const parseCamera = (value) => {
  const match = value.match(/^translate\(([^,]+),([^)]*)\) scale\(([^)]+)\)/);
  return { x: Number(match[1]), y: Number(match[2]), k: Number(match[3]) };
};

test("all drag cancellation entries restore both camera and its automatic-resize policy", () => {
  for (const manual of [false, true]) {
    const baseline = mount(chain(), {}, true);
    if (manual) baseline.wheel({ deltaY: -60 });
    baseline.resize(1100, 640);
    const expected = baseline.camera();
    for (const reason of ["Escape", "onPointerCancel", "onLostPointerCapture", "blur", "hide"]) {
      const ui = mount(chain(), {}, true);
      if (manual) ui.wheel({ deltaY: -60 });
      const before = ui.camera();
      canvasEvent(ui, "onPointerDown");
      canvasEvent(ui, "onPointerMove", { clientX: 180, clientY: 150 });
      assert.notEqual(ui.camera(), before);
      cancelBy(ui, reason);
      assert.equal(ui.camera(), before, `${reason}: restore the pre-gesture view`);
      assert.equal(ui.captures.size, 0, `${reason}: release pointer capture`);
      canvasEvent(ui, "onPointerUp", { clientX: 250, clientY: 200 });
      assert.equal(ui.camera(), before, "a late pointerup cannot revive the cancelled gesture");
      ui.resize(1100, 640);
      assert.equal(ui.camera(), expected, `${reason}: cancellation also restores automatic/manual resize behavior`);
      assert.equal(ui.changes.length, 0);
    }
  }
});

test("cancelled node and reference drags restore positions, remove feedback and never dispatch a drop", () => {
  for (const outside of [false, true]) for (const reason of ["Escape", "onPointerCancel", "onLostPointerCapture", "blur", "hide"]) {
    const drops = [], attributes = new Map(), ui = mount(chain(), { projectId: "cancel-project" }, true);
    const receiver = { getAttribute: name => name === "data-concept-drop" ? "cancel-project" : null,
      setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
      dispatchEvent: value => drops.push(value.detail) };
    globalThis.document.elementFromPoint = x => x > 920 ? { closest: () => receiver } : null;
    ui.mode("自由网络");
    const before = ui.positions();
    ui.label("查看概念：概念 0").props.onPointerDown(event()); ui.render();
    canvasEvent(ui, "onPointerMove", { clientX: 150 });
    assert.notDeepEqual(ui.positions(), before);
    if (outside) {
      canvasEvent(ui, "onPointerMove", { clientX: 950 });
      assert.equal(attributes.get("data-concept-drag-over"), "true");
    }
    cancelBy(ui, reason);
    assert.deepEqual(ui.positions(), before, `${reason}: no abandoned manual position`);
    assert.equal(attributes.size, 0);
    assert.equal(ui.captures.size, 0);
    canvasEvent(ui, "onPointerUp", { clientX: 950 });
    assert.deepEqual(drops, [], `${reason}: late release cannot reference a concept`);
    assert.equal(ui.changes.length, 0);
  }
});

test("production wheel listener preserves its pointer anchor and lets ordinary inline scrolling pass", () => {
  for (const inline of [false, true]) {
    const ui = mount(chain(), { inline }, true);
    const before = parseCamera(ui.camera());
    let prevented = false;
    ui.wheel({ deltaY: -80, clientX: 250, clientY: 180, preventDefault() { prevented = true; } });
    if (inline) {
      assert.equal(prevented, false);
      assert.deepEqual(parseCamera(ui.camera()), before);
      ui.wheel({ deltaY: -80, clientX: 250, clientY: 180, ctrlKey: true, preventDefault() { prevented = true; } });
    }
    const after = parseCamera(ui.camera());
    assert.equal(prevented, true);
    assert.notEqual(after.k, before.k);
    assert.ok(Math.abs((230 - before.x) / before.k - (230 - after.x) / after.k) < 1e-8);
    assert.ok(Math.abs((150 - before.y) / before.k - (150 - after.y) / after.k) < 1e-8);
    canvasEvent(ui, "onPointerDown");
    ui.wheel({ deltaY: 150, ctrlKey: true });
    assert.deepEqual(parseCamera(ui.camera()), after, "wheel cannot change the coordinate scale of an active drag");
    cancelBy(ui, "Escape");
    ui.wheel({ deltaY: 150, ctrlKey: true });
    assert.notEqual(parseCamera(ui.camera()).k, after.k, "zoom resumes after cancellation");
  }
});

test("the final pointerup location completes a coalesced node move", () => {
  const ui = mount(chain(), {}, true); ui.mode("自由网络");
  const before = ui.positions().get("概念 0").match(/translate\(([^,]+),([^)]*)\)/);
  const k = parseCamera(ui.camera()).k;
  ui.label("查看概念：概念 0").props.onPointerDown(event()); ui.render();
  canvasEvent(ui, "onPointerUp", { clientX: 180, clientY: 130 });
  const saved = ui.concepts()[0].layout;
  assert.equal(ui.changes.length, 1, "a distant release remains a drag even without an intermediate move delivery");
  assert.ok(Math.abs(saved.x - Number(before[1]) - 80 / k) < 1e-8);
  assert.ok(Math.abs(saved.y - Number(before[2]) - 30 / k) < 1e-8);
});

test("branch expansion preserves existing positions and camera through the production effects", () => {
  const ui = mount(chain(), {}, true), before = ui.positions(), camera = ui.camera();
  ui.click(ui.label("展开概念 1的 1 个分支"));
  for (const [name, position] of before) assert.equal(ui.positions().get(name), position);
  assert.equal(ui.camera(), camera);
  assert.ok(ui.names().includes("概念 2"));
});

test("view remount restores a manual camera, focus depth and layout; resizing preserves its world center", () => {
  const key = "lifecycle-view", concepts = chain();
  const first = mount(concepts, { viewKey: key }, true);
  first.mode("自由网络"); first.search("概念 2"); first.depth(3);
  canvasEvent(first, "onKeyDown", { key: "ArrowRight" });
  const saved = first.camera(), positions = first.positions();
  first.unmount();
  const next = mount(concepts, { viewKey: key }, true);
  assert.equal(next.camera(), saved);
  assert.deepEqual(next.positions(), positions);
  assert.equal(next.label("高亮3级关联").props["aria-pressed"], true);
  assert.equal(next.label("查看概念：概念 2").props["aria-pressed"], true);
  const before = parseCamera(saved);
  next.resize(1200, 800);
  const after = parseCamera(next.camera());
  assert.equal(after.k, before.k);
  assert.ok(Math.abs((450 - before.x) / before.k - (600 - after.x) / after.k) < 1e-8);
  assert.ok(Math.abs((285 - before.y) / before.k - (400 - after.y) / after.k) < 1e-8);
});

test("search after a source filter leaves the requested concept inside the viewport in every layout", () => {
  for (const mode of ["核心展开", "分层关系", "自由网络"]) {
    const ui = mount(chain(20), {}, true); ui.mode(mode);
    ui.change("筛选图谱原文来源", "last-source");
    const filteredCamera = ui.camera();
    ui.search("概念 15");
    const camera = parseCamera(ui.camera());
    const [, x, y] = ui.positions().get("概念 15").match(/translate\(([^,]+),([^)]*)\)/);
    assert.ok(Number(x) * camera.k + camera.x > 0 && Number(x) * camera.k + camera.x < 900, `${mode}: the located dot is on screen`);
    assert.ok(Number(y) * camera.k + camera.y > 0 && Number(y) * camera.k + camera.y < 570);
    assert.equal(ui.label("查看概念：概念 15").props["aria-pressed"], true);
    ui.click(ui.label("返回上一个图谱视图"));
    assert.deepEqual(ui.names(), ["概念 19"], "Back restores the restricted source, not a new full-graph fit");
    assert.equal(ui.camera(), filteredCamera);
    assert.equal(ui.changes.length, 0);
  }
});

test("backtracking restores free-network focus geometry, depth and a manually positioned camera", () => {
  const ui = mount(graphFixture("linear").concepts, {}, true);
  ui.mode("自由网络"); ui.search("线性模型基本形式"); ui.depth(3);
  canvasEvent(ui, "onKeyDown", { key: "ArrowRight" });
  ui.wheel({ deltaY: -70, clientX: 340, clientY: 220 });
  const before = ui.camera(), positions = ui.positions(), names = ui.names();
  ui.search("正则化");
  assert.notEqual(ui.camera(), before);
  ui.click(ui.label("返回上一个图谱视图"));
  assert.equal(ui.camera(), before);
  assert.deepEqual(ui.positions(), positions);
  assert.deepEqual(ui.names(), names);
  assert.equal(ui.label("高亮3级关联").props["aria-pressed"], true);
  assert.equal(ui.label("查看概念：线性模型基本形式").props["aria-pressed"], true);
  assert.equal(ui.changes.length, 0);
});

test("layout and local exploration can be retraced without refitting or losing expanded branches", () => {
  const ui = mount(chain(20), {}, true);
  ui.search("概念 10");
  const branchNames = ui.names(), branchCamera = ui.camera();
  ui.mode("分层关系"); ui.click(ui.label("返回上一个图谱视图"));
  assert.deepEqual(ui.names(), branchNames);
  assert.equal(ui.camera(), branchCamera);
  ui.inspect("概念 10");
  ui.click(ui.button("只看关联"));
  const localNames = ui.names(), localCamera = ui.camera();
  ui.click(ui.label("返回完整图谱"));
  assert.equal(ui.names().length, 20);
  ui.click(ui.label("返回上一个图谱视图"));
  assert.deepEqual(ui.names(), localNames);
  assert.equal(ui.camera(), localCamera);
  assert.equal(ui.hasDetails(), true);
});

test("navigation history survives view remount and restores the same world center in a narrower panel", () => {
  const concepts = chain(20), key = "navigation-remount";
  const first = mount(concepts, { viewKey: key }, true);
  first.search("概念 5"); canvasEvent(first, "onKeyDown", { key: "ArrowLeft" });
  const before = parseCamera(first.camera());
  first.search("概念 14"); first.unmount();
  const next = mount(concepts, { viewKey: key }, true); next.resize(320, 360);
  next.click(next.label("返回上一个图谱视图"));
  const after = parseCamera(next.camera());
  assert.equal(after.k, before.k);
  assert.ok(Math.abs((450 - before.x) / before.k - (160 - after.x) / after.k) < 1e-8);
  assert.ok(Math.abs((285 - before.y) / before.k - (180 - after.y) / after.k) < 1e-8);
  assert.equal(next.label("查看概念：概念 5").props["aria-pressed"], true);
  next.inspect("概念 5");
  const header = next.find((element) => element.type === "header" && element.props.className === "network-toolbar");
  assert.equal(header.props.inert, true);
  const back = next.label("返回上一个图谱视图");
  assert.equal(back.props["data-graph-return"], true, "the narrow inspector exposes Back outside the inert toolbar");
});

test("history stays bounded, ignores repeated selected nodes, and never restores outdated knowledge geometry", () => {
  const ui = mount(chain(20), {}, true); ui.mode("自由网络");
  for (let i = 0; i < 16; i++) ui.search(`概念 ${i}`);
  for (let i = 0; i < 4; i++) ui.click(ui.label("查看概念：概念 15"));
  for (let i = 0; i < 12; i++) ui.click(ui.label("返回上一个图谱视图"));
  assert.equal(ui.elements().some((element) => element.props["aria-label"] === "返回上一个图谱视图"), false);
  ui.search("概念 8");
  ui.update({ concepts: ui.concepts().map((concept, i) => i === 8 ? { ...concept, name: "已更新的概念" } : concept) });
  assert.equal(ui.elements().some((element) => element.props["aria-label"] === "返回上一个图谱视图"), false);
  assert.ok(ui.names().includes("已更新的概念"));
});

test("Alt-left only backtracks within the graph and never consumes text editing or an active drag", () => {
  const ui = mount(chain(), {}, true); ui.search("概念 4");
  let consumed = 0;
  const run = (target) => {
    const root = ui.find((element) => element.props["data-layout"]);
    root.props.onKeyDownCapture(event({ key: "ArrowLeft", altKey: true, target, preventDefault() { consumed++; } })); ui.render();
  };
  run({ closest: () => ({ tagName: "INPUT" }) });
  assert.equal(consumed, 0);
  ui.label("可交互知识网络").props.onPointerDown(event()); ui.render();
  run({}); assert.equal(consumed, 0);
  cancelBy(ui, "Escape"); run({});
  assert.equal(consumed, 1);
  assert.equal(ui.controls().some((control) => control.props["aria-pressed"]), false);
  const before = ui.camera();
  run(ui.canvas);
  canvasEvent(ui, "onKeyDown", { key: "ArrowLeft", altKey: true, preventDefault() { consumed++; } });
  assert.equal(consumed, 1, "capture and bubble both leave browser navigation alone without history");
  assert.equal(ui.camera(), before);
});

test("repeating an already centered search adds no empty return steps, while recentering after a pan does", () => {
  const ui = mount(chain(20), {}, true);
  const initial = ui.camera();
  for (let i = 0; i < 4; i++) ui.search("概念 12");
  ui.click(ui.label("返回上一个图谱视图"));
  assert.equal(ui.camera(), initial);
  assert.equal(ui.elements().some((element) => element.props["aria-label"] === "返回上一个图谱视图"), false);
  ui.search("概念 12"); canvasEvent(ui, "onKeyDown", { key: "ArrowRight" });
  const panned = ui.camera();
  ui.search("概念 12"); ui.click(ui.label("返回上一个图谱视图"));
  assert.equal(ui.camera(), panned);
  ui.inspect("概念 12"); ui.click(ui.button("编辑"));
  assert.equal(ui.label("返回上一个图谱视图").props.disabled, true, "draft editing has an explicit disabled Back state");
});
