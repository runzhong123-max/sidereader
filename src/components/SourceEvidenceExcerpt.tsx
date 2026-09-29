import { useEffect, useRef, useState } from "react";
import SourceExcerpt from "./SourceExcerpt";
import type { OriginalFormula } from "../services/pdf-excerpt";

/** Rasterize only visible excerpts, using the exact source/page of the citation. */
export default function SourceEvidenceExcerpt({ text, sourceId, page, query = "", compact = true }: {
  text: string; sourceId: string; page: number; query?: string; compact?: boolean;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [resolved, setResolved] = useState<{ key: string; formulae: OriginalFormula[] }>();
  const [status, setStatus] = useState("waiting");
  const [error, setError] = useState("");
  const key = JSON.stringify([sourceId, page, text]);
  useEffect(() => {
    let cancelled = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      setStatus("loading");
      setError("");
      void import("../services/pdf-excerpt").then(module => module.originalFormulae(sourceId, page, text, stage => { if (!cancelled) setStatus(stage); })).then(formulae => {
        if (!cancelled) { setResolved({ key, formulae }); setStatus(`ready:${formulae.length}`); }
      }).catch(error => { if (!cancelled) { setStatus("unavailable"); setError(error instanceof Error ? error.message : "原页暂不可用"); } });
    }, { rootMargin: "80px" });
    if (host.current) observer.observe(host.current);
    return () => { cancelled = true; observer.disconnect(); };
  }, [key, sourceId, page, text]);
  return <span ref={host} className="source-evidence-excerpt" data-status={status} title={error || undefined}>
    <SourceExcerpt text={text} query={query} compact={compact} formulae={resolved?.key === key ? resolved.formulae : undefined} />
  </span>;
}
