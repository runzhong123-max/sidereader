import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Concept } from "../types";
import type { LearningRelationKind } from "../learning-graph-layout.mjs";
import { buildConceptRelations } from "../graph-relations.mjs";

export default function GraphRelations({ concepts, activeId, relationKind = "prerequisite", onSelect }: {
  concepts: readonly Concept[];
  activeId: string;
  relationKind?: LearningRelationKind;
  onSelect: (id: string) => void;
}) {
  const { groups } = useMemo(() => buildConceptRelations(concepts, activeId, relationKind), [concepts, activeId, relationKind]);
  if (!groups.length) return <section><h3>关联概念 <span>0</span></h3><div className="network-neighbor-list"><p>尚未建立关联</p></div></section>;
  return <>{groups.map(group => <section key={group.id}>
    <h3>{group.label} <span>{group.concepts.length}</span></h3>
    <div className="network-neighbor-list">
      {group.concepts.map(concept => <button type="button" key={concept.id} onClick={() => onSelect(concept.id)}>
        <span>{concept.name}</span><ArrowUpRight size={13} aria-hidden="true" />
      </button>)}
    </div>
  </section>)}</>;
}
