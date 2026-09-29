import test from "node:test";
import assert from "node:assert/strict";
import { documentForTarget, recordDocumentPosition, saveDocumentBookmark, toggleDocumentBookmark, removeDocument } from "../src/domain/documents.mjs";
import { normalizePaperTree } from "../src/paper-tree-state.mjs";
import { replaceSurfaceSets } from "../src/domain/learning-surface.mjs";

function fixture() {
  return normalizePaperTree({id:"p",version:1,name:"项目",goal:"",sources:[{id:"s",title:"原书",pages:["甲","乙","丙"],chunks:[],progress:1,outline:[{id:"chapter",title:"本章",page:1,endPage:3,level:1,kind:"chapter"}]}],
    chats:[{id:"t",title:"项目 Tutor",messages:[]},{id:"c",title:"问题",messages:[{id:"m",role:"user",content:"保持原文"}],context:{parentId:"chapter",reading:{sourceId:"s",page:1,title:"原书",quote:"甲"}}}],
    concepts:[],stages:[],sets:[{id:"a",title:"练习甲",questions:[]},{id:"b",title:"练习乙",questions:[]}],tabs:[{id:"t",kind:"chat"}],activeTab:"t",activeSource:"s",page:1,
  });
}
test("source, chapter and bookmark share document identity while progress never retargets a saved conversation",()=>{
  const project=fixture();
  const chapter=project.paperTree.nodes.find((node)=>node.role==="chapter");
  assert.equal(documentForTarget(project,{id:chapter.id,kind:"book"}).id,"s");
  const next=recordDocumentPosition(project,chapter,900);
  assert.equal(documentForTarget(next,chapter).progress,3);
  assert.equal(next.paperTree.nodes.find((node)=>node.id===chapter.id).progress,3);
  assert.deepEqual(next.chats,project.chats);
  assert.equal(project.sources[0].progress,1);
});
test("bookmark mutations preserve full excerpts and other bookmarks on the same page",()=>{
  const bookmark={id:"page",sourceId:"s",page:1,title:"原书",created:"now"};
  const text="一段很长的原文".repeat(100);
  let project=toggleDocumentBookmark(fixture(),bookmark);
  project=saveDocumentBookmark(project,{...bookmark,id:"excerpt",quote:text});
  const saved=project;
  assert.equal(saveDocumentBookmark(project,{...bookmark,id:"duplicate",quote:`  ${text}  `}),saved);
  project=toggleDocumentBookmark(project,bookmark);
  assert.deepEqual(project.bookmarks.map((item)=>item.id),["excerpt"]);
  assert.equal(project.bookmarks[0].quote,text);
  assert.equal(saveDocumentBookmark(project,{...bookmark,page:999}),project);
});
test("removing a document from a chapter view preserves learning history and selects a surviving target",()=>{
  let project=fixture();
  const chapter=project.paperTree.nodes.find((node)=>node.role==="chapter");
  project={...project,tabs:[chapter],activeTab:chapter.id};
  const next=normalizePaperTree(removeDocument(project,"s"));
  assert.equal(next.sources.length,0);
  assert.deepEqual(next.chats,project.chats);
  assert.deepEqual(next.sets,project.sets);
  assert.equal(next.activeTab,next.paperTree.tutorId);
  assert.equal(next.activeSource,"");
});
test("editing or deleting a file through a thin view reference cannot replace other practice files",()=>{
  const project=fixture();
  const node=project.paperTree.nodes.find((node)=>node.kind==="questions"&&node.objectId==="a");
  const thin={id:node.id,kind:"questions"};
  const updated=replaceSurfaceSets(project,thin,[{...project.sets[0],title:"改名"}]);
  assert.equal(updated.sets.find((set)=>set.id==="a").title,"改名");
  assert.deepEqual(updated.sets.find((set)=>set.id==="b"),project.sets[1]);
  assert.deepEqual(replaceSurfaceSets(project,thin,[]).sets,[project.sets[1]]);
});
