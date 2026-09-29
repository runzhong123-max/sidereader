export interface ScanPlan { imageId: string; width: number; height: number; pixelTransform: number[] }
export interface ScanImage { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray; bitmap?: ImageBitmap; interpolate?: boolean }
export function scanPagePlan(list: { fnArray: number[]; argsArray: unknown[][]; separateAnnots?: unknown }, ops: Record<string,number>, viewport: { width:number; height:number; transform:number[] }): ScanPlan | null;
export function scanImageRows(image: ScanImage, start:number, count:number): Uint8ClampedArray | null;
export function paintScanImage(context:CanvasRenderingContext2D,image:ScanImage,plan:ScanPlan,createCanvas:(width:number,height:number)=>HTMLCanvasElement,pixelRatio?:number):boolean;
