import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
} from "d3-force";
export function graphData(concepts) {
  const ids = new Set(concepts.map((c) => c.id)),
    neighbors = new Map(concepts.map((c) => [c.id, new Set()])),
    seen = new Set(),
    edges = [];
  for (const c of concepts)
    for (const id of c.links || []) {
      if (!ids.has(id) || id === c.id) continue;
      const key = [c.id, id].sort().join("\u0000");
      neighbors.get(c.id).add(id);
      neighbors.get(id).add(c.id);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: c.id, target: id, key });
    }
  return { edges, neighbors };
}
export function neighborhood(neighbors, id, depth = 1) {
  const result = new Set(id ? [id] : []);
  let frontier = [id];
  for (let i = 0; i < depth; i++) {
    const next = [];
    for (const node of frontier)
      for (const neighbor of neighbors.get(node) || [])
        if (!result.has(neighbor)) {
          result.add(neighbor);
          next.push(neighbor);
        }
    frontier = next;
  }
  return result;
}
export function layoutGraph(concepts, spread = 150) {
  const { edges, neighbors } = graphData(concepts);
  const nodes = concepts.map((c) => ({
    id: c.id,
    name: c.name,
    degree: neighbors.get(c.id).size,
    r: 4 + Math.sqrt(neighbors.get(c.id).size) * 2.1,
    ...(Number.isFinite(c.layout?.x) && Number.isFinite(c.layout?.y)
      ? { x: c.layout.x, y: c.layout.y, fx: c.layout.x, fy: c.layout.y }
      : {}),
  }));
  // Settle deterministically; no permanent animation loop in background Safari.
  const simulation = forceSimulation(nodes)
    .stop()
    .force("charge", forceManyBody().strength(-spread * 5))
    .force("x", forceX(0).strength(0.045))
    .force("y", forceY(0).strength(0.065))
    .force(
      "link",
      forceLink(edges.map((e) => ({ ...e })))
        .id((n) => n.id)
        .distance(115)
        .strength(0.45),
    )
    .force("center", forceCenter(0, 0).strength(0.07))
    .force(
      "collide",
      forceCollide((n) =>
        Math.max(30, Math.min(92, n.name.length * 5.7 + 12)),
      ).iterations(2),
    );
  simulation.tick(concepts.length > 150 ? 130 : 240);
  simulation.stop();
  return nodes.map(({ id, x, y, r, degree }) => ({ id, x, y, r, degree }));
}
export function fitGraph(nodes, width, height, padding = 65) {
  if (!nodes.length) return { x: width / 2, y: height / 2, k: 1 };
  const xs = nodes.map((n) => n.x),
    ys = nodes.map((n) => n.y),
    left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const k = Math.min(
    1.6,
    Math.max(
      0.15,
      Math.min(
        (width - padding * 2) / Math.max(160, right - left + 100),
        (height - padding * 2) / Math.max(160, bottom - top + 75),
      ),
    ),
  );
  return {
    x: width / 2 - ((left + right) * k) / 2,
    y: height / 2 - ((top + bottom) * k) / 2,
    k,
  };
}

const characterWidth = (character, fontSize) => fontSize * (/^[\x00-\x7f]$/.test(character) ? /[il.,' ]/.test(character) ? 0.34 : 0.65 : 1.05);
const textWidth = (text, fontSize) => Array.from(text).reduce((width, character) => width + characterWidth(character, fontSize), 0);
const openingPunctuation = /^[([{（［｛《〈【〔「『“‘]$/u;
const closingPunctuation = /^[)\]}）］｝》〉】〕」』”’，。！？；：、,.!?;:%％…]$/u;
const wordCharacter = /^[A-Za-z0-9_.+-]$/u;

function labelBreakAllowed(characters, index, keepWords) {
  let beforeIndex = index - 1, afterIndex = index;
  while (beforeIndex >= 0 && /\s/u.test(characters[beforeIndex])) beforeIndex--;
  while (afterIndex < characters.length && /\s/u.test(characters[afterIndex])) afterIndex++;
  const before = characters[beforeIndex], after = characters[afterIndex];
  return !openingPunctuation.test(before) && !closingPunctuation.test(after)
    && !(keepWords && beforeIndex === index - 1 && afterIndex === index && wordCharacter.test(before) && wordCharacter.test(after));
}

/** Wrap labels without truncating a concept name. Estimates are deliberately a
 * little wider than the rendered font so adjacent labels retain breathing room. */
export function graphLabelLines(name, maxWidth = 128, fontSize = 12) {
  const characters = Array.from(name), lines = [];
  let start = 0;
  while (start < characters.length) {
    while (start < characters.length && /\s/u.test(characters[start])) start++;
    if (start === characters.length) break;
    let end = start, width = 0;
    while (end < characters.length && (end === start || width + characterWidth(characters[end], fontSize) <= maxWidth)) {
      width += characterWidth(characters[end], fontSize);
      end++;
    }
    if (end < characters.length) {
      // Move a short acronym and its parentheses together. For a word longer
      // than the available width, split the word but still keep punctuation
      // attached. The resulting line widths feed the screen-space collision
      // solver, so repairing punctuation never overflows an unmeasured box.
      let boundary;
      for (const keepWords of [true, false]) {
        for (let candidate = end; candidate > start; candidate--) {
          if (labelBreakAllowed(characters, candidate, keepWords)) { boundary = candidate; break; }
        }
        if (boundary !== undefined) break;
      }
      end = boundary ?? end;
    }
    const line = characters.slice(start, end).join("").trim();
    if (line) lines.push(line);
    start = end;
  }
  return lines.length ? lines : [name];
}

const overlapArea = (a, b, gap = 0) => Math.max(0, Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2) + gap)
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + gap);

