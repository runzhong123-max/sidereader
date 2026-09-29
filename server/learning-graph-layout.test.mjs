import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningGraph, fitLearningGraph, learningGraphBounds, learningEdgePath } from '../src/learning-graph-layout.mjs';

// Same vocabulary/size as the user's real chapter, with explicit prerequisite
// links for the fixture rather than a fabricated ordering of chapter headings.
const chapter = [
  ['basic', '线性模型基本形式', []],
  ['regression', '线性回归', ['basic']],
  ['least', '最小二乘法', ['regression']],
  ['multi', '多元线性回归', ['regression']],
  ['regular', '正则化', ['multi']],
  ['loglinear', '对数线性回归', ['regression']],
  ['general', '广义线性模型', ['regression']],
  ['sigmoid', '对数几率函数', ['basic']],
  ['logistic', '对数几率回归', ['sigmoid']],
  ['mle', '对数几率回归的极大似然估计', ['logistic']],
  ['lda', '线性判别分析（LDA）', ['basic']],
  ['scatter', '类内与类间散度矩阵', ['lda']],
  ['multilda', '多分类 LDA 与监督降维', ['scatter']],
  ['multiclass', '多分类学习与拆解法', ['basic']],
  ['ov', '一对一（OvO）与一对其余（OvR）', ['multiclass']],
  ['ecoc', '纠错输出码（ECOC）', ['multiclass']],
  ['imbalance', '类别不平衡', ['basic']],
  ['rescale', '再缩放', ['imbalance']],
  ['sampling', '欠采样、过采样与阈值移动', ['imbalance']],
  ['cost', '代价敏感学习', ['imbalance']],
].map(([id, name, links]) => ({ id, name, links }));
const modes = ['core', 'layers', 'network'];
const box = node => ({ left: node.x + node.bounds.left, right: node.x + node.bounds.right, top: node.y + node.bounds.top, bottom: node.y + node.bounds.bottom });
const intersect = (a, b) => a.left < b.right - .01 && b.left < a.right - .01 && a.top < b.bottom - .01 && b.top < a.bottom - .01;
function assertGeometry(graph) {
  assert.ok(graph.nodes.every(node => [node.x, node.y, node.r, node.depth, node.layer].every(Number.isFinite)));
  for (const node of graph.nodes) {
    assert.ok(Math.abs(node.label.x - node.r - 7) < 1e-9, 'dot and label are one unit with a fixed 7px gap');
    assert.equal(node.label.y + node.label.height / 2, 0, 'label vertically centered on its dot');
    assert.equal(node.label.lines.join('').replaceAll(' ', ''), node.name.replaceAll(' ', ''));
    if (graph.mode === 'core') assert.ok(node.bounds.right >= node.label.x + node.label.width + 32, 'expansion controls have reserved space');
    else assert.equal(node.bounds.right - node.label.x - node.label.width < 5, true, 'non-expandable modes keep edge anchors close to text');
  }
  for (let i = 0; i < graph.nodes.length; i++) for (let j = i + 1; j < graph.nodes.length; j++)
    assert.equal(intersect(box(graph.nodes[i]), box(graph.nodes[j])), false, `${graph.mode}: ${graph.nodes[i].id} overlaps ${graph.nodes[j].id}`);
}

for (const mode of modes) test(`${mode}: long chapter labels remain attached and full node bounds do not overlap`, () => {
  const before = structuredClone(chapter), graph = buildLearningGraph(chapter, { mode });
  assertGeometry(graph);
  assert.deepEqual(chapter, before);
  assert.deepEqual(graph, buildLearningGraph(chapter, { mode }), 'layout is deterministic');
  assert.deepEqual(graph, buildLearningGraph([...chapter].reverse(), { mode }), 'input order does not invent a learning sequence');
  assert.equal(graph.nodes.length, 20);
  assert.deepEqual(graph.roots, ['basic']);
  assert.ok(graph.nodes.find(node => node.id === 'basic').childIds.length >= 4);
  for (const edge of graph.edges) assert.ok(chapter.find(node => node.id === edge.target).links.includes(edge.source), 'prerequisite points toward its dependent');
});

test('core forest has balanced left/right branches, stable parent links and real cross edges', () => {
  const graph = buildLearningGraph([...chapter, { id: 'cross', name: '联合应用', links: ['scatter', 'mle'] }]);
  assertGeometry(graph);
  assert.ok(graph.nodes.some(node => node.side === -1) && graph.nodes.some(node => node.side === 1));
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  for (const node of graph.nodes) if (node.parentId) {
    assert.equal(node.depth, nodes.get(node.parentId).depth + 1);
    assert.ok(graph.edges.some(edge => edge.tree && ((edge.source === node.id && edge.target === node.parentId) || (edge.target === node.id && edge.source === node.parentId))));
  }
  assert.equal(graph.edges.filter(edge => edge.target === 'cross').length, 2);
  assert.equal(graph.edges.filter(edge => edge.target === 'cross' && edge.tree).length, 1);
  // Collapsing is only a filter. Hidden descendants never trigger a fresh layout.
  const collapsed = graph.nodes.filter(node => node.depth <= 1), complete = buildLearningGraph([...chapter, { id: 'cross', name: '联合应用', links: ['scatter', 'mle'] }]);
  for (const node of collapsed) assert.deepEqual(node, complete.nodes.find(candidate => candidate.id === node.id));
});

