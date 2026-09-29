import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from "react";
import type { Camera } from "../graph-layout.mjs";
import { fitLearningGraph, learningGraphBounds, type LearningNode } from "../learning-graph-layout.mjs";
import "../graph-minimap.css";

type GraphMinimapProps = {
  nodes: LearningNode[];
  camera: Camera;
  width: number;
  height: number;
  onNavigate: (worldX: number, worldY: number) => void;
  hidden?: boolean;
};
const miniWidth = 110, miniHeight = 70;

/** An orientation aid for the current layout, never a second layout engine. */
export default function GraphMinimap({ nodes, camera, width, height, onNavigate, hidden = false }: GraphMinimapProps) {
  const svg = useRef<SVGSVGElement>(null);
  const bounds = useMemo(() => learningGraphBounds(nodes), [nodes]);
  const mini = useMemo(() => fitLearningGraph(nodes, miniWidth, miniHeight, { padding: 7, maxScale: 1 }), [nodes]);
  const valid = width > 0 && height > 0 && camera.k > 0 && [camera.x, camera.y, camera.k].every(Number.isFinite);
  const overflow = valid && (bounds.left * camera.k + camera.x < -2 || bounds.right * camera.k + camera.x > width + 2
    || bounds.top * camera.k + camera.y < -2 || bounds.bottom * camera.k + camera.y > height + 2);
  if (hidden || nodes.length <= 6 || !overflow) return null;

  const worldCenter = { x: (width / 2 - camera.x) / camera.k, y: (height / 2 - camera.y) / camera.k };
  const viewport = { x: -camera.x / camera.k * mini.k + mini.x, y: -camera.y / camera.k * mini.k + mini.y,
    width: width / camera.k * mini.k, height: height / camera.k * mini.k };
  function navigate(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    const rectangle = svg.current?.getBoundingClientRect();
    if (!rectangle?.width || !rectangle.height) return;
    const x = (event.clientX - rectangle.left) * miniWidth / rectangle.width;
    const y = (event.clientY - rectangle.top) * miniHeight / rectangle.height;
    onNavigate((x - mini.x) / mini.k, (y - mini.y) / mini.k);
  }
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? .5 : .2;
      onNavigate(worldCenter.x + direction[0] * width / camera.k * step, worldCenter.y + direction[1] * height / camera.k * step);
    } else if (event.key === "Enter" || event.key === " " || event.key === "Home") {
      event.preventDefault(); event.stopPropagation();
      onNavigate((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
    }
  }
  return <div className="graph-minimap" role="button" tabIndex={0}
    aria-label="图谱缩略导航，方向键移动视野，Enter 回到图谱中心"
    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home Enter"
    title="点击定位 · 方向键移动视野 · Enter 回到图谱中心"
    onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    onClick={navigate} onKeyDown={move}>
    <svg ref={svg} viewBox={`0 0 ${miniWidth} ${miniHeight}`} width={miniWidth} height={miniHeight} aria-hidden="true">
      {nodes.map(node => <circle key={node.id} className={node.isRoot ? "graph-minimap-dot is-root" : "graph-minimap-dot"}
        cx={node.x * mini.k + mini.x} cy={node.y * mini.k + mini.y} r={node.isRoot ? 1.8 : 1.2} />)}
      <rect className="graph-minimap-viewport" x={viewport.x} y={viewport.y} width={viewport.width} height={viewport.height} rx={1} />
    </svg>
  </div>;
}
