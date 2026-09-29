/** Strict display-only fast path for a scanned page with invisible OCR text. */
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const identity = () => [1, 0, 0, 1, 0, 0];
const finiteMatrix = a => Array.isArray(a) && a.length === 6 && a.every(Number.isFinite);
const validSize = (w, h) => Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0 && w * h <= 64_000_000;

export function scanPagePlan(list, ops, viewport) {
  if (!list || list.separateAnnots || !Array.isArray(list.fnArray) || !list.fnArray.every(Number.isInteger) || !Array.isArray(list.argsArray) || list.fnArray.length !== list.argsArray.length || !finiteMatrix(viewport?.transform)) return null;
  const textState = new Set(["setFont", "setCharSpacing", "setWordSpacing", "setHScale", "setLeading", "setTextRise", "moveText", "setLeadingMoveText", "setTextMatrix", "nextLine"].map(k => ops[k]));
  const showText = new Set(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"].map(k => ops[k]));
  let ctm = identity(), mode = 0, inText = false, transforms = 0, image = null;
  const stack = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const op = list.fnArray[i], args = list.argsArray[i] || [];
    if (op === ops.dependency) continue;
    if (op === ops.save) { if (inText) return null; stack.push({ ctm: ctm.slice(), mode }); continue; }
    if (op === ops.restore) { if (inText || !stack.length) return null; ({ ctm, mode } = stack.pop()); continue; }
    if (op === ops.beginText) { if (inText) return null; inText = true; continue; }
    if (op === ops.endText) { if (!inText) return null; inText = false; continue; }
    if (op === ops.setTextRenderingMode) { if (!inText || args[0] !== 3) return null; mode = 3; continue; }
    if (textState.has(op)) { if (!inText) return null; continue; }
    if (showText.has(op)) { if (!inText || mode !== 3) return null; continue; }
    if (op === ops.transform) {
      if (inText || ++transforms > 1 || !finiteMatrix(args)) return null;
      ctm = multiply(ctm, args); continue;
    }
    if (op === ops.paintImageXObject) {
      if (inText || image || typeof args[0] !== "string" || !validSize(args[1], args[2])) return null;
      image = { imageId: args[0], width: args[1], height: args[2], ctm: ctm.slice() }; continue;
    }
    // Reject clipping, masks, graphics state, forms, optional content, visible
    // paths/text/annotations and every unknown operation rather than ignoring it.
    return null;
  }
  if (!image || stack.length || inText || transforms !== 1) return null;
  const pageTransform = multiply(viewport.transform, image.ctm);
  const corners = [[0,0],[1,0],[0,1],[1,1]].map(([x,y]) => [pageTransform[0]*x+pageTransform[2]*y+pageTransform[4], pageTransform[1]*x+pageTransform[3]*y+pageTransform[5]]);
  const left = Math.min(...corners.map(p=>p[0])), right = Math.max(...corners.map(p=>p[0]));
  const top = Math.min(...corners.map(p=>p[1])), bottom = Math.max(...corners.map(p=>p[1]));
  const coverage = Math.max(0, Math.min(right,viewport.width)-Math.max(left,0)) * Math.max(0,Math.min(bottom,viewport.height)-Math.max(top,0));
  if (!(viewport.width > 0 && viewport.height > 0) || coverage < viewport.width*viewport.height*.9 || right-left > viewport.width*1.15 || bottom-top > viewport.height*1.15) return null;
  const pixelTransform = multiply(pageTransform, [1/image.width,0,0,-1/image.height,0,1]);
  if (Math.abs(pixelTransform[0]*pixelTransform[3]-pixelTransform[1]*pixelTransform[2]) < 1e-12) return null;
  return { imageId: image.imageId, width: image.width, height: image.height, pixelTransform };
}

