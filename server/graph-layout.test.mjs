import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphData, neighborhood, layoutGraph, fitGraph, graphLabelLines, placeGraphLabels } from '../src/graph-layout.mjs';
const graph = [
  { id: 'a', name: '基础', links: ['b', 'b', 'a', 'missing'] },
  { id: 'b', name: '算法', links: ['a', 'c'] },
  { id: 'c', name: '应用', links: [] },
  { id: 'd', name: '独立概念', links: [] },
];
test('local graph includes incoming links and respects depth without duplicates', () => {
  const {edges,neighbors}=graphData(graph);
  assert.equal(edges.length,2);
  assert.deepEqual([...neighborhood(neighbors,'c',1)].sort(),['b','c']);
  assert.deepEqual([...neighborhood(neighbors,'c',2)].sort(),['a','b','c']);
  assert.deepEqual([...neighborhood(neighbors,'d',2)],['d']);
  assert.equal(neighborhood(neighbors,null).size,0);
});
test('layout is finite, deterministic, does not mutate persisted objects and honors pinned positions', () => {
  const input=structuredClone(graph); input[1].layout={x:130,y:-85};
  const before=structuredClone(input), result=layoutGraph(input);
  assert.deepEqual(input,before);
  assert.deepEqual(result,layoutGraph(input));
  assert.ok(result.every(n=>[n.x,n.y,n.r].every(Number.isFinite)));
  assert.equal(result.find(n=>n.id==='b').x,130);
  assert.equal(result.find(n=>n.id==='b').y,-85);
  assert.ok(result.find(n=>n.id==='b').r>result.find(n=>n.id==='d').r);
  for(let i=0;i<result.length;i++)for(let j=i+1;j<result.length;j++)
    assert.ok(Math.hypot(result[i].x-result[j].x,result[i].y-result[j].y)>20);
});
test('fit keeps every node inside the visible canvas including empty graphs', () => {
  const nodes=layoutGraph(graph), camera=fitGraph(nodes,800,500);
  for(const node of nodes){
    assert.ok(node.x*camera.k+camera.x>0&&node.x*camera.k+camera.x<800);
    assert.ok(node.y*camera.k+camera.y>0&&node.y*camera.k+camera.y<500);
  }
  assert.deepEqual(fitGraph([],800,500),{x:400,y:250,k:1});
});

const chapterNames = ['线性模型','线性回归','多元线性回归','最小二乘法','均方误差','对数几率回归','对数几率函数','极大似然估计','线性判别分析（LDA）','类内散度矩阵','类间散度矩阵','广义瑞利商','多分类学习','一对一（OvO）','一对其余（OvR）','多对多与纠错输出码','类别不平衡问题','再缩放与欠采样','过采样与阈值移动','属性权重与可解释性'];
const chapter = chapterNames.map((name,index) => ({id:String(index),name,links:[String((index+1)%chapterNames.length),String(index%5)]}));
function overlap(a,b) {
  return Math.abs(a.x-b.x)<(a.width+b.width)/2 && a.y<b.y+b.height && b.y<a.y+a.height;
}

test('all 20 chapter labels remain readable and separate in a 620px floating graph at fit and 40 percent zoom',()=>{
  const nodes=layoutGraph(chapter).map((node,index)=>({...node,name:chapterNames[index]}));
  const fitted=fitGraph(nodes,620,360,45), before=structuredClone(nodes);
  const legacy=nodes.map(node=>({x:node.x*.4+fitted.x,y:node.y*.4+fitted.y+16,width:node.name.length*12,height:16}));
  assert.ok(legacy.some((a,index)=>legacy.slice(index+1).some(b=>overlap(a,b))),'fixture reproduces the old fixed-size label collisions');
  for(const camera of [fitted,{...fitted,k:.4},{...fitted,k:.25}]) {
    const labels=[...placeGraphLabels(nodes,camera,620,360,{top:54,bottom:52}).values()];
    assert.equal(labels.length,chapter.length,'every concept keeps its name, including low-degree concepts');
    for(let i=0;i<labels.length;i++) {
      const label=labels[i];
      assert.ok(label.fontSize>=12);
      assert.ok(label.x-label.width/2>=9 && label.x+label.width/2<=611);
      assert.ok(label.y>=54 && label.y+label.height<=308);
      assert.equal(label.lines.join(''),chapter.find(node=>node.id===label.id).name);
      for(let j=i+1;j<labels.length;j++) assert.equal(overlap(label,labels[j]),false,`${label.id} overlaps ${labels[j].id}`);
    }
    assert.deepEqual(placeGraphLabels(nodes,camera,620,360,{top:54,bottom:52}),placeGraphLabels(nodes,camera,620,360,{top:54,bottom:52}));
  }
  assert.deepEqual(nodes,before,'screen label placement never edits stored or manual world positions');
});

test('manual coincident points keep distinct clickable labels without changing their pinned positions',()=>{
  const pinned=chapter.slice(0,5).map(concept=>({...concept,layout:{x:0,y:0}}));
  const nodes=layoutGraph(pinned).map((node,index)=>({...node,name:pinned[index].name}));
  const labels=[...placeGraphLabels(nodes,{x:310,y:180,k:.4},620,360).values()];
  assert.ok(nodes.every(node=>node.x===0&&node.y===0));
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++)assert.equal(overlap(labels[i],labels[j]),false);
  assert.ok(labels.some(label=>label.leader),'displaced names identify their actual dot with a leader');
});

