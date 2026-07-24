import { describe, expect, it } from "vitest";
import { parseStreamingResult } from "./stream";

describe("parseStreamingResult", () => {
  it("extracts analysis and an unfinished prompt from partial JSON", () => {
    const result = parseStreamingResult(
      '```json\n{"analysis":{"subject":"机械腕表","palette":["#101214"]},"prompts":{"zh":"精密机械',
    );

    expect(result?.analysis.subject).toBe("机械腕表");
    expect(result?.analysis.palette).toEqual(["#101214"]);
    expect(result?.prompts.zh).toBe("精密机械");
  });

  it("returns null until a JSON object starts", () => {
    expect(parseStreamingResult("正在分析")).toBeNull();
  });
});
