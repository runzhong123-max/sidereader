import { forceSimulation, forceManyBody, forceLink, forceX, forceY } from 'd3-force';
import { graphLabelLines } from './graph-layout.mjs';

const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const characterWidth = (character, fontSize) => fontSize * (/^[\x00-\x7f]$/.test(character) ? /[il.,' ]/.test(character) ? 0.34 : 0.65 : 1.05);
const textWidth = (text, fontSize) => Array.from(text).reduce((width, character) => width + characterWidth(character, fontSize), 0);
const uniqueSorted = (values) => [...new Set(values)].sort(compareIds);

function topology(concepts, relationKind) {
  // Sorting makes identical stored concepts independent of rendering/filter order.
  const records = new Map();
  for (const concept of concepts) if (concept?.id && !records.has(concept.id)) records.set(concept.id, concept);
  const ids = [...records.keys()].sort(compareIds);
  const incoming = new Map(ids.map(id => [id, new Set()]));
  const outgoing = new Map(ids.map(id => [id, new Set()]));
  const neighbors = new Map(ids.map(id => [id, new Set()]));
  const edges = [], seen = new Set();
  for (const id of ids) for (const link of records.get(id).links || []) {
    if (!records.has(link)) continue;
    // Persisted chapter links point to prerequisites, so their visual direction
    // is reversed. Conversation graph links are associations without direction.
    const [source, target] = relationKind === 'related' ? [id, link].sort(compareIds) : [link, id];
    const key = JSON.stringify([source, target]);
    if (seen.has(key)) continue;
    seen.add(key);
    outgoing.get(source).add(target); incoming.get(target).add(source);
    neighbors.get(source).add(target); neighbors.get(target).add(source);
    if (relationKind === 'related') { outgoing.get(target).add(source); incoming.get(source).add(target); }
    edges.push({ key, source, target, relationKind, tree: false, cycle: false });
  }
  edges.sort((a, b) => compareIds(a.key, b.key));
  return { records, ids, incoming, outgoing, neighbors, edges };
}

function stronglyConnected(ids, outgoing) {
  // Iterative Kosaraju avoids a recursion limit on a long prerequisite chain.
  const visited = new Set(), order = [];
  for (const start of ids) {
    if (visited.has(start)) continue;
    const stack = [[start, false]];
    while (stack.length) {
      const [id, finishing] = stack.pop();
      if (finishing) { order.push(id); continue; }
      if (visited.has(id)) continue;
      visited.add(id); stack.push([id, true]);
      for (const child of [...outgoing.get(id)].sort(compareIds).reverse()) if (!visited.has(child)) stack.push([child, false]);
    }
  }
  const reverse = new Map(ids.map(id => [id, []]));
  for (const id of ids) for (const next of outgoing.get(id)) reverse.get(next).push(id);
  const assigned = new Set(), components = [], componentFor = new Map();
  for (const start of order.reverse()) {
    if (assigned.has(start)) continue;
    const nodeIds = [], stack = [start]; assigned.add(start);
    while (stack.length) {
      const id = stack.pop(); nodeIds.push(id);
      for (const parent of reverse.get(id)) if (!assigned.has(parent)) { assigned.add(parent); stack.push(parent); }
    }
    nodeIds.sort(compareIds);
    const component = { id: nodeIds[0], nodeIds, cyclic: nodeIds.length > 1 || outgoing.get(nodeIds[0]).has(nodeIds[0]), layer: 0 };
    components.push(component);
    for (const id of nodeIds) componentFor.set(id, component.id);
  }
  components.sort((a, b) => compareIds(a.id, b.id));
  const byId = new Map(components.map(component => [component.id, component]));
  const incoming = new Map(components.map(component => [component.id, new Set()]));
  const outgoingComponents = new Map(components.map(component => [component.id, new Set()]));
  for (const id of ids) for (const next of outgoing.get(id)) {
    const source = componentFor.get(id), target = componentFor.get(next);
    if (source !== target) { outgoingComponents.get(source).add(target); incoming.get(target).add(source); }
  }
  const remaining = new Map(components.map(component => [component.id, incoming.get(component.id).size]));
  const queue = components.filter(component => !remaining.get(component.id)).map(component => component.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    for (const next of [...outgoingComponents.get(id)].sort(compareIds)) {
      byId.get(next).layer = Math.max(byId.get(next).layer, byId.get(id).layer + 1);
      remaining.set(next, remaining.get(next) - 1);
      if (!remaining.get(next)) queue.push(next);
    }
  }
  return { components, componentFor, incoming, outgoing: outgoingComponents };
}

function traversal(data, scc, rootId, relationKind) {
  const { ids, outgoing, neighbors } = data;
  const rank = (a, b) => outgoing.get(b).size - outgoing.get(a).size || neighbors.get(b).size - neighbors.get(a).size || compareIds(a, b);
  const roots = [], parents = new Map(), depth = new Map(), rootFor = new Map();
  const candidates = [];
  if (data.records.has(rootId)) candidates.push(rootId);
  if (relationKind === 'prerequisite') {
    candidates.push(...scc.components.filter(component => !scc.incoming.get(component.id).size)
      .map(component => [...component.nodeIds].sort(rank)[0]).sort(rank));
  } else candidates.push(...[...ids].sort(rank));
  // Seed all source components before BFS, so shared applications cannot swallow
  // another independent source. An explicit start instead explores its connected
  // component in both directions, without changing an edge's true semantics.
  const queue = [];
  const seed = id => {
    if (depth.has(id)) return;
    roots.push(id); depth.set(id, 0); rootFor.set(id, id); queue.push(id);
  };
  const drain = undirected => {
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor];
      const nextIds = [...(undirected ? neighbors : outgoing).get(id)].sort(rank);
      for (const next of nextIds) if (!depth.has(next)) {
        depth.set(next, depth.get(id) + 1); parents.set(next, id); rootFor.set(next, rootFor.get(id)); queue.push(next);
      }
    }
    queue.length = 0;
  };
  if (data.records.has(rootId)) { seed(rootId); drain(true); }
  if (relationKind === 'prerequisite') { for (const id of candidates) seed(id); drain(false); }
  else for (const id of candidates) { if (depth.has(id)) continue; seed(id); drain(true); }
  // Defensive completion for malformed/disconnected data, including self loops.
  for (const id of ids) if (!depth.has(id)) { seed(id); drain(relationKind === 'related'); }
  const children = new Map(ids.map(id => [id, []]));
  for (const [child, parent] of parents) children.get(parent).push(child);
  for (const list of children.values()) list.sort(rank);
  return { roots, parents, depth, rootFor, children };
}

