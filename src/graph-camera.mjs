import { fitLearningGraph } from './learning-graph-layout.mjs';

export const readableGraphScale = 12 / 13;

/** A fitted overview is useful, but it must not be the unreadable first visit. */
export function readingGraphCamera(nodes, width, height, options = {}, focusId) {
  const fitted = fitLearningGraph(nodes, width, height, options);
  if (fitted.k >= readableGraphScale || !nodes.length) return fitted;
  // An ID's lexical order carries no learning meaning. When several independent
  // roots exist, start with the one covering the largest visible branch.
  const branchSizes = new Map();
  for (const node of nodes) branchSizes.set(node.rootId, (branchSizes.get(node.rootId) || 0) + 1);
  const roots = nodes.filter(node => node.isRoot).sort((a, b) =>
    (branchSizes.get(b.id) || 0) - (branchSizes.get(a.id) || 0) || b.degree - a.degree);
  const focus = nodes.find(node => node.id === focusId) || roots[0] || nodes[0];
  const k = readableGraphScale;
  return { k, x: width / 2 - (focus.x + (focus.bounds.left + focus.bounds.right) / 2) * k,
    y: ((options.top || 0) + height - (options.bottom || 0)) / 2 - focus.y * k };
}

/** The world point beneath the cursor remains beneath it at any zoom. */
export function zoomGraphCamera(camera, factor, x, y) {
  const k = Math.max(.01, Math.min(3.5, camera.k * factor));
  return { k, x: x - (x - camera.x) * k / camera.k, y: y - (y - camera.y) * k / camera.k };
}

export function resizeGraphCamera(camera, previous, next) {
  return { ...camera, x: camera.x + (next.width - previous.width) / 2,
    y: camera.y + (next.height - previous.height) / 2 };
}
