import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningGraph } from '../src/learning-graph-layout.mjs';
import { readingGraphCamera, zoomGraphCamera, resizeGraphCamera } from '../src/graph-camera.mjs';
import { graphFixture } from '../qa/graph-fixtures.mjs';

test('initial graph camera preserves a readable named starting point even in a 320px window', () => {
  for (const fixture of ['chapter', 'hundred', 'disconnected', 'far-pin']) for (const mode of ['core','layers','network']) {
    const graph = buildLearningGraph(graphFixture(fixture).concepts, {mode});
    const camera = readingGraphCamera(graph.nodes, 320, 280, {top:20,bottom:70}, graph.roots[0]);
    assert.ok(graph.nodes.every(node => node.label.fontSize * camera.k >= 12));
    const root = graph.nodes.find(node => node.id === graph.roots[0]);
    assert.ok(root.x * camera.k + camera.x > 0 && root.x * camera.k + camera.x < 320);
  }
});
test('zoom keeps the cursor world point fixed even when scale limits apply', () => {
  const camera = {x:76,y:-103,k:.15}, point = {x:280,y:190};
  for (const factor of [.001,.25,1.4,100]) {
    const next = zoomGraphCamera(camera,factor,point.x,point.y);
    assert.ok(Math.abs((point.x-next.x)/next.k-(point.x-camera.x)/camera.k)<1e-8);
    assert.ok(Math.abs((point.y-next.y)/next.k-(point.y-camera.y)/camera.k)<1e-8);
  }
});
test('manual camera retains the same world center during pane resize', () => {
  const camera={x:-100,y:45,k:1.2}, previous={width:620,height:430}, next={width:1100,height:680};
  const resized=resizeGraphCamera(camera,previous,next);
  assert.equal((previous.width/2-camera.x)/camera.k,(next.width/2-resized.x)/resized.k);
  assert.equal((previous.height/2-camera.y)/camera.k,(next.height/2-resized.y)/resized.k);
});
test('the initial lens chooses the main visible component instead of the first random ID', () => {
  const graph = buildLearningGraph([
    {id:'a',name:'独立的小主题',links:[]},
    {id:'z',name:'主要分支的起点',links:[]},
    ...Array.from({length:6},(_,i)=>({id:`child-${i}`,name:`主要分支概念 ${i}`,links:['z']})),
  ], {mode:'core'});
  const largest = graph.nodes.find(node=>node.id==='z');
  const camera = readingGraphCamera(graph.nodes,320,280,{top:20,bottom:70});
  assert.equal(largest.y * camera.k + camera.y,115);
});
