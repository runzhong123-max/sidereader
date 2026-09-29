const compareIds = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const SPACE = 44;
const EPSILON = .05;
const cloneNode = node => ({ ...node, childIds: [...node.childIds], label: { ...node.label, lines: [...node.label.lines] }, bounds: { ...node.bounds } });
const rectangle = node => ({ left: node.x + node.bounds.left, right: node.x + node.bounds.right, top: node.y + node.bounds.top, bottom: node.y + node.bounds.bottom });
const intersects = (a, b) => a.left < b.right + SPACE - EPSILON && a.right > b.left - SPACE + EPSILON
  && a.top < b.bottom + SPACE - EPSILON && a.bottom > b.top - SPACE + EPSILON;

function neighborhood(graph, focusId, depth) {
  const neighbors = new Map(graph.nodes.map(node => [node.id, new Set()]));
  for (const edge of graph.edges) {
    if (!neighbors.has(edge.source) || !neighbors.has(edge.target)) continue;
    neighbors.get(edge.source).add(edge.target);
    neighbors.get(edge.target).add(edge.source);
  }
  const distance = new Map([[focusId, 0]]), queue = [focusId];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor], nextDepth = distance.get(id) + 1;
    if (nextDepth > depth) continue;
    for (const next of [...neighbors.get(id)].sort(compareIds)) if (!distance.has(next)) {
      distance.set(next, nextDepth); queue.push(next);
    }
  }
  return distance;
}

function angleForId(id) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return hash / 0x100000000 * Math.PI * 2;
}

/** Find a nearby vacancy instead of detaching a label from its point. Candidate
 * coordinates come from existing rectangle boundaries, so a free outer position
 * always exists even when the fixed surroundings leave no local vacancy. */
function findVacancy(node, target, obstacles, focus, originalAngle) {
  const clear = position => {
    const bounds = rectangle({ ...node, ...position });
    return !obstacles.some(obstacle => intersects(bounds, obstacle));
  };
  if (clear(target)) return target;
  const candidates = [];
  for (const obstacle of obstacles) {
    const left = obstacle.left - SPACE - node.bounds.right - EPSILON;
    const right = obstacle.right + SPACE - node.bounds.left + EPSILON;
    const top = obstacle.top - SPACE - node.bounds.bottom - EPSILON;
    const bottom = obstacle.bottom + SPACE - node.bounds.top + EPSILON;
    candidates.push({ x: left, y: target.y }, { x: right, y: target.y },
      { x: target.x, y: top }, { x: target.x, y: bottom },
      { x: left, y: top }, { x: left, y: bottom }, { x: right, y: top }, { x: right, y: bottom });
  }
  const score = point => {
    const displacement = Math.hypot(point.x - target.x, point.y - target.y);
    // Preserve the branch's side when equally near vacancies exist. The penalty
    // remains small: an impassable fixed obstacle may require changing direction.
    const angle = Math.atan2(point.y - focus.y, point.x - focus.x);
    return displacement + (1 - Math.cos(angle - originalAngle)) * 24;
  };
  candidates.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
  return candidates.find(clear) || target;
}

/** Temporary, deterministic focus layout. Only the requested undirected
 * neighborhood moves; the focal point and every outside point keep their exact
 * world coordinates. The caller can restore graph.nodes to recover the base view.
 * Existing collisions between two fixed outside nodes are intentionally untouched.
 */
export function relaxLearningNeighborhood(graph, focusId, depth) {
  const nodes = graph.nodes.map(cloneNode), focus = nodes.find(node => node.id === focusId);
  if (!focus) return nodes;
  const distance = neighborhood(graph, focusId, Math.max(1, Math.min(3, Math.floor(Number.isFinite(depth) ? depth : 1))));
  const movable = nodes.filter(node => node.id !== focusId && distance.has(node.id));
  if (!movable.length) return nodes;
  const obstacles = nodes.filter(node => node.id === focusId || !distance.has(node.id)).map(rectangle);
  const targets = new Map(movable.map(node => {
    const dx = node.x - focus.x, dy = node.y - focus.y, length = Math.hypot(dx, dy);
    const angle = length > .001 ? Math.atan2(dy, dx) : angleForId(node.id);
    // Absolute clearance, not dilation: already readable neighborhoods stay put.
    // This makes repeated A → B → A focus changes idempotent once space exists.
    return [node.id, { x: node.x, y: node.y, angle, length }];
  }));
  // Near neighbors reserve space first. Sorting by stable identity, not input
  // order, makes the same highlighted subgraph produce the same result.
  movable.sort((a, b) => distance.get(a.id) - distance.get(b.id)
    || targets.get(a.id).length - targets.get(b.id).length || compareIds(a.id, b.id));
  for (const node of movable) {
    const target = targets.get(node.id), position = findVacancy(node, target, obstacles, focus, target.angle);
    node.x = position.x; node.y = position.y;
    obstacles.push(rectangle(node));
  }
  return nodes;
}