function labelGeometry(name, maxWidth, fontSize) {
  const lines = graphLabelLines(name, maxWidth, fontSize);
  return { lines, width: Math.max(...lines.map((line) => textWidth(line, fontSize))) + 10,
    height: lines.length * (fontSize + 4) + 4 };
}

function connectLabel(label) {
  const desiredY = label.nodeY + label.radius + 7;
  return { ...label, leader: Math.hypot(label.x - label.nodeX, label.y - desiredY) > 12 ? {
    x: Math.max(label.x - label.width / 2, Math.min(label.x + label.width / 2, label.nodeX)),
    y: Math.max(label.y, Math.min(label.y + label.height, label.nodeY)),
  } : undefined };
}

/** Dense, small windows need to fill contiguous free rectangles rather than
 * accumulate unusable gaps around the first few labels. Keep every dot reserved
 * and every label at its normal font size; only their screen positions change. */
function packLabelRectangles(labels, width, top, bottom, order) {
  let free = [{ x: 10, y: top, width: width - 20, height: bottom - top }];
  const result = [];
  function reserve(used) {
    const next = [];
    for (const rectangle of free) {
      const right = rectangle.x + rectangle.width, lower = rectangle.y + rectangle.height;
      if (used.x >= right || used.x + used.width <= rectangle.x || used.y >= lower || used.y + used.height <= rectangle.y) {
        next.push(rectangle); continue;
      }
      if (used.x > rectangle.x) next.push({ ...rectangle, width: used.x - rectangle.x });
      if (used.x + used.width < right) next.push({ ...rectangle, x: used.x + used.width, width: right - used.x - used.width });
      if (used.y > rectangle.y) next.push({ ...rectangle, height: used.y - rectangle.y });
      if (used.y + used.height < lower) next.push({ ...rectangle, y: used.y + used.height, height: lower - used.y - used.height });
    }
    free = next.filter((rectangle, index) => !next.some((other, otherIndex) => otherIndex !== index
      && other.x <= rectangle.x && other.y <= rectangle.y
      && other.x + other.width >= rectangle.x + rectangle.width && other.y + other.height >= rectangle.y + rectangle.height
      && (other.x !== rectangle.x || other.y !== rectangle.y || other.width !== rectangle.width || other.height !== rectangle.height || otherIndex < index)));
  }
  for (const label of labels) reserve({ x: label.nodeX - label.radius - 1, y: label.nodeY - label.radius - 1,
    width: (label.radius + 1) * 2, height: (label.radius + 1) * 2 });
  const compare = order === "width" ? (a, b) => b.width - a.width || b.height - a.height
    : order === "height" ? (a, b) => b.height - a.height || b.width - a.width
    : (a, b) => b.width * b.height - a.width * a.height;
  for (const label of [...labels].sort((a, b) => compare(a, b) || a.id.localeCompare(b.id))) {
    // Geometry already includes ten horizontal and four vertical padding pixels.
    // A further two-pixel gap keeps distinct click targets apart when packed.
    const boxWidth = label.width + 2, boxHeight = label.height + 2;
    let best, bestScore = Infinity;
    for (const rectangle of free) {
      if (boxWidth > rectangle.width || boxHeight > rectangle.height) continue;
      const shortSide = Math.min(rectangle.width - boxWidth, rectangle.height - boxHeight);
      const longSide = Math.max(rectangle.width - boxWidth, rectangle.height - boxHeight);
      for (const x of [rectangle.x, rectangle.x + rectangle.width - boxWidth])
        for (const y of [rectangle.y, rectangle.y + rectangle.height - boxHeight]) {
          const distance = (x + boxWidth / 2 - label.nodeX) ** 2 + (y + 1 - label.nodeY - label.radius - 7) ** 2;
          const score = shortSide * 1e10 + longSide * 1e7 + distance;
          if (score < bestScore) { best = { x, y, width: boxWidth, height: boxHeight }; bestScore = score; }
        }
    }
    if (!best) return undefined;
    reserve(best);
    result.push(connectLabel({ ...label, x: best.x + boxWidth / 2, y: best.y + 1 }));
  }
  return result;
}

