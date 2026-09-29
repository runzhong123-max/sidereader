/** Shared dot-and-label appearance for full graphs and inline graph cards. */
export default function GraphNodeVisual({ name, radius, fontSize = 12, labelOffset = 16, hub = false, showLabel = true, label }: {
  name: string;
  radius: number;
  fontSize?: number;
  labelOffset?: number;
  hub?: boolean;
  showLabel?: boolean;
  label?: { x: number; y: number; width: number; height: number; lineHeight: number; lines: string[]; leader?: { x: number; y: number } };
}) {
  return <>
    {label?.leader && <line className="network-label-leader" x1={0} y1={0} x2={label.leader.x} y2={label.leader.y} vectorEffect="non-scaling-stroke"/>}
    <circle className="network-node-hit" r={Math.max(radius + 8, 17)} />
    <circle className="network-node-ring" r={radius + 5} />
    <circle className="network-node-core" r={radius} />
    {showLabel && (label ? <g className="network-node-label" transform={`translate(${label.x},${label.y})`}>
      <rect className="network-label-hit" x={-label.width / 2} y={0} width={label.width} height={label.height}/>
      <text y={fontSize + 2} style={{ fontSize }} textAnchor="middle" className={hub ? "is-hub" : undefined}>
        {label.lines.map((line, index) => <tspan key={index} x={0} dy={index ? label.lineHeight : 0}>{line}</tspan>)}
      </text>
    </g> : <text y={radius + labelOffset} style={{ fontSize }} textAnchor="middle" className={hub ? "is-hub" : undefined}>{name}</text>)}
  </>;
}
