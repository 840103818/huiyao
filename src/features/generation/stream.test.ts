import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamUpdateScheduler, parseStreamingOptimization, parseStreamingResult } from "./stream";

afterEach(() => vi.useRealTimers());

describe("createStreamUpdateScheduler", () => {
  it("coalesces updates and enforces the minimum parse interval", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn();
    const scheduler = createStreamUpdateScheduler(update, 80, () => Date.now());

    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(0);
    expect(update).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    scheduler.schedule();
    vi.advanceTimersByTime(79);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("flushes the pending partial update when a stream is stopped", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn();
    const scheduler = createStreamUpdateScheduler(update, 80, () => Date.now());
    scheduler.schedule();
    vi.advanceTimersByTime(0);
    scheduler.schedule();

    scheduler.flush();
    expect(update).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    expect(update).toHaveBeenCalledTimes(2);
  });
});

describe("parseStreamingResult", () => {
  it("extracts analysis and an unfinished prompt from partial JSON", () => {
    const result = parseStreamingResult(
      '```json\n{"analysis":{"subject":"机械腕表","scene":"暗色影棚","tonality":"低调","postProcessing":"冷色调色","palette":["#101214"]},"prompts":{"zh":"精密机械',
    );

    expect(result?.analysis.subject).toBe("机械腕表");
    expect(result?.analysis.scene).toBe("暗色影棚");
    expect(result?.analysis.tonality).toBe("低调");
    expect(result?.analysis.postProcessing).toBe("冷色调色");
    expect(result?.analysis.palette).toEqual(["#101214"]);
    expect(result?.prompts.zh).toBe("精密机械");
  });

  it("returns null until a JSON object starts", () => {
    expect(parseStreamingResult("正在分析")).toBeNull();
  });
});

describe("parseStreamingOptimization", () => {
  it("progressively parses bilingual positive and negative prompts", () => {
    const result = parseStreamingOptimization(
      '{"prompts":{"zh":"商业摄影","en":"commercial photography"},"negativePrompts":{"zh":"模糊","en":"blur',
    );
    expect(result?.prompts.zh).toBe("商业摄影");
    expect(result?.prompts.en).toBe("commercial photography");
    expect(result?.negativePrompts.zh).toBe("模糊");
    expect(result?.negativePrompts.en).toBe("blur");
  });
});