function makeNodes(data, scc, tree, mode) {
  const components = new Map(scc.components.map(component => [component.id, component]));
  return data.ids.map(id => {
    const concept = data.records.get(id), isRoot = !tree.parents.has(id);
    const degree = [...data.neighbors.get(id)].filter(neighbor => neighbor !== id).length;
    const fontSize = isRoot ? 14 : 13, lineHeight = fontSize + 5;
    const lines = graphLabelLines(String(concept.name || id), 156, fontSize);
    const width = Math.max(1, ...lines.map(line => textWidth(line, fontSize))) + 2;
    const height = lines.length * lineHeight;
    const r = isRoot ? 6 : Math.min(5.5, 4 + Math.sqrt(degree) * .4);
    const label = { x: r + 7, y: -height / 2, width, height, lines, fontSize, lineHeight };
    return { id, name: String(concept.name || id), x: 0, y: 0, r, degree,
      depth: tree.depth.get(id), parentId: tree.parents.get(id), rootId: tree.rootFor.get(id),
      componentId: scc.componentFor.get(id), layer: components.get(scc.componentFor.get(id)).layer,
      isRoot, childIds: tree.children.get(id), side: 0, label,
      bounds: { left: -r - 2, top: Math.min(-r - 2, label.y - 3), right: label.x + width + (mode === 'core' ? 34 : 4), bottom: Math.max(r + 2, label.y + height + 3) } };
  });
}

const nodeHeight = node => node.bounds.bottom - node.bounds.top;
const nodeWidth = node => node.bounds.right - node.bounds.left;

