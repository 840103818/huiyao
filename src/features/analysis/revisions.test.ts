import { describe, expect, it } from "vitest";
import type { ResultRevision, ReverseResult } from "../../shared/contracts";
import { appendRevision, MAX_RESULT_REVISIONS, removeRevision, resultRevisions, revisionRemovalIds } from "./revisions";

const base: ReverseResult = {
  analysis: { subject: "主体", scene: "场景", composition: "构图", lighting: "光线", tonality: "影调", colors: "色彩", palette: [], materials: "材质", style: "风格", camera: "镜头", postProcessing: "后期" },
  prompts: { zh: "基础中文", en: "base English" },
  metadata: { model: "test", elapsedMs: 1, createdAt: "2026-01-01T00:00:00Z" },
};

function revision(id: string, sourceRevisionId?: string): ResultRevision {
  return {
    id, sourceRevisionId, title: id, origin: "manualAnalysis", analysis: base.analysis,
    lockedFields: [], prompts: base.prompts, negativePrompts: { zh: "", en: "" },
    requirements: "", syncState: "local", metadata: base.metadata,
  };
}

describe("result revisions", () => {
  it("lazily converts legacy prompt versions before appending a unified revision", () => {
    const legacy: ReverseResult = {
      ...base,
      promptVersions: [{
        id: "legacy", target: "sdxl", origin: "manual", title: "旧编辑版本",
        requirements: "", prompts: { zh: "旧中文", en: "legacy" },
        negativePrompts: { zh: "负面", en: "negative" }, metadata: base.metadata,
      }],
      activePromptVersionId: "legacy",
    };
    const next = appendRevision(legacy, revision("new", "legacy"));
    expect(next.resultRevisions).toHaveLength(2);
    expect(next.resultRevisions?.[0]).toMatchObject({ id: "legacy", origin: "promptEdit", syncState: "synced" });
    expect(next.activeResultRevisionId).toBe("new");
    expect(next.activePromptVersionId).toBeUndefined();
  });

  it("deletes the selected revision and all of its descendants after impact confirmation", () => {
    const revisions = [revision("a"), revision("b", "a"), revision("c", "b"), revision("sibling")];
    expect([...revisionRemovalIds(revisions, "a")]).toEqual(["a", "b", "c"]);
    const next = removeRevision({ ...base, resultRevisions: revisions, activeResultRevisionId: "a" }, "a");
    expect(resultRevisions(next).map((item) => item.id)).toEqual(["sibling"]);
    expect(next.activeResultRevisionId).toBeUndefined();
  });

  it("does not resurrect migrated legacy versions after deleting the last revision", () => {
    const migrated = {
      ...base,
      promptVersions: [{ id: "legacy", target: "general" as const, requirements: "", prompts: base.prompts, negativePrompts: { zh: "", en: "" }, metadata: base.metadata }],
      resultRevisions: [revision("legacy")],
      activeResultRevisionId: "legacy",
    };
    const next = removeRevision(migrated, "legacy");
    expect(resultRevisions(next)).toEqual([]);
    expect(next.promptVersions).toEqual([]);
  });

  it("enforces the twelve-derived-revision limit", () => {
    const full = { ...base, resultRevisions: Array.from({ length: MAX_RESULT_REVISIONS }, (_, index) => revision(String(index))) };
    expect(() => appendRevision(full, revision("overflow"))).toThrow("最多保存 12 个派生修订");
  });
});