const cycles = [
  { id: 'a', name: '基础 A', links: ['b', 'b', 'missing'] },
  { id: 'b', name: '基础 B', links: ['a'] },
  { id: 'c', name: '应用 C', links: ['a', 'd'] },
  { id: 'd', name: '独立基础 D', links: [] },
  { id: 'e', name: '独立概念 E', links: [] },
  { id: 'self', name: '自循环记录', links: ['self'] },
];
for (const mode of modes) test(`${mode}: cycles, multiple roots, disconnected concepts and self links remain explicit`, () => {
  const graph = buildLearningGraph(cycles, { mode });
  assertGeometry(graph);
  assert.equal(graph.nodes.length, cycles.length);
  assert.equal(graph.edges.length, 5);
  assert.equal(graph.edges.filter(edge => edge.cycle).length, 3, 'both directions in the SCC plus self loop are preserved');
  assert.deepEqual(graph.components.find(component => component.nodeIds.includes('a')).nodeIds, ['a', 'b']);
  assert.ok(graph.roots.includes('d') && graph.roots.includes('e') && graph.roots.includes('self'));
  if (mode === 'layers') {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    for (const edge of graph.edges) {
      const source = nodes.get(edge.source), target = nodes.get(edge.target);
      if (source.componentId === target.componentId) assert.equal(source.layer, target.layer);
      else assert.ok(source.layer < target.layer && source.x < target.x);
    }
  }
});

for (const mode of modes) test(`${mode}: related graphs preserve associations without pretending they are prerequisites`, () => {
  const concepts = [{ id: 'a', name: '核心', links: ['b', 'c', 'd'] }, { id: 'b', name: '关联一', links: ['a'] }, { id: 'c', name: '关联二', links: [] }, { id: 'd', name: '关联三', links: [] }, { id: 'e', name: '独立概念', links: [] }];
  const graph = buildLearningGraph(concepts, { mode, relationKind: 'related' });
  assertGeometry(graph);
  assert.deepEqual(graph.roots, ['a', 'e']);
  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.every(edge => edge.relationKind === 'related' && !edge.cycle));
  assert.ok(graph.components.every(component => !component.cyclic), 'undirected associations are not circular prerequisites');
  assert.equal(graph.nodes.find(node => node.id === 'b').depth, 1);
});

test('explicit exploration start changes traversal, never prerequisite direction or stored data', () => {
  const graph = buildLearningGraph(chapter, { rootId: 'logistic' });
  assertGeometry(graph);
  assert.deepEqual(graph.roots, ['logistic']);
  assert.equal(graph.nodes.find(node => node.id === 'logistic').depth, 0);
  assert.equal(graph.nodes.find(node => node.id === 'sigmoid').depth, 1);
  assert.ok(graph.edges.some(edge => edge.source === 'sigmoid' && edge.target === 'logistic'));
  assert.equal(graph.nodes.length, chapter.length);
});

for (const mode of modes) test(`${mode}: 100 concepts have finite nonoverlapping geometry`, () => {
  const input = Array.from({ length: 100 }, (_, index) => ({ id: `n${String(index).padStart(3, '0')}`, name: `知识概念 ${index}：条件与边界的详细说明`, links: index ? [`n${String(Math.floor((index - 1) / 3)).padStart(3, '0')}`] : [] }));
  const graph = buildLearningGraph(input, { mode });
  assertGeometry(graph);
  assert.equal(graph.nodes.length, 100);
  assert.equal(graph.edges.length, 99);
});

for (const mode of modes) test(`${mode}: fitting includes complete text/control bounds in narrow and wide viewports`, () => {
  const graph = buildLearningGraph(chapter, { mode });
  for (const [width, height] of [[320, 360], [620, 500], [1200, 720]]) {
    for (const nodes of [graph.nodes, graph.nodes.filter(node => node.depth <= 1)]) {
      const camera = fitLearningGraph(nodes, width, height, { top: 54, bottom: 60, padding: 18 });
      assert.ok(camera.k > 0 && camera.k <= 1);
      for (const node of nodes) {
        const bounds = box(node);
        assert.ok(bounds.left * camera.k + camera.x >= 18 - .001);
        assert.ok(bounds.right * camera.k + camera.x <= width - 18 + .001);
        assert.ok(bounds.top * camera.k + camera.y >= 72 - .001);
        assert.ok(bounds.bottom * camera.k + camera.y <= height - 78 + .001);
      }
    }
  }
});

