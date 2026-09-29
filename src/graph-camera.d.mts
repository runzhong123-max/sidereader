import type { LearningNode } from './learning-graph-layout.mjs';
import type { Camera } from './graph-layout.mjs';
export const readableGraphScale: number;
export function readingGraphCamera(nodes: LearningNode[], width: number, height: number, options?: { top?: number; bottom?: number; padding?: number; maxScale?: number }, focusId?: string): Camera;
export function zoomGraphCamera(camera: Camera, factor: number, x: number, y: number): Camera;
export function resizeGraphCamera(camera: Camera, previous: {width:number;height:number}, next: {width:number;height:number}): Camera;
