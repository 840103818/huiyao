import type { Analysis, AnalysisFieldKey, PromptOptimizationTarget, PromptVersion, ResultRevision, ReverseResult } from "../../shared/contracts";

export const ANALYSIS_FIELDS: AnalysisFieldKey[] = [
  "subject", "scene", "composition", "lighting", "tonality",
  "colors", "materials", "style", "camera", "postProcessing",
];

export const MAX_RESULT_REVISIONS = 12;

export function legacyRevision(version: PromptVersion, analysis: Analysis): ResultRevision {
  return {
    id: version.id,
    title: version.title,
    origin: version.origin === "manual" ? "promptEdit" : "optimization",
    sourceRevisionId: version.sourceVersionId === "base" ? undefined : version.sourceVersionId,
    analysis,
    lockedFields: [],
    prompts: version.prompts,
    negativePrompts: version.negativePrompts,
    target: version.target,
    requirements: version.requirements,
    syncState: "synced",
    metadata: version.metadata,
  };
}

export function resultRevisions(result: ReverseResult): ResultRevision[] {
  if (result.resultRevisions?.length) return result.resultRevisions.slice(0, MAX_RESULT_REVISIONS);
  return (result.promptVersions ?? []).map((version) => legacyRevision(version, result.analysis)).slice(0, MAX_RESULT_REVISIONS);
}

export function activeResultRevision(result: ReverseResult): ResultRevision | undefined {
  const activeId = result.activeResultRevisionId ?? result.activePromptVersionId;
  return resultRevisions(result).find((revision) => revision.id === activeId);
}

export function activeResultView(result: ReverseResult): ReverseResult {
  const revision = activeResultRevision(result);
  return revision ? { ...result, analysis: revision.analysis, prompts: revision.prompts, metadata: revision.metadata } : result;
}

export function revisionTarget(revision?: ResultRevision): PromptOptimizationTarget {
  return revision?.target ?? "general";
}

export function withActiveRevision(result: ReverseResult, id?: string): ReverseResult {
  const revisions = resultRevisions(result);
  return {
    ...result,
    resultRevisions: revisions,
    activeResultRevisionId: id,
    activePromptVersionId: undefined,
  };
}

export function appendRevision(result: ReverseResult, revision: ResultRevision): ReverseResult {
  const revisions = resultRevisions(result);
  if (revisions.length >= MAX_RESULT_REVISIONS) throw new Error(`每个任务最多保存 ${MAX_RESULT_REVISIONS} 个派生修订`);
  return withActiveRevision({ ...result, resultRevisions: [...revisions, revision] }, revision.id);
}

export function removeRevision(result: ReverseResult, id: string): ReverseResult {
  const revisions = resultRevisions(result);
  const removedIds = revisionRemovalIds(revisions, id);
  const sourceId = revisions.find((revision) => revision.id === id)?.sourceRevisionId;
  const remaining = revisions.filter((revision) => !removedIds.has(revision.id));
  const fallbackId = sourceId && remaining.some((revision) => revision.id === sourceId)
    ? sourceId
    : undefined;
  return withActiveRevision({
    ...result,
    resultRevisions: remaining,
    promptVersions: remaining.length ? result.promptVersions : [],
    activePromptVersionId: undefined,
  }, fallbackId);
}

export function revisionRemovalIds(revisions: ResultRevision[], id: string): Set<string> {
  const removed = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const revision of revisions) {
      if (revision.sourceRevisionId && removed.has(revision.sourceRevisionId) && !removed.has(revision.id)) {
        removed.add(revision.id);
        changed = true;
      }
    }
  }
  return removed;
}

export function revisionLabel(revision: ResultRevision, index: number): string {
  if (revision.title) return revision.title;
  const origin = {
    manualAnalysis: "人工校正",
    aiRefinement: "AI 重测",
    promptEdit: "提示词编辑",
    optimization: "平台优化",
  }[revision.origin];
  return `${index + 1}. ${origin}`;
}
