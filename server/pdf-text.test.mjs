import { test } from "node:test";
import assert from "node:assert/strict";
import { readPdfText } from "../src/pdf-text.mjs";

test("PDF text preserves streamed items and styles without async iteration", async () => {
  let released = false;
  const chunks = [
    {
      items: [{ str: "Hello" }],
      styles: { f1: { fontFamily: "serif" } },
      lang: null,
    },
    {
      items: [{ str: "世界" }],
      styles: { f2: { fontFamily: "sans-serif" } },
      lang: "zh",
    },
  ];
  const text = await readPdfText({
    streamTextContent: () => ({
      getReader: () => ({
        async read() {
          return chunks.length
            ? { value: chunks.shift(), done: false }
            : { done: true };
        },
        releaseLock() {
          released = true;
        },
      }),
    }),
  });
  assert.deepEqual(
    text.items.map((item) => item.str),
    ["Hello", "世界"],
  );
  assert.deepEqual(Object.keys(text.styles), ["f1", "f2"]);
  assert.equal(text.lang, "zh");
  assert.equal(released, true);
});

test("PDF text releases its reader when extraction fails", async () => {
  let released = false;
  await assert.rejects(
    readPdfText({
      streamTextContent: () => ({
        getReader: () => ({
          async read() {
            throw new Error("broken stream");
          },
          releaseLock() {
            released = true;
          },
        }),
      }),
    }),
    /broken stream/,
  );
  assert.equal(released, true);
});
