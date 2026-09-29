import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConceptRelations } from '../src/graph-relations.mjs';

const concept = (id, links = []) => ({ id, name: id, links });
const summarized = result => result.groups.map(({ id, label, concepts }) => ({ id, label, ids: concepts.map(c => c.id) }));

test('a prerequisite chain distinguishes direct earlier and later concepts without transitive additions', () => {
  const concepts = [concept('a'), concept('b', ['a']), concept('c', ['b']), concept('d', ['c'])];
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'b')), [
    { id: 'prerequisite', label: '直接先修', ids: ['a'] },
    { id: 'dependent', label: '直接后续', ids: ['c'] },
  ]);
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'a')), [
    { id: 'dependent', label: '直接后续', ids: ['b'] },
  ], 'incoming references are found even when the active concept stores no links');
});

test('a three-concept directed cycle is mutual, with outside prerequisites and successors still directional', () => {
  const concepts = [concept('a', ['c', 'earlier']), concept('b', ['a']), concept('c', ['b']), concept('earlier'), concept('later', ['a'])];
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'a')), [
    { id: 'prerequisite', label: '直接先修', ids: ['earlier'] },
    { id: 'mutual', label: '相互关联', ids: ['b', 'c'] },
    { id: 'dependent', label: '直接后续', ids: ['later'] },
  ]);
});

test('indirect members of a longer cycle are not introduced as direct relations', () => {
  const concepts = [concept('a', ['d']), concept('b', ['a']), concept('c', ['b']), concept('d', ['c'])];
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'a')), [
    { id: 'mutual', label: '相互关联', ids: ['b', 'd'] },
  ]);
});

test('conversation graphs show undirected associations with no prerequisite claims', () => {
  const concepts = [concept('a', ['b']), concept('b'), concept('c', ['a']), concept('d', ['c'])];
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'a', 'related')), [
    { id: 'related', label: '关联概念', ids: ['b', 'c'] },
  ]);
  assert.deepEqual(summarized(buildConceptRelations([concept('a', ['b']), concept('b', ['a'])], 'a', 'related')), [
    { id: 'related', label: '关联概念', ids: ['b'] },
  ]);
});

test('self loops, invalid targets, duplicate links and duplicate records do not create extra relations', () => {
  const concepts = [concept('a', ['a', 'missing', 'b', 'b']), concept('b'), concept('c', ['a', 'a']), concept('a', ['c'])];
  assert.deepEqual(summarized(buildConceptRelations(concepts, 'a')), [
    { id: 'prerequisite', label: '直接先修', ids: ['b'] },
    { id: 'dependent', label: '直接后续', ids: ['c'] },
  ], 'first record wins, matching the layout topology');
  assert.deepEqual(buildConceptRelations([concept('a', ['a', 'missing'])], 'a'), { groups: [] });
  assert.deepEqual(buildConceptRelations(concepts, 'missing'), { groups: [] });
  assert.deepEqual(buildConceptRelations([], 'a'), { groups: [] });
});

test('relation analysis retains original records and input order without mutating frozen input', () => {
  const concepts = [concept('a', ['c', 'b']), concept('b'), concept('c')];
  const before = structuredClone(concepts);
  for (const item of concepts) { Object.freeze(item.links); Object.freeze(item); }
  Object.freeze(concepts);
  const result = buildConceptRelations(concepts, 'a');
  assert.deepEqual(concepts, before);
  assert.deepEqual(result.groups[0].concepts, [concepts[1], concepts[2]]);
  assert.equal(result.groups[0].concepts[0], concepts[1]);
});

test('long prerequisite chains use iterative reachability and preserve direct-only results', () => {
  const concepts = Array.from({ length: 15000 }, (_, i) => concept(String(i), i ? [String(i - 1)] : []));
  assert.deepEqual(summarized(buildConceptRelations(concepts, '7500')), [
    { id: 'prerequisite', label: '直接先修', ids: ['7499'] },
    { id: 'dependent', label: '直接后续', ids: ['7501'] },
  ]);
});
