import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDocument, OPS as PDF_OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { scanPagePlan, scanImageRows, paintScanImage } from "../src/pdf-scan-raster.mjs";


// Use PDF.js's documented document.canvasFactory rather than importing its
// optional native canvas dependency directly. This is also the factory used
// by the reference renderer in the pixel comparison below.
function blankPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Resources << >> >>",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(source.length);
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = source.length;
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(source);
}
const canvasesFor = pdf => (width, height) => pdf.canvasFactory.create(width, height).canvas;

const names=["save","beginText","setFont","setTextRenderingMode","moveText","showText","setTextMatrix","endText","transform","dependency","paintImageXObject","restore","setGState","clip","stroke","beginMarkedContentProps"];
const OPS=Object.fromEntries(names.map((name,index)=>[name,index+1]));
const view={width:100,height:100,transform:[1,0,0,-1,0,100]};
const makeList=(extra=[],mode=3)=>{
  const entries=[["save",[]],["beginText",[]],["setTextRenderingMode",[mode]],["showText",["OCR"]],["endText",[]],["transform",[100,0,0,100,0,0]],...extra,["paintImageXObject",["img",10,10]],["restore",[]]];
  return {fnArray:entries.map(([name])=>OPS[name]??name),argsArray:entries.map(([,args])=>args)};
};

test("strict single-scan plan accepts invisible OCR and preserves image CTM",()=>{
  const plan=scanPagePlan(makeList(),OPS,view);
  assert.deepEqual(plan,{imageId:"img",width:10,height:10,pixelTransform:[10,0,0,10,0,0]});
  const skewed=makeList();skewed.argsArray[5]=[98,1,-1,100,2,0];
  assert.deepEqual(scanPagePlan(skewed,OPS,view).pixelTransform,[9.8,-.1,.1,10,1,0]);
});

test("visible text, clipping, masks, optional content, unknown ops and multiple images fall back",()=>{
  assert.equal(scanPagePlan(makeList([],0),OPS,view),null);
  assert.equal(scanPagePlan(makeList([],7),OPS,view),null);
  for(const op of ["setGState","clip","stroke","beginMarkedContentProps",9999])
    assert.equal(scanPagePlan(makeList([[op,[]]]),OPS,view),null);
  assert.equal(scanPagePlan(makeList([["paintImageXObject",["other",10,10]]]),OPS,view),null);
  assert.equal(scanPagePlan({...makeList(),separateAnnots:{canvas:true}},OPS,view),null);
  const small=makeList();small.argsArray[5]=[10,0,0,10,0,0];
  assert.equal(scanPagePlan(small,OPS,view),null,"a small logo is not a full-page scan");
  const unbalanced=makeList();unbalanced.fnArray.pop();unbalanced.argsArray.pop();
  assert.equal(scanPagePlan(unbalanced,OPS,view),null);
});

test("1bpp decoding honors MSB order and per-row padding; RGB and RGBA preserve channels",()=>{
  const mono={width:9,height:2,kind:1,data:new Uint8Array([0b10000001,0b10000000,0b01000000,0])};
  const rgba=scanImageRows(mono,0,2);
  assert.deepEqual([rgba[0],rgba[4],rgba[28],rgba[32],rgba[36],rgba[40]],[255,0,255,255,0,255]);
  assert.ok(rgba.filter((_,index)=>index%4===3).every(v=>v===255));
  assert.deepEqual([...scanImageRows({width:2,height:1,kind:2,data:new Uint8Array([1,2,3,4,5,6])},0,1)],[1,2,3,255,4,5,6,255]);
  assert.deepEqual([...scanImageRows({width:1,height:1,kind:3,data:new Uint8Array([7,8,9,30])},0,1)],[7,8,9,30]);
  assert.equal(scanImageRows({...mono,data:new Uint8Array(1)},0,1),null);
  assert.equal(scanImageRows({...mono,kind:99},0,1),null);
});

test("decoded bitmap and RGBA paths retain orientation, alpha, and white page background",async()=>{
  const task=getDocument({data:blankPdf()});
  try {
  const createCanvas=canvasesFor(await task.promise);
  const image={width:2,height:2,kind:3,data:new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,0,0,0,0])};
  const plan={imageId:"img",width:2,height:2,pixelTransform:[1,0,0,1,1,1]};
  const target=createCanvas(4,4);
  assert.equal(paintScanImage(target.getContext("2d"),image,plan,createCanvas),true);
  const pixel=(x,y)=>[...target.getContext("2d").getImageData(x,y,1,1).data];
  assert.deepEqual(pixel(1,1),[255,0,0,255]);assert.deepEqual(pixel(1,2),[0,0,255,255]);
  assert.deepEqual(pixel(2,2),[255,255,255,255]);assert.deepEqual(pixel(0,0),[255,255,255,255]);
  const bitmap=createCanvas(2,2);bitmap.getContext("2d").fillStyle="#ff0000";bitmap.getContext("2d").fillRect(0,0,2,2);
  assert.equal(paintScanImage(target.getContext("2d"),{width:2,height:2,bitmap},plan,createCanvas),true);
  assert.deepEqual(pixel(2,2),[255,0,0,255]);
  assert.equal(bitmap.width,2,"shared bitmap is not resized or disposed by the fast path");
  target.width=target.height=bitmap.width=bitmap.height=0;
  } finally { await task.destroy(); }
});

const textbook=new URL("../.local/books/machine-learning.pdf",import.meta.url);
test("real pages 163/164/166 agree with normal display rendering to within one gray level",{skip:!existsSync(textbook)},async()=>{
  const task=getDocument({data:new Uint8Array(readFileSync(textbook)),wasmUrl:resolve("node_modules/pdfjs-dist/wasm")+"/",useWorkerFetch:false,useSystemFonts:true});
  try{
    const pdf=await task.promise,createCanvas=canvasesFor(pdf);
    for(const number of [163,164,166]){
      const page=await pdf.getPage(number),viewport=page.getViewport({scale:1});
      const plan=scanPagePlan(await page.getOperatorList({intent:"display"}),PDF_OPS,viewport);
      assert.ok(plan,`page ${number} has the exact scanned-page structure`);
      const image=await new Promise(resolve=>page.objs.get(plan.imageId,resolve));
      const fast=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      const reference=createCanvas(fast.width,fast.height);
      assert.equal(paintScanImage(fast.getContext("2d"),image,plan,createCanvas),true);
      await page.render({canvas:reference,viewport,intent:"display"}).promise;
      const a=fast.getContext("2d").getImageData(0,0,fast.width,fast.height).data;
      const b=reference.getContext("2d").getImageData(0,0,fast.width,fast.height).data;
      let max=0,total=0;
      for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);max=Math.max(max,delta);total+=delta;}
      assert.ok(max<=1,`page ${number} maximum pixel delta ${max}`);
      assert.ok(total/a.length<.001,`page ${number} mean delta ${total/a.length}`);
      fast.width=fast.height=reference.width=reference.height=0;
      page.cleanup();
    }
  }finally{await task.destroy();}
});
