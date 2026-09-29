import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const compiled = await build({
  entryPoints:[fileURLToPath(new URL("../src/components/LearningSurface.tsx",import.meta.url))],
  bundle:true,write:false,format:"esm",platform:"node",jsx:"automatic",
  plugins:[{name:"render-dependencies",setup(builder){
    builder.onResolve({filter:/\.css$/},()=>({path:"styles",namespace:"empty"}));
    builder.onLoad({filter:/.*/,namespace:"empty"},()=>({contents:"",loader:"js"}));
    builder.onResolve({filter:/^[^./]/},({path})=>({path:import.meta.resolve(path),external:true}));
  }}],
});
const {default:LearningSurface}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const question={id:"q",type:"choice",prompt:"同一个问题",options:["左","右"],answer:"1",explanation:"SECRET_EXPLANATION"};
const set={id:"set",title:"已有练习",description:"",questions:[question]};
const project={id:"p",goal:"验证一致性",sources:[],concepts:[],chats:[],sets:[set],stages:[{id:"first",title:"基础关卡",description:"",done:false},{id:"second",title:"进阶关卡",description:"",done:false,prerequisites:["first"]}],paperTree:{nodes:[{id:"practice-view",kind:"questions",objectId:"set",parentId:null},{id:"path",kind:"path",parentId:null}]}};
function render(target,presentation,overrides={}){
  const noop=()=>{};
  return renderToStaticMarkup(createElement(LearningSurface,{project,target,presentation,overview:createElement("p",null,"总览"),
    onNavigate:noop,onReadAnchor:noop,onCitation:noop,onReferenceConcept:noop,onReferenceQuestion:noop,onAskObject:noop,onConcepts:noop,
    onEditStage:noop,onToggleStage:noop,onRemoveStage:noop,onEditGoal:noop,onSets:noop,onSetOrigin:noop,onObjectOrigin:noop,onAttempt:noop,onDraft:noop,onPosition:noop,onOpenObject:noop,...overrides,
  }));
}
test("main, comparison and floating practice views resolve one canonical file and keep its answer hidden",()=>{
  for(const presentation of ["main","comparison","floating"]){
    const html=render({id:"practice-view",kind:"questions"},presentation);
    assert.match(html,/已有练习/);
    assert.match(html,/同一个问题/);
    assert.match(html,/提交答案/);
    assert.doesNotMatch(html,/SECRET_EXPLANATION|参考答案/);
  }
});
test("moving an object with a stale view hint still renders its canonical kind in every placement",()=>{
  for(const presentation of ["main","comparison","floating"]){
    const html=render({id:"practice-view",kind:"graph"},presentation);
    assert.match(html,/已有练习/);
    assert.match(html,/同一个问题/);
    assert.match(html,/问问这题/);
    assert.doesNotMatch(html,/追问这个对象/);
    assert.doesNotMatch(html,/图谱显示设置|SECRET_EXPLANATION/);
  }
});

test("a single question is directly answerable without duplicate card title, navigation, or a summary step",()=>{
  const html=render({id:"practice-view",kind:"questions"},"main");
  assert.equal((html.match(/>同一个问题<\/p>/g)||[]).length,1);
  assert.equal((html.match(/>问问这题<\/button>/g)||[]).length,1);
  assert.match(html,/aria-label="练习操作"/);
  assert.doesNotMatch(html,/class="learning-object-title"|aria-label="当前题目"|aria-label="切换题目"|查看总结|编辑题目|第 1 题/);
});

test("multiple questions have one navigation with persisted position and untouched answer visibility",()=>{
  const next={...question,id:"next",prompt:"第二个问题"};
  const two={...project,sets:[{...set,questions:[question,next]}],practicePositions:{set:"next"}};
  const html=render({id:"practice-view",kind:"questions"},"comparison",{project:two});
  assert.equal((html.match(/aria-label="切换题目"/g)||[]).length,1);
  assert.equal((html.match(/aria-label="当前题目"/g)||[]).length,1);
  assert.match(html,/value="next" selected=""/);
  assert.match(html,/>第二个问题<\/p>/);
  assert.doesNotMatch(html,/SECRET_EXPLANATION|参考答案|查看总结/);
});

test("ordinary objects can return to a verified source conversation in every placement",()=>{
  const paper={id:"formula",title:"公式",parentId:"chat-node",sourceMessageId:"source-answer",object:{id:"source-answer:object:0",kind:"formula",title:"公式",content:"f(x)=wx+b"},evidence:[]};
  const withOrigin={...project,papers:[paper],chats:[{id:"chat",title:"线性模型讲解",messages:[{id:"source-answer",content:"讲解"}]}],paperTree:{nodes:[...project.paperTree.nodes,{id:"chat-node",kind:"chat",objectId:"chat",parentId:null},{id:"formula",kind:"paper",objectId:"formula",parentId:"chat-node"}]}};
  for(const presentation of ["main","comparison","floating"]){
    const html=render({id:"formula",kind:"paper"},presentation,{project:withOrigin});
    assert.match(html,/对话中的材料/);
    assert.match(html,/回到生成对话/);
    assert.match(html,/线性模型讲解/);
  }
  const stale={...withOrigin,papers:[{...paper,sourceMessageId:"missing-answer"}]};
  assert.doesNotMatch(render({id:"formula",kind:"paper"},"main",{project:stale}),/回到生成对话/);
});
test("stage prerequisites and edit actions are available in every placement",()=>{
  for(const presentation of ["main","comparison","floating"]){
    const html=render({id:"path",kind:"path"},presentation);
    assert.match(html,/先修：基础关卡/);
    assert.match(html,/编辑关卡：进阶关卡/);
    assert.match(html,/完成关卡：进阶关卡/);
    assert.match(html,/删除关卡：进阶关卡/);
  }
});
