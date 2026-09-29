/** Locate existing PDF pixels; this module never reconstructs mathematical text. */
const LABEL = /[（(]\s*(?:[A-Za-z]\s*[.\-]\s*)?\d+(?:\s*[.\-]\s*\d+)*\s*[)）]/g;
const normalizeLabel = value => value.replace(/\s/g, "").replace("（", "(").replace("）", ")");
const compact = value => value.replace(/\s/g, "");
const median = values => { const sorted = values.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] || 10; };
const right = box => box.x + box.width;
const bottom = box => box.y + box.height;
const union = boxes => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(right)) - x, height: Math.max(...boxes.map(bottom)) - y };
};
function matrixPoint(matrix, x, y) { return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] }; }

/** Accept native PDF.js items, or already normalized top-left viewport boxes. */
function spansFrom(items, viewport) {
  const output = [];
  const matrix = viewport.transform || [1, 0, 0, -1, 0, viewport.height];
  for (const item of items) {
    const text = typeof item.text === "string" ? item.text : item.str;
    if (typeof text !== "string" || !text.trim()) continue;
    if (Number.isFinite(item.x) && Number.isFinite(item.y) && item.width > 0 && item.height > 0) {
      output.push({ text, x: item.x, y: item.y, width: item.width, height: item.height, baseline: item.y + item.height * .8 });
      continue;
    }
    const t = item.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite)) continue;
    const origin = matrixPoint(matrix, t[4], t[5]);
    const axis = matrixPoint(matrix, t[4] + t[0], t[5] + t[1]);
    const up = matrixPoint(matrix, t[4] + t[2], t[5] + t[3]);
    const length = Math.hypot(axis.x - origin.x, axis.y - origin.y);
    const height = Math.hypot(up.x - origin.x, up.y - origin.y);
    if (!length || !height) continue;
    const scale = Math.hypot(matrix[0], matrix[1]);
    const width = Math.abs(item.width || 0) * scale;
    if (!width) continue;
    const dx = (axis.x - origin.x) / length * width, dy = (axis.y - origin.y) / length * width;
    const ux = up.x - origin.x, uy = up.y - origin.y;
    const points = [
      { x: origin.x + ux, y: origin.y + uy }, { x: origin.x + dx + ux, y: origin.y + dy + uy },
      { x: origin.x - ux * .25, y: origin.y - uy * .25 }, { x: origin.x + dx - ux * .25, y: origin.y + dy - uy * .25 },
    ];
    const box = union(points.map(p => ({ ...p, width: 0, height: 0 })));
    output.push({ text, ...box, baseline: origin.y });
  }
  return output;
}
function rowsFrom(spans, em) {
  const rows = [];
  for (const span of spans.slice().sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const row = rows.find(row => Math.abs(row.baseline - span.baseline) <= em * .38);
    if (row) row.spans.push(span);
    else rows.push({ baseline: span.baseline, spans: [span] });
  }
  return rows.map(row => {
    row.spans.sort((a, b) => a.x - b.x);
    return { ...row, ...union(row.spans), text: row.spans.map(s => s.text).join(" ") };
  });
}
function prose(text) {
  const plain = text.replace(LABEL, "");
  const han = (plain.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) || []).length;
  if (han >= 5) return true;
  const words = plain.match(/[A-Za-z]{3,}/g) || [];
  return words.length >= 5 && !/[=∑∏∫≤≥]/u.test(plain);
}
function labelsFrom(rows, em, width) {
  const labels = [];
  for (const row of rows) {
    // Joining only a close group handles PDF.js splitting "(7.11)" into glyphs.
    for (let i = 0; i < row.spans.length; i++) {
      const group = [];
      for (let j = i; j < Math.min(i + 8, row.spans.length); j++) {
        const span = row.spans[j];
        if (group.length && span.x - right(group.at(-1)) > em * 1.3) break;
        group.push(span);
        const text = group.map(s => s.text).join("");
        const matches = [...text.matchAll(LABEL)];
        const exact = matches.length === 1 && compact(matches[0][0]) === compact(text);
        // Corrupted numbered labels still separate adjacent formula rows; their
        // unknown number is never repaired or offered as an exact match.
        const boundaryOnly = /^[（(][^（）()]{1,14}[)）]$/.test(compact(text)) && /\d/.test(text);
        if (!exact && !boundaryOnly) continue;
        const bounds = union(group);
        // A prose reference is not an equation anchor. Require a right-side,
        // terminal label, separated from the mathematical expression.
        if (bounds.x < width * .48 || row.spans.slice(j + 1).some(s => s.text.trim())) break;
        const previous = row.spans[i - 1];
        if (previous && bounds.x - right(previous) < em * 2) break;
        const label = exact ? normalizeLabel(matches[0][0]) : compact(text);
        if (!labels.some(found => found.label === label && Math.abs(found.baseline - row.baseline) < em))
          labels.push({ label, bounds, baseline: median(group.map(span => span.baseline)), spans: group });
        break;
      }
    }
  }
  return labels;
}
function sourceRange(excerpt, label, cropText, originalText = cropText, uniqueAnchor = false) {
  const matches = [...excerpt.matchAll(LABEL)].filter(match => normalizeLabel(match[0]) === label);
  if (!matches.length) return {};
  if (matches.length === 1) {
    const match = matches[0];
    const lineStart = excerpt.lastIndexOf("\n", match.index - 1) + 1;
    const nextBreak = excerpt.indexOf("\n", match.index + match[0].length);
    const lineEnd = nextBreak < 0 ? excerpt.length : nextBreak;
    const body = excerpt.slice(lineStart, match.index) + excerpt.slice(match.index + match[0].length, lineEnd);
    // The same line must contain recognizable equation text, not prose or merely
    // a floating number. Never delete adjoining text based on a guessed OCR fix.
    if (/[=∑∏∫≤≥]/u.test(body) && !prose(body) && compact(cropText).includes(compact(body)))
      return { start: lineStart, end: lineEnd };
    // A unique, visually located equation number also identifies its isolated
    // math line when OCR glyphs differ. The verified PDF pixels replace that
    // line; this does not reconstruct symbols or absorb neighbouring prose.
    const mathLength = compact(body).length;
    const mathCharacters = /^[A-Za-z\p{Script=Greek}\d\s{}()[\].,+*/^_=<>|\\−—∑∏∫√≤≥≠≈∞₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹-]+$/u.test(body);
    const mathWords = body.replace(/\barg\s*m\s*(?:ax|in)\b/g, " ").match(/[A-Za-z]{2,}/g) || [];
    if (uniqueAnchor && mathLength >= 5 && mathLength <= 240 && mathCharacters && /[=∑∏∫≤≥]/u.test(body) &&
      mathWords.every(word => /^(?:LL|Pr|ln|log|exp|sin|cos|tan|min|max)$/.test(word)))
      return { start: lineStart, end: lineEnd };
  }
  // PDF extraction can put an equation's number on a separate line. Reuse only
  // a substantial, unique, character-for-character body match after removing
  // whitespace. The PDF's actual extraction order is a second exact candidate,
  // not a guessed permutation of the visual order. Repeated bodies stay intact,
  // even when the same equation number is also referenced elsewhere in prose.
  const positions = [];
  let normalized = "";
  for (let index = 0; index < excerpt.length; index++) {
    if (/\s/u.test(excerpt[index])) continue;
    normalized += excerpt[index];
    positions.push(index);
  }
  for (const candidate of new Set([cropText, originalText])) {
    const needle = compact(candidate);
    if (needle.length < 8 || !/[=∑∏∫≤≥√^_]/u.test(needle) || prose(candidate)) continue;
    const start = normalized.indexOf(needle);
    if (start < 0 || normalized.indexOf(needle, start + 1) >= 0) continue;
    return { start: positions[start], end: positions[start + needle.length - 1] + 1 };
  }
  return {};
}

