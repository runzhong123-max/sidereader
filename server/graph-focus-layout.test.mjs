import test from 'node:test';
import assert from 'node:assert/strict';
import { relaxLearningNeighborhood } from '../src/graph-focus-layout.mjs';

const node = (id, x = 0, y = 0, long = false) => ({ id, name: long ? `这是具有很长中文名称的概念（${id}）` : id,
  x, y, r: 5, degree: 0, depth: 0, rootId: 'a', componentId: id, layer: 0, isRoot: false, childIds: [], side: 0,
  label: { x: 12, y: long ? -38 : -9, width: long ? 210 : 90, height: long ? 76 : 18,
    lines: long ? ['这是具有很长中文名称的', `概念（${id}）`] : [id], fontSize: 13, lineHeight: 19 },
  bounds: { left: -7, top: long ? -41 : -12, right: long ? 256 : 136, bottom: long ? 41 : 12 },
});
const graph = (nodes, connections) => ({ mode: 'network', relationKind: 'related', nodes,
  edges: connections.map(([source, target]) => ({ key: JSON.stringify([source, target]), source, target, relationKind: 'related', tree: false, cycle: false })),
  roots: nodes.length ? [nodes[0].id] : [], components: [], maxDepth: 0, pinConflicts: [] });
const positions = nodes => Object.fromEntries(nodes.map(({ id, x, y }) => [id, { x, y }]));
const rect = n => ({ left: n.x + n.bounds.left, right: n.x + n.bounds.right, top: n.y + n.bounds.top, bottom: n.y + n.bounds.bottom });
const hasGap = (a, b, gap = 43.9) => {
  const x = rect(a), y = rect(b);
  return x.right + gap <= y.left || y.right + gap <= x.left || x.bottom + gap <= y.top || y.bottom + gap <= x.top;
};
const assertMovableClear = (nodes, movable) => {
  for (const a of nodes.filter(n => movable.has(n.id))) for (const b of nodes) if (a.id !== b.id)
    assert.ok(hasGap(a, b), `point and complete label bounds retain breathing room: ${a.id}/${b.id}`);
};

test('focus relaxation moves only the requested undirected 1/2/3-hop neighborhood', () => {
  const base = graph(Array.from({ length: 7 }, (_, i) => node(String(i), i * 180, i % 2 * 50)),
    [['1', '0'], ['1', '2'], ['2', '3'], ['4', '3'], ['4', '5'], ['5', '6']]);
  for (const depth of [1, 2, 3]) {
    const result = relaxLearningNeighborhood(base, '0', depth);
    assert.deepEqual(positions(result.filter(n => n.id === '0' || Number(n.id) > depth)),
      positions(base.nodes.filter(n => n.id === '0' || Number(n.id) > depth)), 'focal point and outside geography remain exact');
    assertMovableClear(result, new Set(Array.from({ length: depth }, (_, i) => String(i + 1))));
  }
});

test('already readable branches retain their exact positions instead of being pulled farther away', () => {
  const base = graph([node('a'), node('b', 380, 0), node('c', -380, 0), node('d', 0, 320)], [['a', 'b'], ['a', 'c'], ['a', 'd']]);
  const result = relaxLearningNeighborhood(base, 'a', 1);
  for (const item of result.slice(1)) {
    const original = base.nodes.find(n => n.id === item.id);
    assert.equal(item.x, original.x);
    assert.equal(item.y, original.y);
  }
  assertMovableClear(result, new Set(['b', 'c', 'd']));
});

