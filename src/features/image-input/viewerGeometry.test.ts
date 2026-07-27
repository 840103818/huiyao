import { describe, expect, it } from "vitest";
import {
  clampPan,
  fitModePan,
  fitScale,
  navigatorGeometry,
  panBounds,
  panFromNavigatorPoint,
  stepScale,
  zoomAtPoint,
} from "./viewerGeometry";

const viewport = { width: 1000, height: 600 };

describe("viewerGeometry", () => {
  it("calculates fit-window, fit-width, and real 1:1 scales", () => {
    const image = { width: 2000, height: 1000 };
    expect(fitScale("fit-window", image, viewport)).toBeCloseTo(0.468);
    expect(fitScale("fit-width", image, viewport)).toBeCloseTo(0.468);
    expect(fitScale("actual", image, viewport)).toBe(1);
  });

  it("starts a tall fit-width image at the top and clamps every edge", () => {
    const image = { width: 800, height: 2400 };
    const scale = fitScale("fit-width", image, viewport);
    const bounds = panBounds(image, viewport, scale);
    expect(bounds.maxX).toBe(0);
    expect(bounds.maxY).toBeGreaterThan(1_000);
    expect(fitModePan("fit-width", image, viewport, scale)).toEqual({ x: 0, y: bounds.maxY });
    expect(clampPan({ x: 500, y: -9_999 }, image, viewport, scale)).toEqual({ x: 0, y: -bounds.maxY });
  });

  it("keeps the image point under the pointer while zooming", () => {
    const image = { width: 2000, height: 1200 };
    const pan = zoomAtPoint({ x: 0, y: 0 }, 0.5, 1, { x: 180, y: -90 }, image, viewport);
    expect(pan).toEqual({ x: -180, y: 90 });
  });

  it("maps a long-image viewport into the navigator and back to pan", () => {
    const image = { width: 800, height: 3200 };
    const geometry = navigatorGeometry(image, viewport, 1, { x: 0, y: 0 });
    expect(geometry.height).toBe(108);
    expect(geometry.viewport.height).toBeCloseTo(20.25);

    const pan = panFromNavigatorPoint(
      { x: geometry.width / 2, y: geometry.height },
      geometry,
      image,
      viewport,
      1,
    );
    expect(pan.y).toBe(-1_300);
  });

  it("uses stable zoom steps within dynamic bounds", () => {
    const bounds = { min: 0.02, max: 8 };
    expect(stepScale(0.48, 1, bounds)).toBe(0.5);
    expect(stepScale(1, 1, bounds)).toBe(1.25);
    expect(stepScale(1, -1, bounds)).toBe(0.667);
  });
});
