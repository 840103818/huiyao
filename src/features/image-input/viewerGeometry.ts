export interface ViewerSize {
  width: number;
  height: number;
}

export interface ViewerPoint {
  x: number;
  y: number;
}

export interface ViewerBounds {
  maxX: number;
  maxY: number;
}

export interface NavigatorGeometry {
  width: number;
  height: number;
  viewport: { x: number; y: number; width: number; height: number };
}

export type ViewerFitMode = "fit-window" | "fit-width" | "actual" | "manual";

const VIEWER_HORIZONTAL_GUTTER = 64;
const VIEWER_VERTICAL_GUTTER = 128;
const NAVIGATOR_MAX_WIDTH = 148;
const NAVIGATOR_MAX_HEIGHT = 108;

export function fitScale(mode: Exclude<ViewerFitMode, "manual">, image: ViewerSize, viewport: ViewerSize): number {
  if (mode === "actual") return 1;
  const availableWidth = Math.max(1, viewport.width - VIEWER_HORIZONTAL_GUTTER);
  const availableHeight = Math.max(1, viewport.height - VIEWER_VERTICAL_GUTTER);
  const widthScale = availableWidth / Math.max(1, image.width);
  if (mode === "fit-width") return widthScale;
  return Math.min(widthScale, availableHeight / Math.max(1, image.height));
}

export function scaleBounds(image: ViewerSize, viewport: ViewerSize): { min: number; max: number } {
  const fitted = fitScale("fit-window", image, viewport);
  return { min: Math.min(0.05, fitted), max: Math.max(8, fitted) };
}

export function panBounds(image: ViewerSize, viewport: ViewerSize, scale: number): ViewerBounds {
  return {
    maxX: Math.max(0, (image.width * scale - viewport.width) / 2),
    maxY: Math.max(0, (image.height * scale - viewport.height) / 2),
  };
}

export function clampPan(pan: ViewerPoint, image: ViewerSize, viewport: ViewerSize, scale: number): ViewerPoint {
  const bounds = panBounds(image, viewport, scale);
  return {
    x: Math.min(bounds.maxX, Math.max(-bounds.maxX, pan.x)),
    y: Math.min(bounds.maxY, Math.max(-bounds.maxY, pan.y)),
  };
}

export function zoomAtPoint(
  pan: ViewerPoint,
  previousScale: number,
  nextScale: number,
  point: ViewerPoint,
  image: ViewerSize,
  viewport: ViewerSize,
): ViewerPoint {
  if (previousScale <= 0) return clampPan(pan, image, viewport, nextScale);
  const ratio = nextScale / previousScale;
  return clampPan({
    x: point.x - (point.x - pan.x) * ratio,
    y: point.y - (point.y - pan.y) * ratio,
  }, image, viewport, nextScale);
}

export function fitModePan(mode: Exclude<ViewerFitMode, "manual">, image: ViewerSize, viewport: ViewerSize, scale: number): ViewerPoint {
  if (mode !== "fit-width") return { x: 0, y: 0 };
  const bounds = panBounds(image, viewport, scale);
  return { x: 0, y: bounds.maxY };
}

export function isOverflowing(image: ViewerSize, viewport: ViewerSize, scale: number): boolean {
  const bounds = panBounds(image, viewport, scale);
  return bounds.maxX > 0.5 || bounds.maxY > 0.5;
}

export function navigatorGeometry(image: ViewerSize, viewport: ViewerSize, scale: number, pan: ViewerPoint): NavigatorGeometry {
  const thumbnailScale = Math.min(NAVIGATOR_MAX_WIDTH / image.width, NAVIGATOR_MAX_HEIGHT / image.height);
  const width = image.width * thumbnailScale;
  const height = image.height * thumbnailScale;
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const visibleWidth = Math.min(image.width, viewport.width / scale);
  const visibleHeight = Math.min(image.height, viewport.height / scale);
  const centerX = image.width / 2 - pan.x / scale;
  const centerY = image.height / 2 - pan.y / scale;
  const left = Math.min(image.width - visibleWidth, Math.max(0, centerX - visibleWidth / 2));
  const top = Math.min(image.height - visibleHeight, Math.max(0, centerY - visibleHeight / 2));

  return {
    width,
    height,
    viewport: {
      x: renderedWidth <= viewport.width ? 0 : left * thumbnailScale,
      y: renderedHeight <= viewport.height ? 0 : top * thumbnailScale,
      width: renderedWidth <= viewport.width ? width : visibleWidth * thumbnailScale,
      height: renderedHeight <= viewport.height ? height : visibleHeight * thumbnailScale,
    },
  };
}

export function panFromNavigatorPoint(
  point: ViewerPoint,
  navigator: ViewerSize,
  image: ViewerSize,
  viewport: ViewerSize,
  scale: number,
): ViewerPoint {
  const normalizedX = Math.min(1, Math.max(0, point.x / Math.max(1, navigator.width)));
  const normalizedY = Math.min(1, Math.max(0, point.y / Math.max(1, navigator.height)));
  return clampPan({
    x: (0.5 - normalizedX) * image.width * scale,
    y: (0.5 - normalizedY) * image.height * scale,
  }, image, viewport, scale);
}

export function stepScale(current: number, direction: -1 | 1, bounds: { min: number; max: number }): number {
  const steps = [bounds.min, 0.05, 0.1, 0.125, 0.25, 0.333, 0.5, 0.667, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, bounds.max]
    .filter((value) => value >= bounds.min && value <= bounds.max)
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > 0.001);
  if (direction > 0) return steps.find((value) => value > current + 0.005) ?? bounds.max;
  return [...steps].reverse().find((value) => value < current - 0.005) ?? bounds.min;
}