test('crowded neighborhoods gain absolute clearance and repeated focus changes do not accumulate expansion', () => {
  const base = graph([node('a'), node('b', 159), node('c', 318)], [['a', 'b'], ['b', 'c']]);
  let current = { ...base, nodes: relaxLearningNeighborhood(base, 'a', 1) };
  assert.ok(hasGap(current.nodes[0], current.nodes[1]));
  for (const id of ['b', 'c', 'a']) current = { ...current, nodes: relaxLearningNeighborhood(current, id, 2) };
  const settled = structuredClone(current.nodes);
  for (let iteration = 0; iteration < 10; iteration++) for (const id of ['a', 'b', 'c']) {
    const focusBefore = current.nodes.find(n => n.id === id);
    current = { ...current, nodes: relaxLearningNeighborhood(current, id, 2) };
    assert.deepEqual(positions([current.nodes.find(n => n.id === id)]), positions([focusBefore]), 'the point just clicked stays anchored');
    assert.deepEqual(current.nodes, settled, '30 further focus changes do not inflate or wander the settled neighborhood');
  }
  assertMovableClear(settled, new Set(['a', 'b', 'c']));
});

test('cycles and coincident long labels separate as complete node units without mutation', () => {
  const base = graph([node('a', 0, 0, true), node('b', 0, 0, true), node('c', 0, 0, true), node('outside', 450, 0, true)],
    [['a', 'b'], ['b', 'c'], ['c', 'a']]);
  const original = structuredClone(base), result = relaxLearningNeighborhood(base, 'a', 3);
  assert.deepEqual(base, original);
  assert.deepEqual(result.map(n => n.id), base.nodes.map(n => n.id));
  assert.deepEqual(result.map(n => n.label), base.nodes.map(n => n.label));
  assert.deepEqual(result.map(n => n.bounds), base.nodes.map(n => n.bounds));
  assert.deepEqual(positions(result.filter(n => ['a', 'outside'].includes(n.id))), positions(base.nodes.filter(n => ['a', 'outside'].includes(n.id))));
  assertMovableClear(result, new Set(['b', 'c']));
  assert.deepEqual(relaxLearningNeighborhood(base, 'a', 3), result, 'no random drift across repeated focus');
});

test('dense 100-concept neighborhoods remain finite, deterministic and collision-free', () => {
  const nodes = Array.from({ length: 100 }, (_, i) => node(`n${String(i).padStart(3, '0')}`, i % 4 * 5, i % 7 * 4, true));
  const links = nodes.slice(1).map(n => ['n000', n.id]);
  const base = graph(nodes, links), before = JSON.stringify(base);
  const result = relaxLearningNeighborhood(base, 'n000', 1);
  assert.equal(JSON.stringify(base), before);
  assert.equal(result.length, 100);
  assert.ok(result.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.deepEqual(positions([result[0]]), positions([base.nodes[0]]));
  assertMovableClear(result, new Set(nodes.slice(1).map(n => n.id)));
  assert.deepEqual(positions(relaxLearningNeighborhood({ ...base, nodes: [...base.nodes].reverse(), edges: [...base.edges].reverse() }, 'n000', 1)), positions(result),
    'stable identity and original geography, not input order, determine the layout');
});

test('fixed outside collisions are preserved, while highlighted nodes find free space around them', () => {
  const base = graph([node('a'), node('b', 5, 5), node('fixed-one', 10, 10), node('fixed-two', 10, 10)], [['a', 'b']]);
  const result = relaxLearningNeighborhood(base, 'a', 1);
  assert.deepEqual(positions(result.filter(n => n.id !== 'b')), positions(base.nodes.filter(n => n.id !== 'b')));
  assertMovableClear(result, new Set(['b']));
});

test('isolated and missing focus are no-ops and depth is safely bounded', () => {
  const base = graph([node('a'), node('b', 500, 0)], []);
  for (const focus of ['a', 'missing']) {
    const result = relaxLearningNeighborhood(base, focus, 3);
    assert.deepEqual(result, base.nodes);
    assert.notEqual(result, base.nodes);
  }
  const chain = graph(Array.from({ length: 5 }, (_, i) => node(String(i), i * 250)), [['0', '1'], ['1', '2'], ['2', '3'], ['3', '4']]);
  assert.deepEqual(relaxLearningNeighborhood(chain, '0', 99), relaxLearningNeighborhood(chain, '0', 3));
  assert.deepEqual(relaxLearningNeighborhood(chain, '0', NaN), relaxLearningNeighborhood(chain, '0', 1));
});