/** Decode only a bounded row strip. PDF.js already applied color/decode masks. */
export function scanImageRows(image, start, count) {
  const { width, height, kind, data } = image;
  if (!validSize(width,height) || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || ![1,2,3].includes(kind) || !Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0 || start+count > height) return null;
  const stride = kind === 1 ? Math.ceil(width/8) : width * (kind === 2 ? 3 : 4);
  if (data.length < stride*height) return null;
  const rgba = new Uint8ClampedArray(width*count*4);
  for (let row=0;row<count;row++) for(let x=0;x<width;x++) {
    const dest=(row*width+x)*4, source=(start+row)*stride;
    if(kind===1) rgba[dest]=rgba[dest+1]=rgba[dest+2]=(data[source+(x>>3)] >> (7-(x&7)) & 1) ? 255 : 0;
    else { const src=source+x*(kind===2?3:4); rgba[dest]=data[src];rgba[dest+1]=data[src+1];rgba[dest+2]=data[src+2]; }
    rgba[dest+3]=kind===3 ? data[source+x*4+3] : 255;
  }
  return rgba;
}

/** Draw the decoded original using exactly its display CTM; no PDF render loop. */
export function paintScanImage(context, image, plan, createCanvas, pixelRatio = 1) {
  if (!image || image.width !== plan.width || image.height !== plan.height || !validSize(image.width,image.height)) return false;
  const owned=[];
  const canvasFor=(w,h)=>{const canvas=createCanvas(w,h);owned.push(canvas);return canvas;};
  let source=image.bitmap, contextSaved=false;
  try {
    if(source && (source.width!==image.width || source.height!==image.height)) return false;
    if(!source) {
      // Validate before allocating the full canvas.
      if(!scanImageRows(image,0,0)) return false;
      source=canvasFor(image.width,image.height);
      const sourceContext=source.getContext("2d");
      if(!sourceContext) return false;
      for(let start=0;start<image.height;start+=64) {
        const height=Math.min(64,image.height-start), data=scanImageRows(image,start,height);
        if(!data) return false;
        const strip=sourceContext.createImageData(image.width,height);strip.data.set(data);sourceContext.putImageData(strip,0,start);
      }
    }
    // Match PDF.js's staged reduction instead of discarding fine equation strokes
    // in one large downsample. All stages operate on local pixels only.
    const [a,b,c,d]=plan.pixelTransform, det=a*d-b*c;
    let widthScale=Math.max(Math.hypot(d/det,-b/det),1),heightScale=Math.max(Math.hypot(-c/det,a/det),1);
    let pw=image.width,ph=image.height;
    while((widthScale>2&&pw>1)||(heightScale>2&&ph>1)) {
      const nw=widthScale>2&&pw>1?Math.ceil(pw/2):pw,nh=heightScale>2&&ph>1?Math.ceil(ph/2):ph;
      const smaller=canvasFor(nw,nh),smallContext=smaller.getContext("2d");
      if(!smallContext) return false;
      smallContext.drawImage(source,0,0,pw,ph,0,0,nw,nh);
      if(owned.includes(source)) source.width=source.height=0;
      source=smaller;widthScale/=pw/nw;heightScale/=ph/nh;pw=nw;ph=nh;
    }
    context.save();contextSaved=true;
    context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.globalCompositeOperation="source-over";
    context.fillStyle="#fff";context.fillRect(0,0,context.canvas.width,context.canvas.height);
    context.setTransform(...plan.pixelTransform);
    const sum=a*a+b*b+c*c+d*d,disc=Math.sqrt(Math.max(0,sum*sum-4*det*det));
    context.imageSmoothingEnabled=Boolean(image.interpolate)||Math.sqrt((sum+disc)/2)<=Math.max(1,pixelRatio)*4/3;
    context.drawImage(source,0,0,pw,ph,0,0,image.width,image.height);
    return true;
  } finally {
    if(contextSaved)context.restore();
    for(const canvas of owned)canvas.width=canvas.height=0;
  }
}