function coreLayout(nodes, roots, spread) {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const rowGap = 24 * spread, columnGap = 58 * spread, forestGap = 86 * spread;
  const heights = new Map();
  // Reverse depth order permits long chains without recursive layout calls.
  for (const node of [...nodes].sort((a, b) => b.depth - a.depth || compareIds(a.id, b.id))) {
    const children = node.childIds.map(id => byId.get(id));
    const childrenHeight = children.reduce((sum, child) => sum + heights.get(child.id), 0) + Math.max(0, children.length - 1) * rowGap;
    heights.set(node.id, Math.max(nodeHeight(node), childrenHeight));
  }
  let forestTop = 0;
  for (const rootId of roots) {
    const root = byId.get(rootId), sides = { '-1': [], '1': [] }, sideHeights = { '-1': 0, '1': 0 };
    for (const id of root.childIds) {
      const side = sideHeights[1] <= sideHeights[-1] ? 1 : -1;
      sides[side].push(id); sideHeights[side] += heights.get(id) + (sides[side].length > 1 ? rowGap : 0);
    }
    const height = Math.max(nodeHeight(root), sideHeights[-1], sideHeights[1]);
    root.x = -(root.bounds.left + root.bounds.right) / 2;
    root.y = forestTop + height / 2;
    const widths = { '-1': new Map(), '1': new Map() };
    for (const side of [-1, 1]) {
      const queue = [...sides[side]];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const node = byId.get(queue[cursor]); node.side = side;
        widths[side].set(node.depth, Math.max(widths[side].get(node.depth) || 0, nodeWidth(node)));
        queue.push(...node.childIds);
      }
    }
    const columns = { '-1': new Map(), '1': new Map() };
    for (const side of [-1, 1]) {
      let boundary = root.x + (side === 1 ? root.bounds.right : root.bounds.left);
      for (const depth of [...widths[side].keys()].sort((a, b) => a - b)) {
        boundary += side * columnGap;
        columns[side].set(depth, boundary);
        boundary += side * widths[side].get(depth);
      }
      const queue = [{ childIds: sides[side], y: root.y }];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const group = queue[cursor];
        const groupHeight = group.childIds.reduce((sum, id) => sum + heights.get(id), 0) + Math.max(0, group.childIds.length - 1) * rowGap;
        let top = group.y - groupHeight / 2;
        for (const id of group.childIds) {
          const node = byId.get(id);
          node.x = columns[side].get(node.depth) - (side === 1 ? node.bounds.left : node.bounds.right);
          node.y = top + heights.get(id) / 2;
          top += heights.get(id) + rowGap;
          queue.push({ childIds: node.childIds, y: node.y });
        }
      }
    }
    forestTop += height + forestGap;
  }
  const center = nodes.length ? (Math.min(...nodes.map(node => node.y + node.bounds.top)) + Math.max(...nodes.map(node => node.y + node.bounds.bottom))) / 2 : 0;
  for (const node of nodes) node.y -= center;
}

function layeredLayout(nodes, data, relationKind, spread) {
  const rowGap = 24 * spread, columnGap = 66 * spread;
  const layers = new Map();
  for (const node of nodes) {
    if (relationKind === 'related') node.layer = node.depth;
    if (!layers.has(node.layer)) layers.set(node.layer, []);
    layers.get(node.layer).push(node);
  }
  const indices = [...layers.keys()].sort((a, b) => a - b), positions = new Map();
  for (const list of layers.values()) list.sort((a, b) => compareIds(a.componentId, b.componentId) || compareIds(a.id, b.id));
  const updatePositions = () => { for (const list of layers.values()) list.forEach((node, index) => positions.set(node.id, index)); };
  updatePositions();
  // Barycentric sweeps reduce crossings while treating SCC members as a block.
  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0;
    for (const layer of forward ? indices : [...indices].reverse()) {
      const list = layers.get(layer), groups = new Map();
      for (const node of list) {
        const groupId = relationKind === 'related' ? node.id : node.componentId;
        if (!groups.has(groupId)) groups.set(groupId, []);
        groups.get(groupId).push(node);
      }
      const score = group => {
        const values = group.flatMap(node => [...(forward ? data.incoming : data.outgoing).get(node.id)]
          .filter(id => !group.some(member => member.id === id)).map(id => positions.get(id)));
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length
          : group.reduce((sum, node) => sum + positions.get(node.id), 0) / group.length;
      };
      layers.set(layer, [...groups.values()].sort((a, b) => score(a) - score(b) || compareIds(a[0].id, b[0].id)).flat());
      updatePositions();
    }
  }
  let left = 0;
  for (const layer of indices) {
    const list = layers.get(layer), width = Math.max(...list.map(nodeWidth));
    const height = list.reduce((sum, node) => sum + nodeHeight(node), 0) + Math.max(0, list.length - 1) * rowGap;
    let top = -height / 2;
    for (const node of list) {
      node.x = left - node.bounds.left; node.y = top - node.bounds.top;
      top += nodeHeight(node) + rowGap;
    }
    left += width + columnGap;
  }
  for (const node of nodes) node.x -= (left - columnGap) / 2;
}

