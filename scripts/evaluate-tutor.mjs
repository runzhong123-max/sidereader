// Explicit --live opt-in: uses the configured local provider and incurs API usage.
import { mkdir, writeFile } from "node:fs/promises";
if (!process.argv.includes("--live")) {
  console.log("Run: node scripts/evaluate-tutor.mjs --live");
  process.exit(0);
}
const base = process.env.SIDEREADER_URL || "http://127.0.0.1:3001";
const status = await fetch(`${base}/api/status`).then((r) => r.json());
if (!status.configured)
  throw new Error("Configure a model before running live evaluations.");
const chunks = [
  {
    id: "eval:1",
    sourceId: "eval",
    title: "评估用知识片段",
    page: 1,
    text: "香农熵 H(Y)=-Σ p(y)log₂p(y)。二分类概率各为1/2时熵为1 bit；类别确定时为0。信息增益等于划分前的熵减去划分后各子集熵的加权平均。信息增益倾向取值数较多的属性。",
  },
  {
    id: "eval:2",
    sourceId: "eval",
    title: "评估用知识片段",
    page: 2,
    text: "二分查找要求有序序列；每轮将候选区间缩小约一半，最坏时间复杂度O(log n)。朴素线性扫描最坏为O(n)。迭代二分查找必须确保每次更新严格缩小区间，避免无限循环。",
  },
];
const cases = [
  {
    id: "math",
    question:
      "我是刚学机器学习的程序员。为什么二分类各占一半时熵最大？请解释符号，用数字验证，并给一个很短的Python示例。",
    teachingStyle: "explain",
    anchor: { sourceId: "eval", page: 1 },
  },
  {
    id: "guide",
    question:
      "我知道二分查找每次砍掉一半，但不理解为什么是log n。给我一个提示，不要一次讲完。",
    teachingStyle: "guide",
    anchor: { sourceId: "eval", page: 2 },
  },
  {
    id: "check",
    question: "针对二分查找出一道预测题，先别给答案。",
    teachingStyle: "check",
    anchor: { sourceId: "eval", page: 2 },
  },
  {
    id: "feedback",
    question: "我认为需要100次，因为数组有100个元素。",
    teachingStyle: "check",
    history: [
      { role: "user", content: "考考我的二分查找复杂度。" },
      {
        role: "assistant",
        content:
          "一个有100个元素的有序数组，二分查找最多大约比较几次？解释原因。",
      },
    ],
    anchor: { sourceId: "eval", page: 2 },
  },
  {
    id: "debug",
    question: "我的Python二分查找死循环了，怎么修？",
    teachingStyle: "explain",
    anchor: { sourceId: "eval", page: 2 },
  },
  {
    id: "project",
    question:
      "我会Python，希望做一个检索学习助手。用三个阶段规划，每步给验收方式。",
    mode: "project",
    teachingStyle: "explain",
    goal: "构建一个可验证的学习助手",
    projectState: { stages: [{ title: "Python基础", done: true }] },
  },
];
const results = [];
const chosen = process.env.EVAL_CASES
  ? cases.filter((c) => process.env.EVAL_CASES.split(",").includes(c.id))
  : cases;
for (let i = 0; i < chosen.length; i += 2) {
  const batch = await Promise.all(
    chosen.slice(i, i + 2).map(async (item) => {
      const start = Date.now();
      try {
        const response = await fetch(`${base}/api/tutor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chunks, mode: "learning", ...item }),
          signal: AbortSignal.timeout(190000),
        });
        const data = await response.json();
        return {
          id: item.id,
          question: item.question,
          ok: response.ok,
          elapsedMs: Date.now() - start,
          ...data,
        };
      } catch (e) {
        return { id: item.id, ok: false, error: e.message };
      }
    }),
  );
  results.push(...batch);
  for (const r of batch)
    console.log(
      `${r.id}: ${r.ok ? "received" : "failed"} ${r.elapsedMs || 0}ms`,
    );
}
await mkdir("output/evals", { recursive: true });
await writeFile(
  "output/evals/tutor-live.json",
  JSON.stringify(
    { date: new Date().toISOString(), model: status.model, results },
    null,
    2,
  ),
);
console.log(
  "Saved output/evals/tutor-live.json; semantic quality needs manual rubric review.",
);
