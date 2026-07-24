import { parse } from "partial-json";
import type { ReverseResult } from "../types";

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
        composition: asString(analysis.composition),
        lighting: asString(analysis.lighting),
        colors: asString(analysis.colors),
        palette: asStringArray(analysis.palette),
        materials: asString(analysis.materials),
        style: asString(analysis.style),
        camera: asString(analysis.camera),
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