function overlap(a, b, gap = 0) {
  const ax = a.x + (a.bounds.left + a.bounds.right) / 2, ay = a.y + (a.bounds.top + a.bounds.bottom) / 2;
  const bx = b.x + (b.bounds.left + b.bounds.right) / 2, by = b.y + (b.bounds.top + b.bounds.bottom) / 2;
  return { dx: ax - bx, dy: ay - by, x: (nodeWidth(a) + nodeWidth(b)) / 2 + gap - Math.abs(ax - bx),
    y: (nodeHeight(a) + nodeHeight(b)) / 2 + gap - Math.abs(ay - by) };
}

function separateRectangles(nodes, gap, rounds) {
  for (let pass = 0; pass < rounds; pass++) {
    let collisions = 0;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], intersection = overlap(a, b, gap);
      if (intersection.x <= .01 || intersection.y <= .01 || (a.fx !== undefined && b.fx !== undefined)) continue;
      collisions++;
      const fixedA = a.fx !== undefined, fixedB = b.fx !== undefined;
      const axis = intersection.x < intersection.y ? 'x' : 'y';
      const delta = (axis === 'x' ? intersection.dx : intersection.dy) || (i % 2 ? -1 : 1);
      const shift = intersection[axis] + .05;
      a[axis] += fixedA ? 0 : Math.sign(delta) * shift * (fixedB ? 1 : .5);
      b[axis] -= fixedB ? 0 : Math.sign(delta) * shift * (fixedA ? 1 : .5);
    }
    if (!collisions) break;
  }
}

function networkLayout(nodes, data, roots, spread, usePins) {
  coreLayout(nodes, roots, Math.max(.65, spread * .7));
  for (const node of nodes) {
    const pin = data.records.get(node.id).layout;
    if (usePins && Number.isFinite(pin?.x) && Number.isFinite(pin?.y)) { node.fx = pin.x; node.fy = pin.y; node.x = pin.x; node.y = pin.y; }
  }
  const simulation = forceSimulation(nodes).stop()
    .force('charge', forceManyBody().strength(-620 * spread))
    .force('link', forceLink(data.edges.filter(edge => edge.source !== edge.target).map(edge => ({ ...edge })))
      .id(node => node.id).distance(link => (nodeWidth(link.source) + nodeWidth(link.target)) / 2 + 75 * spread).strength(.24))
    .force('x', forceX(0).strength(.025)).force('y', forceY(0).strength(.045));
  for (let tick = 0; tick < 240; tick++) { simulation.tick(); separateRectangles(nodes, 16 * spread, 2); }
  simulation.stop();
  separateRectangles(nodes, 16 * spread, 320);
  const pinConflicts = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], intersection = overlap(a, b);
    if (a.fx !== undefined && b.fx !== undefined && intersection.x > 0 && intersection.y > 0) pinConflicts.push([a.id, b.id]);
  }
  for (const node of nodes) { delete node.vx; delete node.vy; delete node.index; delete node.fx; delete node.fy; }
  return pinConflicts;
}

/** Layout the full topology once. Filtering nodes later preserves spatial memory;
 * label geometry belongs to the node and must be transformed with the same camera. */
