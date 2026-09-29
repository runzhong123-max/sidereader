// Preserve source symbols. Only complete, recognizable mathematical notation is
// given delimiters; damaged PDF equation fragments are never reconstructed.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}_]/u;
const PAGE_LABEL = /^(?:page\s+\d+(?:\s+(?:of|\/)\s*\d+)?|第\s*\d+\s*页(?:\s*[／/]\s*共?\s*\d+\s*页)?|\d+\s+第\s*[\d一二三四五六七八九十百]+\s*[章节篇]\s*\S.*)$/iu;
const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
const LIST = /^ {0,3}(?:[-+*]\s|\d+[.)]\s)/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const CHINESE_HEADING = /^(?:第\s*[\d一二三四五六七八九十百]+\s*[章节篇]\s*|\d+(?:\.\d+)+\s*|[一二三四五六七八九十]+[、．]\s*)[\p{Script=Han}A-Za-z][^，。！？；：,.!?;:]{1,45}$/u;
const NEW_THOUGHT = /^(?:于是|因此|所以|然而|但是|此外|另外|例如|注意|提示|其中|由此|综上|接下来|下面|首先|其次|最后|特别地|此时|假设|定义|定理|证明|(?:Therefore|However|Thus|Note|Remark|Example|Proof|Definition|Theorem|Finally|Next)\b)/;
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢⱼₓ";
const SUPERSCRIPTS = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ";
const SUB_VALUES = "0123456789+-=()nijx";
const SUPER_VALUES = "0123456789+-=()ni";
const MATH_COMMANDS = new Set("frac dfrac tfrac sqrt sum prod int lim log ln exp sin cos tan min max argmin argmax left right cdot times le leq ge geq neq approx in mid alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega mathrm mathbf mathcal operatorname hat bar vec".split(" "));

function normalizeUnicodeMath(value) {
  return value.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙᵢⱼₓ]+/gu, chars => `_{${[...chars].map(char => SUB_VALUES[SUBSCRIPTS.indexOf(char)]).join("")}}`)
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/gu, chars => `^{${[...chars].map(char => SUPER_VALUES[SUPERSCRIPTS.indexOf(char)]).join("")}}`);
}

function balancedMath(value) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{" };
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped(value, index)) continue;
    if ("([{".includes(char)) stack.push(char);
    else if (pairs[char] && stack.pop() !== pairs[char]) return false;
  }
  return stack.length === 0;
}

function completeMath(value) {
  const math = value.trim().replace(/[,.，。]\s*$/, "");
  if (!math || math.length > 350 || !balancedMath(math) || /\barg\s+(?:m\s+ax|ma\s+x|m\s+in|mi\s+n)\b/i.test(math)) return false;
  if (!/^[A-Za-z\p{Script=Greek}\d\s{}()[\].,+*/^_=<>|\\−≤≥≠≈∑∏∫√∞₀-₉₊₋₌₍₎ₙᵢⱼₓ⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ-]+$/u.test(math)) return false;
  if (/^[=+*/^_<>]|[=+*/^_<>−-]\s*$|[(=+*/|]\s*[_^]|[_^]\s*(?:[=+*/|)]|$)/.test(math)) return false;
  const commands = [...math.matchAll(/\\([A-Za-z]+)/g)];
  if (commands.some(match => !MATH_COMMANDS.has(match[1]))) return false;
  const words = math.replace(/\\[A-Za-z]+/g, "").match(/[A-Za-z]+/g) || [];
  if (words.some(word => word.length > 1 && !/^(?:Pr|sin|cos|tan|log|ln|exp|arg|min|max|argmin|argmax)$/.test(word))) return false;
  const conditional = [...math.matchAll(/\b(?:P|Pr|R|p)\s*\(([^()]*(?:\||\\mid)[^()]*)\)/g)];
  if (conditional.some(match => {
    const sides = match[1].split(/\||\\mid/);
    return sides.length !== 2 || sides.some(side => !side.trim() || /[=+*/^_<>−-]\s*$/.test(side));
  })) return false;
  // Require brace arguments for inferred TeX; incomplete \frac{a} stays raw.
  for (const match of commands) {
    const arity = /^(?:dfrac|tfrac|frac)$/.test(match[1]) ? 2 : /^(?:sqrt|mathrm|mathbf|mathcal|operatorname|hat|bar|vec)$/.test(match[1]) ? 1 : 0;
    let at = match.index + match[0].length;
    for (let argument = 0; argument < arity; argument++) {
      while (/\s/.test(math[at] || "")) at++;
      if (math[at] !== "{") return false;
      let depth = 1;
      while (++at < math.length && depth) {
        if (escaped(math, at)) continue;
        if (math[at] === "{") depth++;
        if (math[at] === "}") depth--;
      }
      if (depth) return false;
    }
  }
  return conditional.length > 0 ||
    commands.some(match => /^(?:frac|dfrac|tfrac|sqrt|sum|prod|int)$/.test(match[1])) ||
    (/[\p{Script=Greek}]/u.test(math) && /[=<>≤≥≠≈₀-₉ₙᵢⱼₓ⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ_^]/u.test(math));
}

