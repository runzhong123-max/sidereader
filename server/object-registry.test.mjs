import test from "node:test";
import assert from "node:assert/strict";
import { objectDefinition, surfaceDefinition } from "../src/domain/objects.mjs";
import { normalizeObject, objectLabels, objectMarkdown, parseAnswer, answerForPaper } from "../src/learning-objects.mjs";

test("object content and workspace surfaces cannot be confused when normalizing model output", () => {
  for (const kind of ["graph", "path", "questions", "paper", "__proto__", "constructor", "toString", {}, null]) {
    assert.equal(objectDefinition(kind), undefined);
    assert.equal(normalizeObject({ kind, content: "not an inline content object" }, "stable-id"), null);
  }
  for (const kind of ["chat", "book", "formula", "question", "__proto__"]) {
    assert.equal(surfaceDefinition(kind), undefined);
  }
  const note = normalizeObject({ kind: "note", content: "保存下来的推理" }, "message:object:4");
  assert.equal(note.title, "笔记", "saved content must not be named after the follow-up conversation action");
  assert.equal(note.id, "message:object:4", "display terminology cannot migrate content identity");
  assert.equal(objectLabels.table, "表格");
  assert.equal(objectLabels.plot, "图表");
});

test("graph and practice surfaces share presentation capabilities but preserve distinct ownership scopes", () => {
  assert.equal(surfaceDefinition("graph").scope, "project-and-chapter");
  assert.equal(surfaceDefinition("path").scope, "project");
  assert.equal(surfaceDefinition("questions").projectTitle, "练习总览");
  assert.equal(surfaceDefinition("paper").title, "学习对象");
  for (const kind of ["graph", "path", "questions", "paper"]) {
    const definition = surfaceDefinition(kind);
    assert.equal(definition.canCompare, true);
    assert.equal(definition.canFloat, true);
    assert.equal(Object.isFrozen(definition), true, "one surface cannot alter labels/capabilities for another view");
  }
});

test("card Markdown and whole-answer copying keep code inert and use the same language/fence policy", () => {
  const code = { id: "o", kind: "code", content: 'print("```\\n$$not math$$")', language: "python" };
  const markdown = objectMarkdown(code);
  assert.match(markdown, /^````python\n/);
  const parsed = parseAnswer(markdown, "m");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].object.kind, "code");
  assert.equal(parsed[0].object.content, code.content);
  assert.equal(answerForPaper(markdown, "m"), markdown);

  for (const kind of ["ascii", "pseudocode"]) {
    const raw = "```sidereader-object\n" + JSON.stringify({ kind, content: "a -> b", language: "javascript" }) + "\n```";
    const object = parseAnswer(raw, "m")[0].object;
    assert.equal(objectMarkdown(object), "```text\na -> b\n```");
    assert.equal(answerForPaper(raw, "m"), objectMarkdown(object));
  }
});