export function buildLearningGraph(concepts, options = {}) {
  const mode = ['core', 'layers', 'network'].includes(options.mode) ? options.mode : 'core';
  const relationKind = options.relationKind === 'related' ? 'related' : 'prerequisite';
  const spread = Math.max(.65, Math.min(2, finite(options.spread, 1)));
  const data = topology(concepts, relationKind), scc = stronglyConnected(data.ids, data.outgoing);
  if (relationKind === 'related') for (const component of scc.components) component.cyclic = false;
  const tree = traversal(data, scc, options.rootId, relationKind), nodes = makeNodes(data, scc, tree, mode);
  for (const edge of data.edges) {
    edge.tree = tree.parents.get(edge.target) === edge.source || tree.parents.get(edge.source) === edge.target;
    edge.cycle = relationKind === 'prerequisite' && scc.componentFor.get(edge.source) === scc.componentFor.get(edge.target);
  }
  let pinConflicts = [];
  if (mode === 'network') pinConflicts = networkLayout(nodes, data, tree.roots, spread, options.usePins === true);
  else if (mode === 'layers') layeredLayout(nodes, data, relationKind, spread);
  else coreLayout(nodes, tree.roots, spread);
  return { mode, relationKind, nodes, edges: data.edges, roots: tree.roots, components: scc.components,
    maxDepth: Math.max(0, ...nodes.map(node => node.depth)), pinConflicts };
}

