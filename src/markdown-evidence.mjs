/** Link citations only in prose, never inside code, math, images, or links. */
export function remarkEvidence({ count = 0 } = {}) {
  return (tree) => {
    function walk(parent) {
      if (
        !parent.children ||
        [
          "link",
          "linkReference",
          "code",
          "inlineCode",
          "math",
          "inlineMath",
          "image",
          "imageReference",
        ].includes(parent.type)
      )
        return;
      parent.children = parent.children.flatMap((child) => {
        if (child.type !== "text") {
          walk(child);
          return [child];
        }
        const parts = [];
        let offset = 0;
        for (const match of child.value.matchAll(/\[(\d{1,2})\]/g)) {
          const number = Number(match[1]);
          if (number < 1 || number > count) continue;
          if (match.index > offset)
            parts.push({
              type: "text",
              value: child.value.slice(offset, match.index),
            });
          parts.push({
            type: "link",
            url: `#source-${number}`,
            children: [{ type: "text", value: String(number) }],
          });
          offset = match.index + match[0].length;
        }
        if (!offset) return [child];
        if (offset < child.value.length)
          parts.push({ type: "text", value: child.value.slice(offset) });
        return parts;
      });
    }
    walk(tree);
  };
}
