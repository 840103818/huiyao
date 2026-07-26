import { afterEach, describe, expect, it, vi } from "vitest";
import { stageOriginalImage } from "./originals";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe("stageOriginalImage", () => {
  it("rejects an unsupported MIME type before reading file bytes", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const file = new File(["text"], "payload.txt", { type: "text/plain" });
    const arrayBuffer = vi.fn();
    Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });

    await expect(stageOriginalImage(file)).rejects.toThrow("仅支持 PNG、JPEG 和 WebP 图片");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects a file over 20 MB before allocating its upload body", async () => {
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const file = new File(["image"], "oversized.png", { type: "image/png" });
    const arrayBuffer = vi.fn();
    Object.defineProperties(file, {
      size: { value: 20 * 1024 * 1024 + 1 },
      arrayBuffer: { value: arrayBuffer },
    });

    await expect(stageOriginalImage(file)).rejects.toThrow("图片不能为空且不能超过 20 MB");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