/** Bounds include the full name and expand/collapse affordance, not just dots. */
export function learningGraphBounds(nodes) {
  if (!nodes.length) return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const left = Math.min(...nodes.map(node => node.x + node.bounds.left));
  const right = Math.max(...nodes.map(node => node.x + node.bounds.right));
  const top = Math.min(...nodes.map(node => node.y + node.bounds.top));
  const bottom = Math.max(...nodes.map(node => node.y + node.bounds.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function fitLearningGraph(nodes, width, height, options = {}) {
  width = Math.max(1, finite(width, 1)); height = Math.max(1, finite(height, 1));
  const padding = Math.max(0, finite(options.padding, 28));
  const top = Math.max(0, finite(options.top, 0)), bottom = Math.max(0, finite(options.bottom, 0));
  const availableWidth = Math.max(1, width - padding * 2), availableHeight = Math.max(1, height - top - bottom - padding * 2);
  const centerX = width / 2, centerY = top + padding + availableHeight / 2;
  if (!nodes.length) return { x: centerX, y: centerY, k: 1 };
  const bounds = learningGraphBounds(nodes);
  const k = Math.max(Number.EPSILON, Math.min(Math.max(.01, finite(options.maxScale, 1)), availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)));
  return { x: centerX - (bounds.left + bounds.right) * k / 2, y: centerY - (bounds.top + bounds.bottom) * k / 2, k };
}

/** A rectangle boundary connection avoids drawing lines through a concept name.
 * Consumers may style tree/cross/cycle edges separately without inventing links. */
function directEdgePath(edge, nodesById) {
  const source = nodesById instanceof Map ? nodesById.get(edge.source) : nodesById.find(node => node.id === edge.source);
  const target = nodesById instanceof Map ? nodesById.get(edge.target) : nodesById.find(node => node.id === edge.target);
  if (!source || !target) return '';
  if (source.id === target.id) {
    const x = source.x - source.r, y = source.y;
    return `M ${x} ${y} C ${x - 38} ${y - 42}, ${x - 38} ${y + 42}, ${x} ${y + 4}`;
  }
  const center = node => ({ x: node.x + (node.bounds.left + node.bounds.right) / 2, y: node.y });
  const a = center(source), b = center(target), dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) >= Math.abs(dy) * .6) {
    const right = dx >= 0;
    const x1 = source.x + (right ? source.bounds.right + 2 : source.bounds.left - 2);
    const x2 = target.x + (right ? target.bounds.left - 2 : target.bounds.right + 2);
    const bend = Math.max(20, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
    return `M ${x1} ${source.y} C ${x1 + bend} ${source.y}, ${x2 - bend} ${target.y}, ${x2} ${target.y}`;
  }
  const down = dy >= 0;
  const y1 = source.y + (down ? source.bounds.bottom + 2 : source.bounds.top - 2);
  const y2 = target.y + (down ? target.bounds.top - 2 : target.bounds.bottom + 2);
  const bend = Math.max(20, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
  return `M ${a.x} ${y1} C ${a.x} ${y1 + bend}, ${b.x} ${y2 - bend}, ${b.x} ${y2}`;
}

const edgeRouteCache = new WeakMap();
const routingMargin = 8;
function routeContext(nodesById) {
  let cached = edgeRouteCache.get(nodesById);
  if (cached) return cached;
  const nodes = nodesById instanceof Map ? [...nodesById.values()] : nodesById;
  const rectangles = nodes.map(node => ({ id: node.id,
    left: node.x + node.bounds.left - routingMargin, right: node.x + node.bounds.right + routingMargin,
    top: node.y + node.bounds.top - routingMargin, bottom: node.y + node.bounds.bottom + routingMargin,
    cx: node.x + (node.bounds.left + node.bounds.right) / 2, cy: node.y }));
  cached = { nodes, rectangles, paths: new Map(), grid: undefined };
  edgeRouteCache.set(nodesById, cached);
  return cached;
}

function segmentHitsRectangle(a, b, rectangle) {
  // Liang–Barsky clipping against a slightly open rectangle. Touching an outer
  // routing boundary is valid; entering the protected name is not.
  const epsilon = .05;
  const left = rectangle.left + epsilon, right = rectangle.right - epsilon;
  const top = rectangle.top + epsilon, bottom = rectangle.bottom - epsilon;
  const dx = b.x - a.x, dy = b.y - a.y;
  let lower = 0, upper = 1;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
    if (Math.abs(p) < 1e-10) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lower = Math.max(lower, t); else upper = Math.min(upper, t);
    if (lower > upper) return false;
  }
  return true;
}

function directPathClear(path, rectangles, edge) {
  const coordinates = path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)?.map(Number);
  if (!coordinates || coordinates.length !== 8) return false;
  const [x0, y0, x1, y1, x2, y2, x3, y3] = coordinates;
  // Cubic flatness subdivision bounds approximation error to 1 world pixel.
  // Obstacles have an 8px reserve, so the visible line cannot graze a label.
  const segments = [];
  const split = (a, b, c, d, depth) => {
    const deviation = Math.max(Math.abs(3 * b.x - 2 * a.x - d.x), Math.abs(3 * c.x - 2 * d.x - a.x),
      Math.abs(3 * b.y - 2 * a.y - d.y), Math.abs(3 * c.y - 2 * d.y - a.y));
    if (deviation < 2 || depth > 10) { segments.push([a, d]); return; }
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const ab = mid(a, b), bc = mid(b, c), cd = mid(c, d), abc = mid(ab, bc), bcd = mid(bc, cd), center = mid(abc, bcd);
    split(a, ab, abc, center, depth + 1); split(center, bcd, cd, d, depth + 1);
  };
  split({ x: x0, y: y0 }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x: x3, y: y3 }, 0);
  return !rectangles.some(rectangle => rectangle.id !== edge.source && rectangle.id !== edge.target
    && segments.some(([a, b]) => segmentHitsRectangle(a, b, rectangle)));
}

function makeRoutingGrid(context) {
  if (context.grid) return context.grid;
  const { rectangles } = context;
  const xValues = rectangles.flatMap(rectangle => [rectangle.left, rectangle.right, rectangle.cx]);
  const yValues = rectangles.flatMap(rectangle => [rectangle.top, rectangle.bottom, rectangle.cy]);
  xValues.push(Math.min(...xValues) - 30, Math.max(...xValues) + 30);
  yValues.push(Math.min(...yValues) - 30, Math.max(...yValues) + 30);
  const xs = [...new Set(xValues)].sort((a, b) => a - b), ys = [...new Set(yValues)].sort((a, b) => a - b);
  const xIndex = new Map(xs.map((x, index) => [x, index])), yIndex = new Map(ys.map((y, index) => [y, index]));
  const width = xs.length, height = ys.length, blocked = new Uint8Array(width * height);
  // Every obstacle's center is also a grid line. A horizontal/vertical edge
  // cannot jump across a rectangle between two unoccupied boundary vertices.
  for (const rectangle of rectangles) {
    const left = xIndex.get(rectangle.left), right = xIndex.get(rectangle.right);
    const top = yIndex.get(rectangle.top), bottom = yIndex.get(rectangle.bottom);
    for (let row = top + 1; row < bottom; row++) blocked.fill(1, row * width + left + 1, row * width + right);
  }
  context.grid = { xs, ys, xIndex, yIndex, width, height, blocked };
  return context.grid;
}

