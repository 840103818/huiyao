import { parse } from "partial-json";
import type { PromptOptimizationOutput, ReverseResult } from "../../shared/contracts";

export const STREAM_PARTIAL_UPDATE_INTERVAL_MS = 80;

export interface StreamUpdateScheduler {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
  reset: () => void;
}

export function createStreamUpdateScheduler(
  update: () => void,
  intervalMs = STREAM_PARTIAL_UPDATE_INTERVAL_MS,
  now: () => number = () => performance.now(),
): StreamUpdateScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let lastUpdateAt = Number.NEGATIVE_INFINITY;

  const run = () => {
    timer = undefined;
    if (!pending) return;
    pending = false;
    lastUpdateAt = now();
    update();
  };
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = false;
  };

  return {
    schedule() {
      pending = true;
      if (timer !== undefined) return;
      const delay = Math.max(0, intervalMs - (now() - lastUpdateAt));
      timer = setTimeout(run, delay);
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      run();
    },
    cancel,
    reset() {
      cancel();
      lastUpdateAt = Number.NEGATIVE_INFINITY;
    },
  };
}

export function parseStreamingResult(content: string): ReverseResult | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  const fence = content.indexOf("```", start);
  const candidate = content.slice(start, fence >= 0 ? fence : undefined);
  try {
    const value = parse(candidate) as Record<string, unknown>;
    const analysis = asRecord(value.analysis);
    const prompts = asRecord(value.prompts);
    return {
      analysis: {
        subject: asString(analysis.subject),
        scene: asString(analysis.scene),
        composition: asString(analysis.composition),
        lighting: asString(analysis.lighting),
        tonality: asString(analysis.tonality),
        colors: asString(analysis.colors),
        palette: asStringArray(analysis.palette),
        materials: asString(analysis.materials),
        style: asString(analysis.style),
        camera: asString(analysis.camera),
        postProcessing: asString(analysis.postProcessing),
      },
      prompts: {
        zh: asString(prompts.zh),
        en: asString(prompts.en),
      },
      metadata: {
        model: "",
        elapsedMs: 0,
        createdAt: "",
      },
    };
  } catch {
    return null;
  }
}

export function parseStreamingOptimization(content: string): PromptOptimizationOutput | null {
  const value = parsePartialObject(content);
  if (!value) return null;
  const prompts = asRecord(value.prompts);
  const negativePrompts = asRecord(value.negativePrompts);
  return {
    prompts: { zh: asString(prompts.zh), en: asString(prompts.en) },
    negativePrompts: {
      zh: asString(negativePrompts.zh),
      en: asString(negativePrompts.en),
    },
    metadata: { model: "", elapsedMs: 0, createdAt: "" },
  };
}

function parsePartialObject(content: string): Record<string, unknown> | null {
  const start = content.indexOf("{");
  if (start < 0) return null;
  const fence = content.indexOf("```", start);
  try {
    return parse(content.slice(start, fence >= 0 ? fence : undefined)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
