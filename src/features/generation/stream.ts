import { parse } from "partial-json";
import type { PromptOptimizationOutput, ReverseResult } from "../../shared/contracts";

export const STREAM_PRINTER_INTERVAL_MS = 40;
export const STREAM_PRINTER_FINISH_MS = 240;

export interface StreamPrinterController {
  append: (content: string) => void;
  finish: () => Promise<void>;
  flush: () => void;
  cancel: () => void;
  reset: () => void;
  displayedContent: () => string;
  pendingCharacters: () => number;
}

interface StreamPrinterOptions {
  intervalMs?: number;
  finishMs?: number;
  now?: () => number;
  reducedMotion?: () => boolean;
}

export function createStreamPrinterController(
  update: (content: string) => void,
  options: StreamPrinterOptions = {},
): StreamPrinterController {
  const intervalMs = options.intervalMs ?? STREAM_PRINTER_INTERVAL_MS;
  const finishMs = options.finishMs ?? STREAM_PRINTER_FINISH_MS;
  const now = options.now ?? (() => performance.now());
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion;
  let pending: string[] = [];
  let pendingIndex = 0;
  let displayed = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finishDeadline: number | undefined;
  let finishResolvers: Array<() => void> = [];

  const backlog = () => pending.length - pendingIndex;
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const resolveFinish = () => {
    finishDeadline = undefined;
    const resolvers = finishResolvers;
    finishResolvers = [];
    resolvers.forEach((resolve) => resolve());
  };
  const compactPending = () => {
    if (pendingIndex < 4_096 || pendingIndex * 2 < pending.length) return;
    pending = pending.slice(pendingIndex);
    pendingIndex = 0;
  };
  const emit = (count: number) => {
    const end = Math.min(pending.length, pendingIndex + count);
    if (end <= pendingIndex) return;
    displayed += pending.slice(pendingIndex, end).join("");
    pendingIndex = end;
    compactPending();
    update(displayed);
  };
  const flushPending = () => {
    emit(backlog());
    resolveFinish();
  };
  const schedule = (delay = intervalMs) => {
    if (timer !== undefined || backlog() === 0) return;
    timer = setTimeout(tick, delay);
  };
  const tick = () => {
    timer = undefined;
    const remaining = backlog();
    if (!remaining) {
      resolveFinish();
      return;
    }
    if (reducedMotion() || (finishDeadline !== undefined && now() >= finishDeadline)) {
      flushPending();
      return;
    }

    let count = printerBatchSize(remaining);
    if (finishDeadline !== undefined) {
      const frames = Math.max(1, Math.ceil((finishDeadline - now()) / intervalMs));
      count = Math.max(count, Math.min(48, Math.ceil(remaining / frames)));
    }
    emit(count);
    if (backlog() > 0) schedule();
    else resolveFinish();
  };

  return {
    append(content) {
      if (!content) return;
      for (const character of content) pending.push(character);
      schedule(displayed ? intervalMs : 0);
    },
    finish() {
      if (!backlog()) return Promise.resolve();
      finishDeadline = now() + finishMs;
      schedule(0);
      return new Promise<void>((resolve) => finishResolvers.push(resolve));
    },
    flush() {
      clearTimer();
      flushPending();
    },
    cancel() {
      clearTimer();
      pending = [];
      pendingIndex = 0;
      resolveFinish();
    },
    reset() {
      clearTimer();
      pending = [];
      pendingIndex = 0;
      displayed = "";
      resolveFinish();
    },
    displayedContent: () => displayed,
    pendingCharacters: backlog,
  };
}

export function printerBatchSize(backlog: number): number {
  if (backlog <= 24) return 1;
  if (backlog <= 120) return Math.min(5, Math.ceil(backlog / 24));
  return Math.min(48, Math.max(6, Math.ceil(backlog / 12)));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