function ports(rectangle, grid) {
  const point = (x, y, actualX, actualY, axis) => ({ x, y, actual: { x: actualX, y: actualY }, axis,
    cell: grid.yIndex.get(y) * grid.width + grid.xIndex.get(x) });
  return [
    point(rectangle.left, rectangle.cy, rectangle.left + routingMargin - 2, rectangle.cy, 1),
    point(rectangle.right, rectangle.cy, rectangle.right - routingMargin + 2, rectangle.cy, 1),
    point(rectangle.cx, rectangle.top, rectangle.cx, rectangle.top + routingMargin - 2, 2),
    point(rectangle.cx, rectangle.bottom, rectangle.cx, rectangle.bottom - routingMargin + 2, 2),
  ];
}

class RouteHeap {
  items = [];
  push(item) {
    let index = this.items.length; this.items.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent]; index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    const first = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score) child++;
        if (this.items[child].score >= last.score) break;
        this.items[index] = this.items[child]; index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

function simpleOrthogonalRoute(context, edge) {
  if (edge.source === edge.target) return null;
  const source = context.rectangles.find(rectangle => rectangle.id === edge.source), target = context.rectangles.find(rectangle => rectangle.id === edge.target);
  if (!source || !target) return null;
  const endpoints = rectangle => [
    { x: rectangle.left, y: rectangle.cy, actual: { x: rectangle.left + routingMargin - 2, y: rectangle.cy } },
    { x: rectangle.right, y: rectangle.cy, actual: { x: rectangle.right - routingMargin + 2, y: rectangle.cy } },
    { x: rectangle.cx, y: rectangle.top, actual: { x: rectangle.cx, y: rectangle.top + routingMargin - 2 } },
    { x: rectangle.cx, y: rectangle.bottom, actual: { x: rectangle.cx, y: rectangle.bottom - routingMargin + 2 } },
  ];
  const candidates = [];
  for (const start of endpoints(source)) for (const end of endpoints(target)) {
    const middleX = (start.x + end.x) / 2, middleY = (start.y + end.y) / 2;
    for (const turns of [[{ x: start.x, y: end.y }], [{ x: end.x, y: start.y }],
      [{ x: middleX, y: start.y }, { x: middleX, y: end.y }], [{ x: start.x, y: middleY }, { x: end.x, y: middleY }]]) {
      const points = [start.actual, start, ...turns, end, end.actual].filter((point, index, all) => !index || Math.hypot(point.x - all[index - 1].x, point.y - all[index - 1].y) > .001);
      const distance = points.reduce((sum, point, index) => sum + (index ? Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) : 0), 0);
      candidates.push({ points, score: distance + turns.length * 18 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates) {
    const middle = candidate.points.slice(1, -1);
    if (!context.rectangles.some(rectangle => middle.some((point, index) => index && segmentHitsRectangle(middle[index - 1], point, rectangle)))) return candidate.points;
  }
  return null;
}

function orthogonalRoute(context, edge) {
  const grid = makeRoutingGrid(context), { xs, ys, width, height, blocked } = grid;
  const source = context.rectangles.find(rectangle => rectangle.id === edge.source), target = context.rectangles.find(rectangle => rectangle.id === edge.target);
  if (!source || !target) return null;
  let starts = ports(source, grid).filter(port => !blocked[port.cell]);
  let goals = ports(target, grid).filter(port => !blocked[port.cell]);
  if (source.id === target.id) { starts = starts.slice(0, 1); goals = goals.slice(2, 3); }
  if (!starts.length || !goals.length) return null;
  const targetPorts = new Map(goals.map(port => [port.cell, port]));
  const count = width * height * 3, cost = new Float64Array(count).fill(Infinity), parent = new Int32Array(count).fill(-1);
  const origin = new Map(), heap = new RouteHeap();
  const heuristic = (x, y) => Math.min(...goals.map(goal => Math.abs(goal.x - x) + Math.abs(goal.y - y)));
  for (const port of starts) {
    const state = port.cell * 3 + port.axis;
    cost[state] = 0; origin.set(state, port); heap.push({ state, score: heuristic(port.x, port.y), cost: 0 });
  }
  let finish;
  while (heap.items.length) {
    const current = heap.pop(), state = current.state;
    if (current.cost > cost[state]) continue;
    const cell = Math.floor(state / 3), axis = state % 3, row = Math.floor(cell / width), column = cell % width;
    if (targetPorts.has(cell)) { finish = state; break; }
    const nexts = [];
    if (column > 0) nexts.push([cell - 1, 1, xs[column] - xs[column - 1]]);
    if (column + 1 < width) nexts.push([cell + 1, 1, xs[column + 1] - xs[column]]);
    if (row > 0) nexts.push([cell - width, 2, ys[row] - ys[row - 1]]);
    if (row + 1 < height) nexts.push([cell + width, 2, ys[row + 1] - ys[row]]);
    for (const [nextCell, nextAxis, distance] of nexts) {
      if (blocked[nextCell]) continue;
      const nextState = nextCell * 3 + nextAxis, nextCost = cost[state] + distance + (axis === nextAxis ? 0 : 18);
      if (nextCost + .0001 >= cost[nextState]) continue;
      cost[nextState] = nextCost; parent[nextState] = state;
      const x = xs[nextCell % width], y = ys[Math.floor(nextCell / width)];
      heap.push({ state: nextState, cost: nextCost, score: nextCost + heuristic(x, y) });
    }
  }
  if (finish === undefined) return null;
  const points = [], goal = targetPorts.get(Math.floor(finish / 3));
  let state = finish;
  while (state !== -1) {
    const cell = Math.floor(state / 3); points.push({ x: xs[cell % width], y: ys[Math.floor(cell / width)] });
    if (parent[state] === -1) break;
    state = parent[state];
  }
  points.reverse();
  points.unshift(origin.get(state).actual); points.push(goal.actual);
  const simplified = [];
  for (const point of points) {
    const previous = simplified.at(-1), before = simplified.at(-2);
    if (previous && Math.abs(previous.x - point.x) < .001 && Math.abs(previous.y - point.y) < .001) continue;
    if (before && previous && ((Math.abs(before.x - previous.x) < .001 && Math.abs(previous.x - point.x) < .001)
      || (Math.abs(before.y - previous.y) < .001 && Math.abs(previous.y - point.y) < .001))) simplified.pop();
    simplified.push(point);
  }
  return simplified;
}

function roundedRoute(points) {
  if (!points?.length) return '';
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1], point = points[index], next = points[index + 1];
    const incoming = Math.hypot(point.x - previous.x, point.y - previous.y), outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    const radius = Math.min(3, incoming / 2, outgoing / 2);
    const a = { x: point.x + (previous.x - point.x) * radius / incoming, y: point.y + (previous.y - point.y) * radius / incoming };
    const b = { x: point.x + (next.x - point.x) * radius / outgoing, y: point.y + (next.y - point.y) * radius / outgoing };
    path += ` L ${a.x} ${a.y} Q ${point.x} ${point.y} ${b.x} ${b.y}`;
  }
  return `${path} L ${points.at(-1).x} ${points.at(-1).y}`;
}

/** Clear curves stay simple. Only obstructed edges take an orthogonal route
 * around full node rectangles; per-layout caching keeps pan/zoom inexpensive. */
export function learningEdgePath(edge, nodesById) {
  const context = routeContext(nodesById), key = JSON.stringify([edge.source, edge.target]);
  if (context.paths.has(key)) return context.paths.get(key);
  const direct = directEdgePath(edge, nodesById);
  if (!direct) return '';
  const path = directPathClear(direct, context.rectangles, edge) ? direct : roundedRoute(simpleOrthogonalRoute(context, edge) || orthogonalRoute(context, edge)) || direct;
  context.paths.set(key, path);
  return path;
}
