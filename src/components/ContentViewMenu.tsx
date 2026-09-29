import { Check, ChevronDown, PanelLeft, PanelRight, PanelsTopLeft, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import ActionMenu from "./ActionMenu";
import type { WorkspaceDropPosition } from "../object-transfer.mjs";
import { splitBounds } from "../study-layout.mjs";

const views = [
  { id: "main", label: "主区查看", icon: Square },
  { id: "left", label: "左侧并排", icon: PanelLeft },
  { id: "right", label: "右侧并排", icon: PanelRight },
  { id: "float", label: "浮窗查看", icon: PanelsTopLeft },
] as const;

/** The same placement vocabulary follows content through every presentation. */
export default function ContentViewMenu({ title, current, onPlace, canSplit, canMoveToSide = true, canFloat = true }: {
  title: string;
  current: WorkspaceDropPosition;
  onPlace: (position: WorkspaceDropPosition) => void;
  canSplit?: boolean;
  canMoveToSide?: boolean;
  canFloat?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(true);
  useLayoutEffect(() => {
    if (canSplit !== undefined) return;
    const workspace = root.current?.closest(".study-workspace");
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => setRoom(splitBounds(entry.contentRect.width, true).canSplit));
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [canSplit]);
  const showSides = canSplit ?? room;
  const Icon = views.find((view) => view.id === current)!.icon;
  return <div ref={root} className="content-view-control"><ActionMenu className="content-view-menu" label={`${title}的视图`} trigger={<><Icon size={14} /><span>视图</span><ChevronDown size={11} /></>}>
    <div className="action-menu-label">显示位置</div>
    {views.filter((view) => showSides || (view.id !== "left" && view.id !== "right")).map((view) => {
      const selected = current === view.id;
      const disabled = ((view.id === "left" || view.id === "right") && !canMoveToSide) || (view.id === "float" && !canFloat);
      return <button key={view.id} aria-pressed={selected} disabled={disabled} onClick={() => { if (!selected) onPlace(view.id); }}>
        <view.icon size={17} /><span>{view.label}</span>{selected && <Check size={14} className="content-view-check" />}
      </button>;
    })}
    {!showSides ? <p className="content-view-note">窗口较窄，先单区查看。</p>
      : !canMoveToSide ? <p className="content-view-note">先从左侧打开另一项内容，再并排。</p> : null}
  </ActionMenu></div>;
}
