import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { processImportPages } from "../src/import-pages.mjs";
import { responseSignal } from "./request-signal.mjs";

test("failed page processing resumes from the first incomplete page", async () => {
  const completed = [],
    called = [];
  await assert.rejects(
    processImportPages(
      3,
      completed,
      async (page) => {
        called.push(page);
        if (page === 2) throw Error("temporary OCR failure");
        return { text: `page ${page}`, recognized: true };
      },
      new AbortController().signal,
    ),
    /OCR failure/,
  );
  assert.equal(completed.length, 1);
  await processImportPages(
    3,
    completed,
    async (page) => {
      called.push(page);
      return { text: `page ${page}`, recognized: true };
    },
    new AbortController().signal,
  );
  assert.deepEqual(called, [1, 2, 2, 3]);
  assert.equal(completed.length, 3);
});

test("stopping import preserves completed pages and starts no further work", async () => {
  const completed = [],
    called = [],
    controller = new AbortController();
  await assert.rejects(
    processImportPages(
      3,
      completed,
      async (page) => {
        called.push(page);
        if (page === 2) controller.abort();
        return { text: `page ${page}`, recognized: true };
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.deepEqual(called, [1, 2]);
  assert.equal(completed.length, 1);
});

test("client disconnect aborts upstream work, normal response completion does not", () => {
  const response = new EventEmitter();
  const job = responseSignal(response);
  response.emit("close");
  assert.equal(job.signal.aborted, true);
  job.release();
  assert.equal(response.listenerCount("close"), 0);
  const complete = new EventEmitter();
  complete.writableEnded = true;
  const finished = responseSignal(complete);
  complete.emit("close");
  assert.equal(finished.signal.aborted, false);
  finished.release();
});