test('long names wrap without omission and deliberately offscreen labels follow their nodes',()=>{
  const name='线性判别分析 Linear Discriminant Analysis（LDA）';
  const lines=graphLabelLines(name,105,12);
  assert.ok(lines.length>1);
  assert.equal(lines.join('').replaceAll(' ',''),name.replaceAll(' ',''));
  const outside={id:'outside',name,x:-1000,y:0,r:6,degree:0};
  const label=placeGraphLabels([outside],{x:310,y:180,k:1},620,360).get(outside.id);
  assert.equal(label.x,-690,'panning does not collect offscreen concept labels along the canvas edge');
  assert.equal(label.leader,undefined);
});

test('wrapping keeps acronym parentheses and trailing punctuation attached at narrow label widths',()=>{
  assert.deepEqual(graphLabelLines('线性判别分析（LDA）',128,13),['线性判别分析','（LDA）']);
  assert.deepEqual(graphLabelLines('多对多与纠错输出码（ECOC）',128,13),['多对多与纠错输出码','（ECOC）']);
  const names=['线性判别分析（LDA）','纠错输出码（ECOC）','一对其余 (OvR)','线性判别分析（ LDA ）','中文标签，后续。','「概念说明」与《知识结构》','（Supercalifragilisticexpialidocious）'];
  for(const fontSize of [12,13])for(let width=72;width<=128;width++)for(const name of names) {
    const lines=graphLabelLines(name,width,fontSize);
    assert.equal(lines.join('').replaceAll(' ',''),name.replaceAll(' ',''),'wrapping retains the complete concept name');
    for(const line of lines) {
      assert.doesNotMatch(line,/^[)\]}）］｝》〉】〕」』”’，。！？；：、,.!?;:%％…]/u,`${name} at ${width}px starts a line with closing punctuation`);
      assert.doesNotMatch(line,/[([{（［｛《〈【〔「『“‘]$/u,`${name} at ${width}px leaves opening punctuation behind`);
    }
    for(const acronym of ['（LDA）','（ECOC）','(OvR)'])if(name.includes(acronym)) {
      assert.ok(lines.some(line=>line.includes(acronym)),`${acronym} stays together when it fits the label width`);
    }
  }
});

test('punctuation-aware labels remain within measured boxes without overlap in narrow graph panes',()=>{
  const concepts=chapter.map(concept=>concept.id==='15'?{...concept,name:'多对多与纠错输出码（ECOC）'}:concept);
  const nodes=layoutGraph(concepts).map((node,index)=>({...node,name:concepts[index].name}));
  for(const [width,height] of [[360,500],[420,500],[620,360]]) {
    const fitted=fitGraph(nodes,width,height,45);
    for(const camera of [fitted,{...fitted,k:.4},{...fitted,k:.25}]) {
      const labels=[...placeGraphLabels(nodes,camera,width,height,{top:54,bottom:52}).values()];
      assert.equal(labels.length,concepts.length);
      for(let i=0;i<labels.length;i++) {
        const label=labels[i];
        assert.ok(label.width<=Math.min(128,Math.max(72,width/4))+10,'punctuation never extends beyond its measured maximum width');
        assert.ok(label.x-label.width/2>=9&&label.x+label.width/2<=width-9);
        assert.ok(label.y>=54&&label.y+label.height<=height-52);
        assert.equal(label.lines.join(''),concepts.find(node=>node.id===label.id).name);
        for(let j=i+1;j<labels.length;j++)assert.equal(overlap(label,labels[j]),false,`${width}px at ${camera.k}: ${label.id} overlaps ${labels[j].id}`);
      }
    }
  }
});

test('320px graph keeps all 20 names and fixed dots separate at 16 percent zoom above its stacked footer',()=>{
  for(const pin of [{x:0,y:0},{x:120,y:180},{x:-200,y:-180},{x:450,y:300}]) {
    const concepts=chapter.map(concept=>concept.id==='18'?{...concept,layout:pin}:concept.id==='15'?{...concept,name:'多对多与纠错输出码（ECOC）'}:concept);
    const before=structuredClone(concepts);
    const nodes=layoutGraph(concepts).map((node,index)=>({...node,name:concepts[index].name}));
    const fitted=fitGraph(nodes,320,360,45), camera={...fitted,k:.16};
    for(const top of [14,54]) {
      const result=placeGraphLabels(nodes,camera,320,360,{top,bottom:80});
      const labels=[...result.values()];
      assert.equal(labels.length,20);
      for(let i=0;i<labels.length;i++) {
        const label=labels[i];
        assert.ok(label.fontSize>=12,'density does not shrink concept text');
        assert.equal(label.lines.join(''),concepts.find(node=>node.id===label.id).name);
        assert.ok(label.x-label.width/2>=10&&label.x+label.width/2<=310);
        assert.ok(label.y>=top&&label.y+label.height<=280,'labels reserve 80px for the two footer rows');
        for(let j=i+1;j<labels.length;j++)assert.equal(overlap(label,labels[j]),false,`${JSON.stringify(pin)}: ${label.id} overlaps ${labels[j].id}`);
        for(const dot of labels) assert.equal(overlap(label,{x:dot.nodeX,y:dot.nodeY-dot.radius-1,width:(dot.radius+1)*2,height:(dot.radius+1)*2}),false,'packing preserves the visible and clickable dots');
      }
      assert.deepEqual(result,placeGraphLabels(nodes,camera,320,360,{top,bottom:80}));
    }
    assert.deepEqual(concepts,before,'screen packing leaves persisted positions unchanged');
    assert.equal(nodes.find(node=>node.id==='18').x,pin.x);
    assert.equal(nodes.find(node=>node.id==='18').y,pin.y);
  }
});
