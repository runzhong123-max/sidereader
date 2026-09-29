type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
export function selectionToolbarPosition(rects: Rect[], bounds: Pick<Rect,"left" | "right" | "top" | "bottom">, options?: {width?:number;height?:number;backwards?:boolean}): {left:number;top:number} | null;
export function sameBookmarkExcerpt(a: string | undefined, b: string | undefined): boolean;