function escaped(text, index) {
  let slashes = 0;
  while (index > 0 && text[--index] === "\\") slashes++;
  return slashes % 2 === 1;
}

function closing(text, delimiter, from) {
  let index = text.indexOf(delimiter, from);
  while (index >= 0 && escaped(text, index)) index = text.indexOf(delimiter, index + delimiter.length);
  return index;
}

function tokenize(source) {
  // Pick a marker absent from the input, including unusual OCR/control content.
  let marker = "\u0000source:";
  while (source.includes(marker)) marker += ":";
  const values = [];
  const literalDollars = new Set();
  const put = (text, block = false) => {
    const token = `${marker}${values.length}\u0000`;
    values.push({ text, block });
    return block ? `\n\n${token}\n\n` : token;
  };
  let output = "";
  let uncertain = /[\uFFFD\p{Co}]/u.test(source) || /\barg\s+(?:m\s+ax|ma\s+x|m\s+in|mi\s+n)\b/i.test(source);
  for (let i = 0; i < source.length;) {
    const lineStart = i === 0 || source[i - 1] === "\n";
    if (lineStart) {
      const lineEnd = source.indexOf("\n", i);
      const line = source.slice(i, lineEnd < 0 ? source.length : lineEnd);
      const fence = line.match(FENCE);
      if (fence) {
        const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}[ \\t]*$`, "m");
        const restAt = lineEnd < 0 ? source.length : lineEnd + 1;
        const match = source.slice(restAt).match(close);
        const end = match ? restAt + match.index + match[0].length : source.length;
        output += put(source.slice(i, end), true);
        uncertain ||= !match;
        i = end;
        continue;
      }
      if (/^(?: {4}|\t)/.test(line)) {
        let end = lineEnd < 0 ? source.length : lineEnd;
        while (end < source.length) {
          const nextEnd = source.indexOf("\n", end + 1);
          const next = source.slice(end + 1, nextEnd < 0 ? source.length : nextEnd);
          if (!/^(?: {4}|\t)/.test(next)) break;
          end = nextEnd < 0 ? source.length : nextEnd;
        }
        output += put(source.slice(i, end), true);
        i = end;
        continue;
      }
      if (completeMath(line)) {
        output += put(`$$\n${normalizeUnicodeMath(line.trim())}\n$$`, true);
        i = lineEnd < 0 ? source.length : lineEnd;
        continue;
      }
      if (!/^ {0,3}(?:={3,}|-{3,})\s*$/.test(line) && formulaFragment(line) && (!balancedMath(line) || /[=+*/^_−-]\s*$/.test(line))) {
        uncertain = true;
        output += put(line, true);
        i = lineEnd < 0 ? source.length : lineEnd;
        continue;
      }
    }
    if (source[i] === "`" && !escaped(source, i)) {
      const run = source.slice(i).match(/^`+/)[0];
      const end = closing(source, run, i + run.length);
      if (end >= 0) {
        output += put(source.slice(i, end + run.length));
        i = end + run.length;
        continue;
      }
    }
    let open = "";
    let close = "";
    let block = false;
    if (!escaped(source, i)) {
      if (source.startsWith("\\[", i)) { open = "\\["; close = "\\]"; block = true; }
      else if (source.startsWith("\\(", i)) { open = "\\("; close = "\\)"; }
      else if (source.startsWith("$$", i)) { open = close = "$$"; block = true; }
      else if (source[i] === "$" && !literalDollars.has(i)) { open = close = "$"; }
    }
    if (open) {
      const end = closing(source, close, i + open.length);
      const inlineDollar = close === "$";
      const body = source.slice(i + open.length, end);
      const nextPrice = inlineDollar && /\d/.test(source[end + 1] || "");
      // In "$10 and $20", the second price must not then consume a later
      // genuine math opener. Spacing by itself is legal inside math delimiters.
      if (nextPrice && end >= 0) literalDollars.add(end);
      const priceProse = /^\d[\d,.]*(?:[;:!?]\s+[A-Za-z]|\s+(?:and|or|per|each|dollars?)\b)/i.test(body);
      const validDollar = !inlineDollar || (Boolean(body.trim()) && !nextPrice && !priceProse && !body.includes("\n\n"));
      if (end >= 0 && validDollar) {
        output += put(block ? `$$\n${body.trim()}\n$$` : `$${body.replace(/\n\s*/g, " ").trim()}$`, block);
        i = end + close.length;
        continue;
      }
      // An ordinary price such as "$10" is not evidence of broken OCR math.
      uncertain ||= open !== "$" || /^\$[^\n]*\\[a-z]+/i.test(source.slice(i));
    }
    // A rejected dollar pair must also stay literal in remark-math. Escaping
    // changes Markdown syntax only; the reader still sees the original price.
    if (source[i] === "$" && !escaped(source, i)) {
      output += "\\$";
      i++;
      continue;
    }
    if (!/[A-Za-z\\]/.test(source[i - 1] || "")) {
      const probability = source.slice(i).match(/^(?:P|Pr|R|p)\s*\([^()\n]{1,100}\)/)?.[0];
      const unicodeVariable = source.slice(i).match(/^[A-Za-z\p{Script=Greek}][₀-₉ₙᵢⱼₓ⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ]+/u)?.[0];
      const inferred = probability && completeMath(probability) ? probability : unicodeVariable;
      if (inferred) {
        output += put(`$${normalizeUnicodeMath(inferred)}$`);
        i += inferred.length;
        continue;
      }
    }
    output += source[i++];
  }
  const pattern = new RegExp(`${marker}(\\d+)\u0000`, "g");
  return { output, values, pattern, uncertain };
}

function joinLines(lines) {
  return lines.reduce((result, line) => {
    const next = line.trim();
    if (!result) return next;
    const before = result.at(-1);
    const after = next[0];
    const gap = CJK.test(before) || CJK.test(after) || /[，。！？；：、）】》]/u.test(after) ||
      /[（【《]/u.test(before) || (before === "-" && /^[a-z]/.test(next)) ? "" : " ";
    return result + gap + next;
  }, "");
}

function tableDivider(line) {
  const cells = line.trim().replace(/^\||\|$/g, "").split("|");
  return cells.length > 1 && cells.every(cell => /^\s*:?-{3,}:?\s*$/.test(cell));
}

function formulaFragment(line) {
  return /^\s*(?:[\p{L}\p{N}\s{}()[\].,+*/^_−–=<>≤≥∑∏∫√∞|\\-]{1,90})\s*$/u.test(line) &&
    (/[=≤≥∑∏∫√]/u.test(line) || /\\(?:frac|sum|int|begin|end|sqrt|left|right)\b/.test(line));
}

function blocksFrom(tokenized) {
  const lines = tokenized.output.split("\n");
  const blocks = [];
  const plain = [];
  const flush = () => { if (plain.length) blocks.push({ text: joinLines(plain.splice(0)), atomic: false }); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    tokenized.pattern.lastIndex = 0;
    const token = tokenized.pattern.exec(line);
    const blockToken = token && token[0] === line.trim() && tokenized.values[Number(token[1])].block;
    const table = line.includes("|") && i + 1 < lines.length && tableDivider(lines[i + 1]);
    const setext = i + 1 < lines.length && /^ {0,3}(?:={3,}|-{3,})\s*$/.test(lines[i + 1]);
    const structural = PAGE_LABEL.test(line.trim()) || CHINESE_HEADING.test(line.trim()) || HEADING.test(line) || LIST.test(line) || /^ {0,3}>/.test(line) || /^ {4}|^\t/.test(line) || /^ {0,3}(?:[-*_]\s*){3,}$/.test(line);
    const fragment = formulaFragment(line);
    if (blockToken || table || setext || structural || fragment) {
      flush();
      const grouped = [line];
      if (table) {
        grouped.push(lines[++i]);
        while (i + 1 < lines.length && lines[i + 1].trim() && lines[i + 1].includes("|")) grouped.push(lines[++i]);
      } else if (setext) grouped.push(lines[++i]);
      else if (LIST.test(line) || /^ {0,3}>/.test(line) || /^ {4}|^\t/.test(line)) {
        // Keep list continuations and indentation exactly as extracted.
        while (i + 1 < lines.length && lines[i + 1].trim() && !HEADING.test(lines[i + 1])) {
          grouped.push(lines[++i]);
        }
      }
      if (fragment && (/[=+*/^_−-]\s*$/.test(line) ||
        (line.match(/(?<!\\)\{/g) || []).length !== (line.match(/(?<!\\)\}/g) || []).length)) tokenized.uncertain = true;
      blocks.push({ text: grouped.join("\n"), atomic: true, list: LIST.test(line) });
    } else {
      if (plain.length && /[。！？；：.!?;:]\s*$/.test(plain.at(-1)) && NEW_THOUGHT.test(line.trim())) flush();
      plain.push(line);
      // Markdown's explicit hard line break is intentional.
      if (/ {2}$|\\$/.test(line)) {
        const previous = plain.pop();
        const prefix = plain.length ? `${joinLines(plain)} ` : "";
        plain.length = 0;
        blocks.push({ text: prefix + previous, atomic: true, hardBreak: true });
      }
    }
  }
  flush();
  return blocks;
}

function assemble(blocks, tokenized) {
  let markdown = "";
  const ranges = [];
  const sections = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (index) markdown += blocks[index - 1].hardBreak ? "\n" : "\n\n";
    const start = markdown.length;
    let position = 0;
    tokenized.pattern.lastIndex = 0;
    for (const match of block.text.matchAll(tokenized.pattern)) {
      markdown += block.text.slice(position, match.index);
      const value = tokenized.values[Number(match[1])];
      const text = value.text;
      ranges.push([markdown.length, markdown.length + text.length, value.block]);
      markdown += text;
      position = match.index + match[0].length;
    }
    markdown += block.text.slice(position);
    if (block.list) {
      // Each complete top-level item is independently readable. Keeping the
      // entire list atomic would hide a late search hit behind preceding items.
      const body = markdown.slice(start);
      const indent = body.match(/^ */)[0].length;
      const item = new RegExp(`^ {${indent}}(?:[-+*]\\s|\\d+[.)]\\s)`, "gm");
      const starts = [...body.matchAll(item)].map(match => start + match.index);
      for (let j = 0; j < starts.length; j++) {
        const end = starts[j + 1] ?? markdown.length;
        ranges.push([starts[j], end, true]);
        sections.push([starts[j], end]);
      }
    } else {
      sections.push([start, markdown.length]);
      if (block.atomic) ranges.push([start, markdown.length, true]);
    }
  }
  // Avoid cutting ordinary Markdown links or emphasis in the middle. These
  // guards affect excerpt boundaries only; the renderer still owns HTML safety.
  const inline = /!?\[[^\]\n]*\]\([^\n]*?\)|!?\[[^\]\n]*\]\[[^\]\n]*\]|(\*\*|__|~~)(?=\S)[\s\S]*?\1|(?<!\w)(\*|_)(?=\S)[^\n]*?\2(?!\w)/g;
  for (const match of markdown.matchAll(inline)) ranges.push([match.index, match.index + match[0].length]);
  return { markdown, ranges, sections };
}

/** Prepare a readable view without modifying or reconstructing the source.
 * maxChars is a soft limit: complete math/code/table blocks and the query are
 * retained even when one is longer. Omit it for the complete source view.
 */
export function prepareSourceExcerpt(text, { query = "", maxChars = Infinity } = {}) {
  const original = String(text ?? "").replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "").trim();
  const budget = Number.isFinite(maxChars) ? Math.max(1, Math.floor(maxChars)) : Infinity;
  let needle = String(query ?? "").trim().toLowerCase();
  let source = original;
  let omittedHeader = false;
  if (budget < Infinity) {
    const lines = source.split("\n");
    // A leading page label is recognizable; an ordinary title is not.
    while (lines.length > 1 && PAGE_LABEL.test(lines[0].trim()) && (!needle || !lines[0].toLowerCase().includes(needle))) {
      lines.shift();
      while (lines.length && !lines[0].trim()) lines.shift();
      omittedHeader = true;
    }
    source = lines.join("\n");
  }
  const tokenized = tokenize(source);
  const { markdown, ranges, sections } = assemble(blocksFrom(tokenized), tokenized);
  if (needle && !markdown.toLowerCase().includes(needle)) needle = normalizeUnicodeMath(needle);
  const hit = needle ? markdown.toLowerCase().indexOf(needle) : -1;
  if (budget === Infinity || (hit < 0 && markdown.length <= budget)) return { markdown, truncated: omittedHeader, hasUncertainText: tokenized.uncertain };
  const size = Math.max(budget, hit < 0 ? 0 : needle.length);
  let start = hit < 0 ? 0 : Math.max(0, hit - Math.min(35, Math.floor((size - needle.length) / 2)));
  if (hit >= 0) {
    const section = sections.find(([left, right]) => left <= hit && hit < right);
    if (section) start = Math.max(start, section[0]);
  }
  let end = Math.min(markdown.length, start + size);
  // Include whole boundary words, then expand across protected syntax. The
  // expansion is monotonic, so overlapping ranges terminate deterministically.
  if (hit >= 0) {
    while (start < hit && start > 0 && WORD.test(markdown[start - 1]) && WORD.test(markdown[start]) && !CJK.test(markdown[start])) start++;
  }
  const initialEnd = end;
  while (end < markdown.length && end - initialEnd < 35 && WORD.test(markdown[end - 1]) && WORD.test(markdown[end]) && !CJK.test(markdown[end])) end++;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [left, right] of ranges) {
      if (left < start && start < right) { start = left; changed = true; }
      if (left < end && end < right) { end = right; changed = true; }
    }
  }
  const before = Boolean(markdown.slice(0, start).trim());
  const after = Boolean(markdown.slice(end).trim());
  const startsBlock = ranges.some(([left, , block]) => block && left === start);
  const endsBlock = ranges.some(([, right, block]) => block && right === end);
  return {
    markdown: `${before ? (startsBlock ? "…\n\n" : "… ") : ""}${markdown.slice(start, end).trim()}${after ? (endsBlock ? "\n\n…" : " …") : ""}`,
    truncated: omittedHeader || before || after,
    hasUncertainText: tokenized.uncertain,
  };
}
