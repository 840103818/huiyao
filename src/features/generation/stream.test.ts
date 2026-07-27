import { afterEach, describe, expect, it, vi } from "vitest";
import { createStreamPrinterController, parseStreamingOptimization, parseStreamingResult, printerBatchSize } from "./stream";

afterEach(() => vi.useRealTimers());

describe("createStreamPrinterController", () => {
  it("prints Unicode content progressively at the base pace", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { now: () => Date.now(), reducedMotion: () => false });

    printer.append("你🙂好");
    vi.advanceTimersByTime(0);
    expect(update).toHaveBeenLastCalledWith("你");
    vi.advanceTimersByTime(40);
    expect(update).toHaveBeenLastCalledWith("你🙂");
    vi.advanceTimersByTime(40);
    expect(update).toHaveBeenLastCalledWith("你🙂好");
    expect(printer.pendingCharacters()).toBe(0);
  });

  it("adapts the batch size to the pending backlog", () => {
    expect(printerBatchSize(24)).toBe(1);
    expect(printerBatchSize(25)).toBe(2);
    expect(printerBatchSize(120)).toBe(5);
    expect(printerBatchSize(121)).toBe(11);
    expect(printerBatchSize(10_000)).toBe(48);
  });

  it("limits visual updates to roughly 25 frames per second", () => {
    vi.useFakeTimers();
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { reducedMotion: () => false });
    printer.append("流".repeat(10_000));

    vi.advanceTimersByTime(1_000);

    expect(update.mock.calls.length).toBeLessThanOrEqual(26);
    printer.cancel();
  });

  it("finishes any remaining backlog within 240 milliseconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { now: () => Date.now(), reducedMotion: () => false });
    const content = "流".repeat(2_000);
    printer.append(content);
    vi.advanceTimersByTime(0);

    const finished = printer.finish();
    await vi.advanceTimersByTimeAsync(239);
    expect(printer.pendingCharacters()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    await finished;
    expect(update).toHaveBeenLastCalledWith(content);
  });

  it("flushes arrived content on stop and discards stale content on reset", () => {
    vi.useFakeTimers();
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { reducedMotion: () => false });
    printer.append("已经收到的内容");
    printer.flush();
    expect(update).toHaveBeenLastCalledWith("已经收到的内容");

    printer.append("旧请求");
    printer.reset();
    vi.runAllTimers();
    expect(update).not.toHaveBeenCalledWith("已经收到的内容旧请求");
  });

  it("cancels pending animation without emitting undisplayed content", async () => {
    vi.useFakeTimers();
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { reducedMotion: () => false });
    printer.append("不会继续显示的旧请求内容");
    vi.advanceTimersByTime(0);
    const displayedBeforeCancel = printer.displayedContent();
    const finishing = printer.finish();

    printer.cancel();
    await finishing;
    vi.runAllTimers();

    expect(printer.displayedContent()).toBe(displayedBeforeCancel);
    expect(update).toHaveBeenLastCalledWith(displayedBeforeCancel);
    expect(printer.pendingCharacters()).toBe(0);
  });

  it("shows the complete received chunk without per-character delay for reduced motion", () => {
    vi.useFakeTimers();
    const update = vi.fn<(content: string) => void>();
    const printer = createStreamPrinterController(update, { reducedMotion: () => true });
    printer.append("减少动态效果");
    vi.runAllTimers();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith("减少动态效果");
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
