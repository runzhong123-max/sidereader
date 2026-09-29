import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionToolbarPosition, sameBookmarkExcerpt } from '../src/reader-selection.mjs';
const rect = (left, top, width, height) => ({left,top,width,height,right:left+width,bottom:top+height});
const bounds = {left:300,right:1000,top:100,bottom:700};

test('selection tools follow the selected endpoint and stay inside the reading pane',()=>{
  const lines=[rect(320,120,500,20),rect(320,150,80,20)];
  assert.deepEqual(selectionToolbarPosition(lines,bounds),{left:308,top:178});
  assert.deepEqual(selectionToolbarPosition(lines,bounds,{backwards:true}),{left:446,top:148});
  assert.deepEqual(selectionToolbarPosition([rect(970,660,20,20)],bounds),{left:744,top:612});
});
test('off-screen fragments and tiny panes do not produce floating tools outside content',()=>{
  assert.equal(selectionToolbarPosition([rect(350,800,300,20)],bounds),null);
  assert.equal(selectionToolbarPosition([rect(20,20,90,20)],{left:0,right:200,top:0,bottom:400}),null);
  const position=selectionToolbarPosition([rect(320,80,300,30),rect(320,150,300,20)],bounds);
  assert.equal(position.top,178);
});
test('bookmark deduplication tolerates PDF line wraps without merging distinct excerpts',()=>{
  assert.equal(sameBookmarkExcerpt('第一段\n  文字',' 第一段 文字 '),true);
  assert.equal(sameBookmarkExcerpt('第一段文字','第二段文字'),false);
  assert.equal(sameBookmarkExcerpt(undefined,'文字'),false);
});