/** Labels are 12/13 CSS pixels even when the world is zoomed out. Pack their
 * actual screen rectangles, not the world's shrinking node collision radii.
 * Only labels move: persisted/manual node positions and graph topology stay put. */
export function placeGraphLabels(nodes, camera, width, height, options = {}) {
  const top = options.top ?? 12, bottom = Math.max(top + 30, height - (options.bottom ?? 46));
  const labels = nodes.map((node) => {
    const fontSize = node.degree > 3 ? 13 : 12;
    const radius = node.r * Math.sqrt(camera.k);
    return {
      id: node.id, nodeX: node.x * camera.k + camera.x, nodeY: node.y * camera.k + camera.y,
      fontSize, lineHeight: fontSize + 4, radius,
      ...labelGeometry(node.name, Math.min(128, Math.max(72, width / 4)), fontSize),
      degree: node.degree,
    };
  });
  const visible = labels.filter((label) => label.nodeX >= 0 && label.nodeX <= width && label.nodeY >= 0 && label.nodeY <= height);
  const obstacles = visible.map((label) => ({ x: label.nodeX, y: label.nodeY - label.radius - 3, width: (label.radius + 3) * 2, height: (label.radius + 3) * 2 }));
  const placed = [];
  const output = new Map();
  // Give well-connected and larger labels first choice without relying on the
  // incoming array order. Repeated layouts, panning and dragging are deterministic.
  for (const label of [...visible].sort((a, b) => b.degree - a.degree || b.width * b.height - a.width * a.height || a.id.localeCompare(b.id))) {
    const minX = label.width / 2 + 10, maxX = Math.max(minX, width - label.width / 2 - 10);
    const maxY = Math.max(top, bottom - label.height);
    const desired = { x: label.nodeX, y: label.nodeY + label.radius + 7 };
    const candidates = [
      desired,
      { x: label.nodeX, y: label.nodeY - label.radius - label.height - 7 },
      { x: label.nodeX + label.width / 2 + label.radius + 8, y: label.nodeY - label.height / 2 },
      { x: label.nodeX - label.width / 2 - label.radius - 8, y: label.nodeY - label.height / 2 },
    ];
    // A viewport grid is the fallback for crowded clusters. It never drops a
    // label or shrinks its type, and keeps every visible label independently hitable.
    for (let y = top; y <= maxY; y += 12)
      for (let x = minX; x <= maxX; x += 18) candidates.push({ x, y });
    const occupied = [...placed, ...obstacles];
    let best, bestScore = Infinity;
    for (const candidate of candidates) {
      const box = { ...label, x: Math.max(minX, Math.min(maxX, candidate.x)), y: Math.max(top, Math.min(maxY, candidate.y)) };
      const collision = occupied.reduce((area, other) => area + overlapArea(box, other, 5), 0);
      const distance = (box.x - desired.x) ** 2 + (box.y - desired.y) ** 2;
      const score = collision * 100000 + distance;
      if (score < bestScore) { best = box; bestScore = score; }
    }
    best = connectLabel(best);
    placed.push(best);
    output.set(label.id, best);
  }
  if (placed.some((label, index) => placed.slice(index + 1).some((other) => overlapArea(label, other) > 0))) {
    const names = new Map(nodes.map((node) => [node.id, node.name]));
    // Slightly longer lines reclaim height in a narrow pane without reducing
    // the text size. Try bounded alternatives only when the nearby layout fails.
    for (const maxWidth of [96, 112, 128]) {
      const measured = visible.map((label) => ({ ...label, ...labelGeometry(names.get(label.id), Math.min(maxWidth, width - 20), label.fontSize) }));
      let packed;
      for (const order of ["area", "width", "height"]) {
        packed = packLabelRectangles(measured, width, top, bottom, order);
        if (packed) break;
      }
      if (!packed) continue;
      for (const label of packed) output.set(label.id, label);
      break;
    }
  }
  // Offscreen labels follow their dots naturally; do not pile them onto the edge
  // when the reader deliberately pans or zooms in.
  for (const label of labels) if (!output.has(label.id)) output.set(label.id, { ...label, x: label.nodeX, y: label.nodeY + label.radius + 7 });
  return output;
}
