import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";
import type { ImageInfo } from "../../shared/contracts";

const bridgeMocks = vi.hoisted(() => ({ setViewerChromeHidden: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../infrastructure/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/tauri")>()),
  setViewerChromeHidden: bridgeMocks.setViewerChromeHidden,
}));

const landscape: ImageInfo = {
  name: "landscape.jpg",
  width: 1200,
  height: 800,
  size: 2048,
  mimeType: "image/jpeg",
};

const tall: ImageInfo = {
  name: "long-image.jpg",
  width: 900,
  height: 2400,
  size: 4096,
  mimeType: "image/jpeg",
};

function renderViewer(info: ImageInfo = landscape, onClose = vi.fn()) {
  return {
    onClose,
    ...render(<ImageViewer src="data:image/jpeg;base64,preview" alt={info.name} info={info} onClose={onClose} />),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  bridgeMocks.setViewerChromeHidden.mockClear();
});

describe("ImageViewer", () => {
  it("opens fitted, uses true 1:1, and toggles at the double-click position", () => {
    const { container } = renderViewer();
    const canvas = container.querySelector<HTMLElement>(".viewer-canvas")!;
    const frame = container.querySelector<HTMLElement>(".viewer-image-frame")!;
    expect(frame.style.transform).toContain("scale(0.8)");

    fireEvent.doubleClick(canvas, { clientX: 512, clientY: 384 });
    expect(frame.style.transform).toContain("scale(1)");
    expect(screen.getByRole("button", { name: "实际大小 100%" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.doubleClick(canvas, { clientX: 512, clientY: 384 });
    expect(frame.style.transform).toContain("scale(0.8)");
  });

  it("supports fit-width and keyboard panning for a tall image", () => {
    const { container } = renderViewer(tall);
    const frame = container.querySelector<HTMLElement>(".viewer-image-frame")!;
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("button", { name: "适应宽度" })).toHaveAttribute("aria-pressed", "true");
    expect(frame.style.transform).toContain("scale(1.0666666666666667)");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(frame.style.transform).toContain("translate3d(0px, 872px, 0)");
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(frame.style.transform).toContain("translate3d(0px, 800px, 0)");
  });

  it("shows the navigator only for overflow and lets it reposition the image", async () => {
    const { container } = renderViewer(tall);
    fireEvent.keyDown(window, { key: "1" });
    const navigator = screen.getByRole("slider", { name: "当前图片位置" });
    Object.defineProperties(navigator, {
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ x: 0, y: 0, left: 0, top: 0, right: 40.5, bottom: 108, width: 40.5, height: 108, toJSON: () => ({}) }),
      },
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });
    fireEvent.pointerDown(navigator, { button: 0, pointerId: 4, clientX: 20.25, clientY: 108 });
    await act(() => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    const frame = container.querySelector<HTMLElement>(".viewer-image-frame")!;
    expect(frame.style.transform).toContain("translate3d(0px, -816px, 0)");
  });

  it("auto-hides idle chrome, reveals it on activity, and keeps focused controls visible", () => {
    vi.useFakeTimers();
    const { container } = renderViewer();
    const viewer = screen.getByRole("dialog", { name: "图片查看器" });
    const dock = screen.getByRole("navigation", { name: "图片查看工具" });
    act(() => vi.advanceTimersByTime(1_800));
    expect(dock).toHaveClass("is-hidden");

    fireEvent.pointerMove(viewer);
    expect(dock).toHaveClass("is-visible");
    fireEvent.focus(screen.getByRole("button", { name: "放大" }));
    fireEvent.pointerEnter(dock);
    fireEvent.pointerLeave(dock);
    act(() => vi.advanceTimersByTime(2_000));
    expect(dock).toHaveClass("is-visible");
    expect(container.querySelector(".viewer-topbar")).toHaveClass("is-visible");
  });

  it("closes immediately with reduced motion and restores native chrome", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    const onClose = vi.fn();
    const { unmount } = renderViewer(landscape, onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    await Promise.resolve();
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenNthCalledWith(1, true);
    expect(bridgeMocks.setViewerChromeHidden).toHaveBeenLastCalledWith(false);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
  });

  it("keeps native chrome calls in lifecycle order during a rapid reopen", () => {
    const first = renderViewer();
    first.unmount();
    const second = renderViewer();
    expect(bridgeMocks.setViewerChromeHidden.mock.calls.slice(0, 3)).toEqual([[true], [false], [true]]);
    second.unmount();
  });
});
