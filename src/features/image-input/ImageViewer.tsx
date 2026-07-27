import { Button, Dropdown, Menu, Tooltip } from "@arco-design/web-react";
import {
  IconClose,
  IconExpand,
  IconFullscreen,
  IconOriginalSize,
  IconZoomIn,
  IconZoomOut,
} from "@arco-design/web-react/icon";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { setViewerChromeHidden } from "../../infrastructure/tauri";
import type { ImageInfo } from "../../shared/contracts";
import { formatBytes } from "./image";
import {
  clampPan,
  fitModePan,
  fitScale,
  isOverflowing,
  navigatorGeometry,
  panFromNavigatorPoint,
  scaleBounds,
  stepScale,
  zoomAtPoint,
} from "./viewerGeometry";
import type { ViewerFitMode, ViewerPoint, ViewerSize } from "./viewerGeometry";

interface ImageViewerProps {
  src: string;
  alt: string;
  info: ImageInfo | null;
  onClose: () => void;
}

interface ViewerState {
  scale: number;
  pan: ViewerPoint;
  mode: ViewerFitMode;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  origin: ViewerPoint;
}

const INITIAL_VIEW: ViewerState = { scale: 1, pan: { x: 0, y: 0 }, mode: "fit-window" };
const IDLE_DELAY_MS = 1_800;
const CLOSE_DURATION_MS = 150;

