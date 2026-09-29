import "../object-context.css";

/** A quiet, shared answer to what this is and where it belongs. */
export default function ObjectContext({ label, scope, originTitle, onOrigin }: {
  label: string;
  scope?: string;
  originTitle?: string;
  onOrigin?: () => void;
}) {
  return <div className="object-context">
    <span>{label}{scope && <> · {scope}</>}</span>
    {onOrigin && <button type="button" className="text-button" title={originTitle} onClick={onOrigin}>回到生成对话</button>}
  </div>;
}