/** Viewport coordinates are top-left based and have the viewport's own scale.
 * Only exact equation labels present in the excerpt qualify. No match => [].
 */
export function locatePdfFormulae(items, viewport, excerpt, { maxCrops = 2 } = {}) {
  if (!Array.isArray(items) || !viewport || !(viewport.width > 0) || !(viewport.height > 0) || typeof excerpt !== "string" || maxCrops <= 0) return [];
  const requested = new Set([...excerpt.matchAll(LABEL)].map(match => normalizeLabel(match[0])));
  if (!requested.size) return [];
  const spans = spansFrom(items, viewport);
  if (!spans.length) return [];
  const em = median(spans.map(s => s.height));
  const rows = rowsFrom(spans, em);
  const labels = labelsFrom(rows, em, viewport.width);
  const output = [];
  for (const anchor of labels) {
    if (!requested.has(anchor.label)) continue;
    const center = anchor.baseline;
    const maxDistance = em * 2.5;
    // Main-text prose bounds limit vertical padding while leaving space for
    // fraction rules and scripts absent from the PDF's (often damaged) text.
    const mainRows = rows.filter(row => row.spans.some(s => s.x > viewport.width * .25 && right(s) < anchor.bounds.x + em) && prose(row.text));
    const previous = mainRows.filter(row => row.baseline < center - em * .6).at(-1);
    const next = mainRows.find(row => row.baseline > center + em * .6);
    const otherAbove = labels.filter(label => label.baseline < center - em).at(-1);
    const otherBelow = labels.find(label => label.baseline > center + em);
    const minY = Math.max(0, center - maxDistance, previous ? bottom(previous) + em * .2 : 0,
      otherAbove ? (otherAbove.baseline + center) / 2 + em * .2 : 0);
    const maxY = Math.min(viewport.height, center + maxDistance, next ? next.y - em * .2 : viewport.height,
      otherBelow ? (otherBelow.baseline + center) / 2 : viewport.height);
    const candidates = spans.filter(s => !anchor.spans.includes(s) && s.baseline >= minY && s.baseline <= maxY &&
      right(s) < anchor.bounds.x - em && s.x > Math.max(0, anchor.bounds.x - viewport.width * .62) && !prose(s.text));
    if (!candidates.length) continue;
    // Remove a disconnected marginal annotation rather than swallowing all
    // text at the same height. Work outwards from the content nearest the label.
    const ordered = candidates.slice().sort((a, b) => right(b) - right(a));
    const selected = [ordered[0]];
    let edge = ordered[0].x;
    for (const span of ordered.slice(1)) {
      if (edge - right(span) > em * 3) break;
      selected.push(span);
      edge = Math.min(edge, span.x);
    }
    const text = selected.slice().sort((a, b) => a.baseline - b.baseline || a.x - b.x).map(s => s.text).join(" ");
    const selectedSet = new Set(selected);
    const originalText = spans.filter(span => selectedSet.has(span)).map(span => span.text).join(" ");
    const mathematical = /[=+−—*/^_∑∏∫√≤≥\\|]/u.test(text) ||
      (selected.length >= 3 && selected.some(span => span.height < em * .8));
    if (!mathematical || prose(text) || compact(text).length < 2) continue;
    const content = union([...selected, ...anchor.spans]);
    const x = Math.max(0, content.x - em * 1.4);
    const y = Math.max(minY, content.y - em * .65);
    const x2 = Math.min(viewport.width, right(content) + em * .6);
    const y2 = Math.min(maxY, Math.max(bottom(content) + em * .85, center + em * 1.6));
    if (x2 <= x || y2 <= y) continue;
    // Keep a compact formula beside its own introduction, not the first
    // paragraph of a long search hit. Only reuse text present in this excerpt.
    const nearby = rows.filter(row => row.baseline < minY && row.baseline > Math.max(center - em * 9, otherAbove?.baseline ?? 0))
      .map(row => row.spans.filter(s => s.x > viewport.width * .25 && right(s) < viewport.width * .97).map(s => s.text).join(" "))
      .filter(text => (prose(text) || (/[\p{Script=Han}]/u.test(text) && !/[=∑∏∫]/u.test(text))) && !/^(?:(?:\d+\s*)?第\s*[\d一二三四五六七八九十百]+\s*[章节篇]|\d+(?:\.\d+)+\s*[\p{Script=Han}])/u.test(text) && compact(excerpt).includes(compact(text))).slice(-3);
    const context = nearby.length ? nearby.join("\n").replace(/(?<=\p{Script=Han})[ \t]+(?=\p{Script=Han})/gu, "") : undefined;
    output.push({ label: anchor.label, bounds: { x, y, width: x2 - x, height: y2 - y }, text,
      context,
      ...sourceRange(excerpt, anchor.label, text, originalText, labels.filter(candidate => candidate.label === anchor.label).length === 1) });
    if (output.length >= maxCrops) break;
  }
  return output;
}