export function ImageViewer({ src, alt, info, onClose }: ImageViewerProps) {
  const [intrinsicSize, setIntrinsicSize] = useState<ViewerSize | null>(() => info ? { width: info.width, height: info.height } : null);
  const [viewport, setViewport] = useState<ViewerSize>({ width: 0, height: 0 });
  const [view, setView] = useState<ViewerState>(INITIAL_VIEW);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [phase, setPhase] = useState<"opening" | "open" | "closing">("opening");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const navigatorDragRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const controlsHoveredRef = useRef(false);
  const controlsFocusedRef = useRef(false);
  const idleTimerRef = useRef(0);
  const closeTimerRef = useRef(0);
  const frameRef = useRef(0);
  const pendingViewRef = useRef<ViewerState | null>(null);
  const viewRef = useRef(view);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ready = Boolean(intrinsicSize && viewport.width > 0 && viewport.height > 0 && initializedRef.current);

  const commitView = useCallback((next: ViewerState) => {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    pendingViewRef.current = null;
    viewRef.current = next;
    setView(next);
  }, []);

  const scheduleView = useCallback((next: ViewerState) => {
    viewRef.current = next;
    pendingViewRef.current = next;
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pending) setView(pending);
    });
  }, []);

  const scheduleControlsHide = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      if (!controlsHoveredRef.current && !controlsFocusedRef.current && !dragRef.current && navigatorDragRef.current === null) setControlsVisible(false);
    }, IDLE_DELAY_MS);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);

  const updateControlsLock = useCallback((kind: "hover" | "focus", locked: boolean) => {
    if (kind === "hover") controlsHoveredRef.current = locked;
    else controlsFocusedRef.current = locked;
    if (controlsHoveredRef.current || controlsFocusedRef.current) {
      window.clearTimeout(idleTimerRef.current);
      setControlsVisible(true);
    } else scheduleControlsHide();
  }, [scheduleControlsHide]);

  const holdControls = useCallback(() => {
    window.clearTimeout(idleTimerRef.current);
    setControlsVisible(true);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const next = {
        width: canvas.clientWidth || window.innerWidth,
        height: canvas.clientHeight || window.innerHeight,
      };
      setViewport((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!intrinsicSize || viewport.width <= 0 || viewport.height <= 0) return;
    const current = viewRef.current;
    if (!initializedRef.current) {
      initializedRef.current = true;
      const scale = fitScale("fit-window", intrinsicSize, viewport);
      commitView({ scale, pan: { x: 0, y: 0 }, mode: "fit-window" });
      return;
    }
    if (current.mode === "manual") {
      commitView({ ...current, pan: clampPan(current.pan, intrinsicSize, viewport, current.scale) });
      return;
    }
    const scale = fitScale(current.mode, intrinsicSize, viewport);
    const ratio = scale / Math.max(0.0001, current.scale);
    const nextPan = current.mode === "fit-window"
      ? { x: 0, y: 0 }
      : clampPan({ x: current.pan.x * ratio, y: current.pan.y * ratio }, intrinsicSize, viewport, scale);
    commitView({ ...current, scale, pan: nextPan });
  }, [commitView, intrinsicSize, viewport]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    void setViewerChromeHidden(true).catch(() => undefined);
    const openFrame = window.requestAnimationFrame(() => setPhase("open"));
    scheduleControlsHide();
    return () => {
      window.cancelAnimationFrame(openFrame);
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(idleTimerRef.current);
      window.clearTimeout(closeTimerRef.current);
      void setViewerChromeHidden(false).catch(() => undefined);
      restoreFocusRef.current?.focus();
    };
  }, [scheduleControlsHide]);

  const requestClose = useCallback(() => {
    if (phase === "closing") return;
    if (reducedMotion) {
      onClose();
      return;
    }
    setPhase("closing");
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(onClose, CLOSE_DURATION_MS);
  }, [onClose, phase, reducedMotion]);

  const setMode = useCallback((mode: Exclude<ViewerFitMode, "manual">, point?: ViewerPoint) => {
    if (!intrinsicSize || viewport.width <= 0) return;
    const current = viewRef.current;
    const scale = fitScale(mode, intrinsicSize, viewport);
    const pan = point
      ? zoomAtPoint(current.pan, current.scale, scale, point, intrinsicSize, viewport)
      : mode === "actual"
        ? clampPan(current.pan, intrinsicSize, viewport, scale)
        : fitModePan(mode, intrinsicSize, viewport, scale);
    commitView({ scale, pan, mode });
    revealControls();
  }, [commitView, intrinsicSize, revealControls, viewport]);

  const setManualScale = useCallback((nextScale: number, point: ViewerPoint = { x: 0, y: 0 }) => {
    if (!intrinsicSize || viewport.width <= 0) return;
    const current = viewRef.current;
    const bounds = scaleBounds(intrinsicSize, viewport);
    const scale = Math.min(bounds.max, Math.max(bounds.min, nextScale));
    commitView({
      scale,
      pan: zoomAtPoint(current.pan, current.scale, scale, point, intrinsicSize, viewport),
      mode: Math.abs(scale - 1) < 0.0001 ? "actual" : "manual",
    });
    revealControls();
  }, [commitView, intrinsicSize, revealControls, viewport]);

  const stepZoom = useCallback((direction: -1 | 1) => {
    if (!intrinsicSize) return;
    const current = viewRef.current;
    setManualScale(stepScale(current.scale, direction, scaleBounds(intrinsicSize, viewport)));
  }, [intrinsicSize, setManualScale, viewport]);

  const panBy = useCallback((delta: ViewerPoint, scheduled = false) => {
    if (!intrinsicSize) return;
    const current = viewRef.current;
    const next = { ...current, pan: clampPan({ x: current.pan.x + delta.x, y: current.pan.y + delta.y }, intrinsicSize, viewport, current.scale) };
    if (scheduled) scheduleView(next);
    else commitView(next);
  }, [commitView, intrinsicSize, scheduleView, viewport]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      revealControls();
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
      } else if (event.key === "0") {
        event.preventDefault();
        setMode("fit-window");
      } else if (event.key === "1") {
        event.preventDefault();
        setMode("actual");
      } else if (event.key === "2") {
        event.preventDefault();
        setMode("fit-width");
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        stepZoom(1);
      } else if (event.key === "-") {
        event.preventDefault();
        stepZoom(-1);
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const distance = event.shiftKey ? 72 : 24;
        panBy({
          x: event.key === "ArrowLeft" ? distance : event.key === "ArrowRight" ? -distance : 0,
          y: event.key === "ArrowUp" ? distance : event.key === "ArrowDown" ? -distance : 0,
        });
      } else if (event.key === "Tab" && dialogRef.current) {
        const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex='0']"));
        if (!controls.length) return;
        const index = controls.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? (index <= 0 ? controls.length - 1 : index - 1)
          : (index < 0 || index === controls.length - 1 ? 0 : index + 1);
        event.preventDefault();
        controls[next]?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panBy, requestClose, revealControls, setMode, stepZoom]);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!intrinsicSize || event.button !== 0 || !isOverflowing(intrinsicSize, viewport, viewRef.current.scale)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: viewRef.current.pan };
    holdControls();
  };

  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !intrinsicSize) return;
    const current = viewRef.current;
    scheduleView({
      ...current,
      pan: clampPan({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY }, intrinsicSize, viewport, current.scale),
    });
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scheduleControlsHide();
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!intrinsicSize) return;
    event.preventDefault();
    revealControls();
    const current = viewRef.current;
    if (event.ctrlKey) {
      const rect = event.currentTarget.getBoundingClientRect();
      const bounds = scaleBounds(intrinsicSize, viewport);
      const scale = Math.min(bounds.max, Math.max(bounds.min, current.scale * Math.exp(-event.deltaY * 0.0025)));
      const point = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      scheduleView({ scale, pan: zoomAtPoint(current.pan, current.scale, scale, point, intrinsicSize, viewport), mode: "manual" });
    } else if (isOverflowing(intrinsicSize, viewport, current.scale)) {
      panBy({ x: -event.deltaX, y: -event.deltaY }, true);
    }
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewRef.current.mode === "fit-window") {
      const rect = event.currentTarget.getBoundingClientRect();
      setMode("actual", { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
    } else setMode("fit-window");
  };

  const updateFromNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!intrinsicSize) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const current = viewRef.current;
    scheduleView({
      ...current,
      pan: panFromNavigatorPoint(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        { width: rect.width, height: rect.height },
        intrinsicSize,
        viewport,
        current.scale,
      ),
    });
  };

  const beginNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    navigatorDragRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    holdControls();
    updateFromNavigator(event);
  };

  const moveNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navigatorDragRef.current === event.pointerId) updateFromNavigator(event);
  };

  const endNavigator = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (navigatorDragRef.current !== event.pointerId) return;
    navigatorDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scheduleControlsHide();
  };

  const imageSize = intrinsicSize ?? { width: 1, height: 1 };
  const overflowing = ready && isOverflowing(imageSize, viewport, view.scale);
  const navigator = overflowing ? navigatorGeometry(imageSize, viewport, view.scale, view.pan) : null;
  const percent = formatPercent(view.scale);
  const chromeClass = controlsVisible ? "is-visible" : "is-hidden";
  const zoomMenu = (
    <Menu className="viewer-zoom-menu" onClickMenuItem={(key) => {
      if (key === "fit-window" || key === "fit-width" || key === "actual") setMode(key);
      else setManualScale(Number(key));
    }}>
      <Menu.Item key="fit-window">适应窗口</Menu.Item>
      <Menu.Item key="fit-width">适应宽度</Menu.Item>
      <Menu.Item key="actual">实际大小 100%</Menu.Item>
      <Menu.Item key="0.25">25%</Menu.Item>
      <Menu.Item key="0.5">50%</Menu.Item>
      <Menu.Item key="2">200%</Menu.Item>
      <Menu.Item key="4">400%</Menu.Item>
    </Menu>
  );

  return (
    <div
      ref={dialogRef}
      className={`image-viewer is-${phase} ${dragRef.current ? "is-dragging" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="图片查看器"
      data-image-viewer="open"
      tabIndex={-1}
      onPointerMove={revealControls}
    >
      <div
        ref={canvasRef}
        className={`viewer-canvas ${overflowing ? "can-pan" : ""}`}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div
          className="viewer-image-frame"
          style={{
            width: imageSize.width,
            height: imageSize.height,
            marginLeft: -imageSize.width / 2,
            marginTop: -imageSize.height / 2,
            opacity: ready ? 1 : 0,
            transform: `translate3d(${view.pan.x}px, ${view.pan.y}px, 0) scale(${view.scale})`,
          }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={(event) => {
              if (!intrinsicSize) setIntrinsicSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
            }}
          />
        </div>
      </div>

      <header
        className={`viewer-topbar viewer-chrome ${chromeClass}`}
        onPointerEnter={() => updateControlsLock("hover", true)}
        onPointerLeave={() => updateControlsLock("hover", false)}
        onFocusCapture={() => updateControlsLock("focus", true)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateControlsLock("focus", false); }}
      >
        <div><strong>{alt}</strong><span>{info ? `${info.width} × ${info.height} · ${formatBytes(info.size)}` : "历史缩略图"}</span></div>
        <ViewerToolButton label="关闭图片查看器" onClick={requestClose}><IconClose /></ViewerToolButton>
      </header>

      <nav
        className={`viewer-dock viewer-chrome ${chromeClass}`}
        aria-label="图片查看工具"
        onPointerEnter={() => updateControlsLock("hover", true)}
        onPointerLeave={() => updateControlsLock("hover", false)}
        onFocusCapture={() => updateControlsLock("focus", true)}
        onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateControlsLock("focus", false); }}
      >
        <ViewerToolButton label="缩小" onClick={() => stepZoom(-1)}><IconZoomOut /></ViewerToolButton>
        <Dropdown droplist={zoomMenu} trigger="click" position="top" getPopupContainer={() => dialogRef.current ?? document.body}>
          <Button className="viewer-scale-button" type="text" aria-label={`当前缩放比例 ${percent}`}>{percent}</Button>
        </Dropdown>
        <ViewerToolButton label="放大" onClick={() => stepZoom(1)}><IconZoomIn /></ViewerToolButton>
        <span className="viewer-tool-divider" aria-hidden="true" />
        <ViewerToolButton label="适应窗口" pressed={view.mode === "fit-window"} onClick={() => setMode("fit-window")}><IconFullscreen /></ViewerToolButton>
        <ViewerToolButton label="适应宽度" pressed={view.mode === "fit-width"} onClick={() => setMode("fit-width")}><IconExpand /></ViewerToolButton>
        <ViewerToolButton label="实际大小 100%" pressed={view.mode === "actual"} onClick={() => setMode("actual")}><IconOriginalSize /></ViewerToolButton>
      </nav>

      {navigator ? (
        <aside
          className={`viewer-navigator viewer-chrome ${chromeClass}`}
          aria-label="图片位置导航"
          onPointerEnter={() => updateControlsLock("hover", true)}
          onPointerLeave={() => updateControlsLock("hover", false)}
          onFocusCapture={() => updateControlsLock("focus", true)}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) updateControlsLock("focus", false); }}
        >
          <div
            className="viewer-navigator-map"
            role="slider"
            aria-label="当前图片位置"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((0.5 - view.pan.y / Math.max(1, imageSize.height * view.scale)) * 100)}
            tabIndex={0}
            style={{ width: navigator.width, height: navigator.height }}
            onPointerDown={beginNavigator}
            onPointerMove={moveNavigator}
            onPointerUp={endNavigator}
            onPointerCancel={endNavigator}
          >
            <img src={src} alt="" draggable={false} />
            <span className="viewer-navigator-viewport" style={navigator.viewport} />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function ViewerToolButton({ label, pressed, onClick, children }: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip content={label}>
      <Button
        className={pressed ? "is-active" : undefined}
        shape="circle"
        type="text"
        icon={children}
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
      />
    </Tooltip>
  );
}

function formatPercent(scale: number): string {
  const percent = scale * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}
