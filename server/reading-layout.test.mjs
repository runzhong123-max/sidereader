import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaperTree, attachPaperNode } from "../src/paper-tree-state.mjs";
import { defaultReadingTarget, enterReadingProject, readingCompanionKey, restoreWorkspaceProject } from "../src/reading-layout.mjs";
import { ensureScopeConversation } from "../src/object-conversations.mjs";

const fixture=()=>normalizePaperTree({id:"p",name:"项目",chats:[{id:"tutor",title:"Tutor",messages:[]}],sources:[{
  id:"s",kind:"pdf",title:"PDF",pages:Array(10).fill("原文"),chunks:[],progress:8,outline:[
    {title:"一",page:1,endPage:5,level:1},{title:"二",page:6,endPage:10,level:1},
  ],
}],concepts:[],sets:[],stages:[],tabs:[{id:"tutor",kind:"chat"}],activeTab:"tutor",activeSource:"s"});

test("opening a project restores PDF without adding a chapter conversation",()=>{
  const project=fixture(),before=structuredClone(project),next=enterReadingProject(project);
  assert.equal(next.activeTab,"book:s");
  assert.equal(next.sources[0].progress,8);
  assert.deepEqual(next.chats,project.chats);
  assert.deepEqual(project,before);
  assert.deepEqual(enterReadingProject(next),next);
});

test("reopening a chapter conversation restores its chapter, not another chapter's page",()=>{
  const created=ensureScopeConversation(fixture(),"s@1:1");
  const next=enterReadingProject({...created.project,activeTab:created.nodeId});
  assert.equal(next.activeTab,"s@1:1");
  assert.equal(next.sources[0].progress,1);
  assert.equal(defaultReadingTarget(next,created.nodeId).id,"s@1:1");
});

test("derived conversation retains its original PDF chapter",()=>{
  const created=ensureScopeConversation(fixture(),"s@1:1");
  const project=attachPaperNode({...created.project,chats:[...created.project.chats,{id:"branch",title:"追问",messages:[],context:{parentId:created.nodeId,scopeNodeId:"s@1:1"}}]},
    {id:"branch",kind:"chat",parentId:created.nodeId,conversationRoot:false});
  assert.equal(defaultReadingTarget(project,"branch").id,"s@1:1");
  assert.notEqual(readingCompanionKey("p","s@1:1"),readingCompanionKey("p","s@6:1"));
});

test("legacy multiple PDFs and conversations survive reading-home selection",()=>{
  const project=fixture();
  project.sources.push({...project.sources[0],id:"other",title:"旧PDF"});
  const before=normalizePaperTree({...project,activeSource:"other"});
  const next=enterReadingProject(before);
  assert.equal(next.activeTab,"book:other");
  assert.equal(next.sources.length,2);
  assert.deepEqual(next.chats,before.chats);
});

test("projects without a source keep a usable conversation",()=>{
  const project=normalizePaperTree({...fixture(),sources:[],activeSource:""});
  assert.equal(defaultReadingTarget(project),undefined);
  assert.strictEqual(enterReadingProject(project),project);
});

test("explicit chat, graph and exercise main visuals survive refresh without changing their ownership", () => {
  const created = ensureScopeConversation(fixture(), "s@1:1");
  const graph = { id: "graph:chapter", kind: "graph", parentId: "s@1:1", title: "本章知识图谱" };
  const questions = { id: "questions:set:1", kind: "questions", parentId: "s@1:1", title: "本章习题", objectId: "set:1" };
  const withExercises = { ...created.project, sets: [{ id: "set:1", title: "本章习题", questions: [] }] };
  const project = attachPaperNode(attachPaperNode(withExercises, graph), questions);
  const before = structuredClone(project);
  for (const id of [created.nodeId, graph.id, questions.id]) {
    const next = restoreWorkspaceProject(project, id);
    assert.equal(next.activeTab, id);
    assert.equal(next.activeSource, project.activeSource);
    assert.deepEqual(next.sources, project.sources);
    assert.deepEqual(next.paperTree, project.paperTree);
    assert.deepEqual(next.chats, project.chats);
    assert.equal(next.tabs.filter((tab) => tab.id === id).length, 1);
    assert.deepEqual(restoreWorkspaceProject(next, id), next);
  }
  assert.deepEqual(project, before);
});

test("with no placement preference refresh returns to PDF even if an object was previously selected", () => {
  const project = attachPaperNode(fixture(), { id: "graph:project", kind: "graph", parentId: "book:s" });
  for (const preference of [undefined, null, ""]) {
    const next = restoreWorkspaceProject({ ...project, activeTab: "graph:project" }, preference);
    assert.equal(next.activeTab, "book:s");
    assert.equal(next.sources[0].progress, 8);
    assert.deepEqual(next.chats, project.chats);
  }
});

test("restoring an explicitly chosen chapter also restores its page when another chapter was being read", () => {
  const project = fixture(), next = restoreWorkspaceProject(project, "s@1:1");
  assert.equal(next.activeTab, "s@1:1");
  assert.equal(next.activeSource, "s");
  assert.equal(next.sources[0].progress, 1);
  assert.equal(project.sources[0].progress, 8);
  assert.deepEqual(next.chats, project.chats);
});

test("stale saved placements recover the current reading scope without inventing content", () => {
  const created = ensureScopeConversation(fixture(), "s@1:1");
  const project = { ...created.project, activeTab: created.nodeId };
  const before = structuredClone(project);
  const next = restoreWorkspaceProject(project, "deleted:object");
  assert.equal(next.activeTab, "s@1:1");
  assert.equal(next.sources[0].progress, 1);
  assert.deepEqual(next.paperTree, project.paperTree);
  assert.deepEqual(next.chats, project.chats);
  assert.deepEqual(project, before);

  const noSource = normalizePaperTree({ ...fixture(), sources: [], activeSource: "" });
  assert.strictEqual(restoreWorkspaceProject(noSource, "deleted:object"), noSource);
});
