import { useCallback, useEffect, useRef, useState } from "react";
import type { Concept, GraphCoverage, Project } from "./types";
import { api } from "./services/http";
import { autoGraphPlan, shouldGenerateGraph, nextAutoGraphState, applyAutoGraphResult } from "./auto-graph-state.mjs";

type GraphPlan = NonNullable<ReturnType<typeof autoGraphPlan>>;
type RunningGraph = { controller: AbortController; projectId: string; graphId: string; identity: string };
const identityFor = (projectId: string, plan: GraphPlan) => `${projectId}:${plan.graphId}:${plan.fingerprint}`;

/** Generate visible graph scopes serially, without restarting requests on layout changes. */
export function useAutomaticGraph(project: Project, activeIds: string | string[], enabled: boolean,
  updateProject: (id: string, change: (project: Project) => Project) => void) {
  const byGraph = new Map<string, GraphPlan>();
  for (const id of typeof activeIds === "string" ? [activeIds] : activeIds) {
    const candidate = autoGraphPlan(project, id);
    if (candidate && !byGraph.has(candidate.graphId)) byGraph.set(candidate.graphId, candidate);
  }
  const plans = [...byGraph.values()];
  const latest = useRef({ project, plans, enabled });
  latest.current = { project, plans, enabled };
  const request = useRef<RunningGraph | null>(null);
  const retries = useRef(new Set<string>());
  const mounted = useRef(true);
  const [revision, setRevision] = useState(0);
  const queueKey = plans.map((plan) => `${identityFor(project.id, plan)}:${project.paperTree?.nodes.find((node) => node.id === plan.graphId)?.autoGraph?.status || "new"}`).join("\n");

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    const visible = new Set(plans.map((plan) => identityFor(project.id, plan)));
    // A retry is an intent for the visible revision, not a hidden background job.
    for (const identity of retries.current) if (!visible.has(identity)) retries.current.delete(identity);
    if (!enabled || !queueKey || request.current) return;
    // Brief navigation through a scope should not start an extraction for every row.
    const timer = window.setTimeout(() => {
      const { project: origin, plans: candidates, enabled: stillEnabled } = latest.current;
      if (!stillEnabled || request.current) return;
      const target = candidates.find((plan) => retries.current.has(identityFor(origin.id, plan)))
        || candidates.find((plan) => shouldGenerateGraph(origin, plan));
      if (!target) return;
      const identity = identityFor(origin.id, target);
      retries.current.delete(identity);
      const controller = new AbortController();
      request.current = { controller, projectId: origin.id, graphId: target.graphId, identity };
      setRevision((value) => value + 1);
      updateProject(origin.id, (current) => nextAutoGraphState(current, target, { status: "generating", error: undefined, startedAt: new Date().toISOString() }));
      const timeout = window.setTimeout(() => controller.abort(new Error("图谱生成超时，请重试。")), 120_000);
      void api<{ concepts: Concept[] } & GraphCoverage>("/api/knowledge-graph", {
        scope: target.scope, chunks: target.chunks, existingConcepts: origin.concepts.slice(0, 2000),
      }, controller.signal).then((result) => {
        if (mounted.current) updateProject(origin.id, (current) => applyAutoGraphResult(current, target, result.concepts, { sampledPages: result.sampledPages, totalPages: result.totalPages, sampledChunks: result.sampledChunks, totalChunks: result.totalChunks, truncated: result.truncated }));
      }).catch((error: unknown) => {
        if (!mounted.current) return;
        updateProject(origin.id, (current) => nextAutoGraphState(current, target, {
          status: "error", error: controller.signal.aborted ? controller.signal.reason?.message || "图谱生成已中断，请重试。" : error instanceof Error ? error.message : "图谱生成失败，请重试。",
        }));
      }).finally(() => {
        window.clearTimeout(timeout);
        if (request.current?.controller === controller) request.current = null;
        if (mounted.current) setRevision((value) => value + 1);
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [queueKey, enabled, revision, updateProject]);

  const retry = useCallback((graphId?: string) => {
    const { project: origin, plans: candidates } = latest.current;
    const target = graphId ? candidates.find((plan) => plan.graphId === graphId) : candidates[0];
    if (!target) return;
    const identity = identityFor(origin.id, target);
    if (request.current?.identity === identity) return;
    retries.current.add(identity);
    setRevision((value) => value + 1);
  }, []);
  // Keep single-scope callers compatible while multi-view callers inspect all plans.
  const plan = plans[0];
  const graphNode = project.paperTree?.nodes.find((node) => node.id === plan?.graphId);
  const runningGraphId = request.current?.projectId === project.id ? request.current.graphId : undefined;
  return { plan, plans, graphNode, retry, busy: Boolean(request.current), runningGraphId };
}