test('fit can go below 15 percent for very large topology and keeps empty dimensions finite', () => {
  const input = Array.from({ length: 100 }, (_, index) => ({ id: String(index), name: `很长的连续先修概念 ${index}`, links: index ? [String(index - 1)] : [] }));
  const graph = buildLearningGraph(input, { mode: 'layers' });
  const camera = fitLearningGraph(graph.nodes, 320, 360);
  assert.ok(camera.k < .15);
  assert.equal(learningGraphBounds([]).width, 0);
  assert.ok(Object.values(fitLearningGraph([], 0, 0)).every(Number.isFinite));
});

test('network pins are opt-in and conflicts are reported without displacing labels', () => {
  const input = [{ id: 'a', name: 'A', links: [], layout: { x: 0, y: 0 } }, { id: 'b', name: 'B', links: ['a'], layout: { x: 0, y: 0 } }, { id: 'c', name: 'C', links: ['b'], layout: { x: 500, y: 400 } }];
  for (const mode of ['core', 'layers']) assertGeometry(buildLearningGraph(input, { mode, usePins: true }));
  assertGeometry(buildLearningGraph(input, { mode: 'network' }));
  const pinned = buildLearningGraph(input, { mode: 'network', usePins: true });
  assert.deepEqual(pinned.pinConflicts, [['a', 'b']]);
  for (const node of pinned.nodes) {
    assert.equal(node.x, input.find(concept => concept.id === node.id).layout.x);
    assert.equal(node.y, input.find(concept => concept.id === node.id).layout.y);
    assert.ok(Math.abs(node.label.x - node.r - 7) < 1e-9);
  }
});

test('edge paths connect whole-node boundaries and tolerate missing endpoints', () => {
  const graph = buildLearningGraph(cycles);
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    const path = learningEdgePath(edge, byId);
    assert.match(path, /^M .+ C /);
    assert.doesNotMatch(path, /NaN|Infinity/);
    assert.equal(path, learningEdgePath(edge, graph.nodes));
  }
  assert.equal(learningEdgePath({ source: 'missing', target: 'a' }, byId), '');
});

function sampledPath(path) {
  const tokens = path.match(/[MLCQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) || [], result = [];
  let index = 0, x = 0, y = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') { x = Number(tokens[index++]); y = Number(tokens[index++]); result.push({ x, y }); continue; }
    const length = command === 'C' ? 6 : command === 'Q' ? 4 : 2;
    const values = tokens.slice(index, index + length).map(Number); index += length;
    const startX = x, startY = y;
    const endX = values.at(-2), endY = values.at(-1);
    const steps = Math.max(40, Math.ceil(Math.hypot(endX - startX, endY - startY) / 3));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps, u = 1 - t;
      if (command === 'C') result.push({ x: u ** 3 * startX + 3 * u * u * t * values[0] + 3 * u * t * t * values[2] + t ** 3 * endX,
        y: u ** 3 * startY + 3 * u * u * t * values[1] + 3 * u * t * t * values[3] + t ** 3 * endY });
      else if (command === 'Q') result.push({ x: u * u * startX + 2 * u * t * values[0] + t * t * endX,
        y: u * u * startY + 2 * u * t * values[1] + t * t * endY });
      else result.push({ x: startX + (endX - startX) * t, y: startY + (endY - startY) * t });
    }
    x = endX; y = endY;
  }
  return result;
}
function assertNoEdgeOverLabels(graph) {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    const path = learningEdgePath(edge, byId);
    assert.doesNotMatch(path, /NaN|Infinity/);
    assert.equal(learningEdgePath(edge, byId), path, 'cached route remains stable through pan/zoom');
    const points = sampledPath(path);
    for (const node of graph.nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      assert.equal(points.some(point => point.x > node.x + node.label.x && point.x < node.x + node.label.x + node.label.width
        && point.y > node.y + node.label.y && point.y < node.y + node.label.y + node.label.height), false,
      `${graph.mode} edge ${edge.source}→${edge.target} crosses ${node.id}'s label`);
    }
  }
}
for (const mode of modes) test(`${mode}: chapter edge paths do not cross unrelated concept labels`, () => {
  assertNoEdgeOverLabels(buildLearningGraph(chapter, { mode }));
});

test('dense random graphs reroute long edges and cycles around full text bounds', () => {
  let seed = 5; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const mode of modes) for (let trial = 0; trial < 5; trial++) {
    const concepts = Array.from({ length: 20 }, (_, index) => ({ id: String(index), name: `概念${index}及长中文测试名称`,
      links: Array.from({ length: Math.floor(random() * 4) }, () => String(Math.floor(random() * 20))) }));
    assertNoEdgeOverLabels(buildLearningGraph(concepts, { mode }));
  }
});

test('100-node graph routing avoids labels and remains finite at full expansion', () => {
  const concepts = Array.from({ length: 100 }, (_, index) => ({ id: `n${index}`, name: `学习概念 ${index} 及其范围和条件`,
    links: index ? [`n${Math.floor((index - 1) / 3)}`, ...(index > 3 && index % 7 === 0 ? [`n${index - 3}`] : [])] : [] }));
  for (const mode of modes) assertNoEdgeOverLabels(buildLearningGraph(concepts, { mode }));
});
