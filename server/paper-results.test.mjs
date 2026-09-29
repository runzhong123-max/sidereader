import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaperTree } from "../src/paper-tree-state.mjs";
import { capturePaperResults } from "../src/paper-results.mjs";
const project = () => normalizePaperTree({id:"p",name:"Study",version:1,sources:[],concepts:[],stages:[],sets:[],chats:[{id:"root",title:"Main",messages:[]},{id:"other",title:"Other",messages:[]}],tabs:[{id:"root",kind:"chat"},{id:"other",kind:"chat"}],activeTab:"other"});
test("completed outputs stay with origin without stealing focus or creating duplicate results",()=>{
  const initial=project();
  const message={id:"answer",role:"assistant",content:"```python\nprint(1)\n```",evidence:[{id:"e",sourceId:"s",page:4,title:"Book",text:"Evidence"}]};
  const result=capturePaperResults(initial,"root",[message]);
  assert.equal(result.activeTab,"other");
  assert.deepEqual(result.tabs,initial.tabs);
  assert.equal(result.papers.length,2);
  assert.ok(result.papers.every((paper)=>paper.parentId==="root" && paper.sourceMessageId==="answer"));
  assert.strictEqual(capturePaperResults(result,"root",[message]),result);
  assert.equal(initial.papers,undefined);
});
test("errors and ordinary prose do not create empty branches",()=>{
  const initial=project();
  assert.strictEqual(capturePaperResults(initial,"root",[{id:"e",role:"assistant",error:true,content:"```js\n1\n```"},{id:"a",role:"assistant",content:"A short explanation."}]),initial);
});
