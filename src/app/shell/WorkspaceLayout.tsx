import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";

const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 336;
const DEFAULT_INPUT_SPLIT = 52;
const MIN_INPUT_SPLIT = 42;
const MAX_INPUT_SPLIT = 64;

interface WorkspaceLayoutProps {
  sidebar?: ReactNode;
  sidebarVisible: boolean;
  overview?: ReactNode;
  input?: ReactNode;
  result?: ReactNode;
  sidebarWidth?: number;
  inputSplitPercent?: number;
  onSidebarWidthChange: (value?: number) => void;
  onInputSplitChange: (value?: number) => void;
  locked?: boolean;
}

type DragState = {
  kind: "sidebar" | "input";
  pointerId: number;
  startX: number;
  startValue: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function WorkspaceLayout({
  sidebar,
  sidebarVisible,
  overview,
  input,
  result,
  sidebarWidth,
  inputSplitPercent,
  onSidebarWidthChange,
  onInputSplitChange,
  locked,
}: WorkspaceLayoutProps) {
  const contentRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [liveSidebarWidth, setLiveSidebarWidth] = useState(() => clamp(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  const [liveInputSplit, setLiveInputSplit] = useState(() => clamp(inputSplitPercent ?? DEFAULT_INPUT_SPLIT, MIN_INPUT_SPLIT, MAX_INPUT_SPLIT));
  const liveSidebarWidthRef = useRef(liveSidebarWidth);
  const liveInputSplitRef = useRef(liveInputSplit);

  const updateSidebarWidth = (value: number) => {
    liveSidebarWidthRef.current = value;
    setLiveSidebarWidth(value);
  };
  const updateInputSplit = (value: number) => {
    liveInputSplitRef.current = value;
    setLiveInputSplit(value);
  };

  useEffect(() => {
    updateSidebarWidth(clamp(sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
  }, [sidebarWidth]);
  useEffect(() => {
    updateInputSplit(clamp(inputSplitPercent ?? DEFAULT_INPUT_SPLIT, MIN_INPUT_SPLIT, MAX_INPUT_SPLIT));
  }, [inputSplitPercent]);

  const startDrag = (kind: DragState["kind"], event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked || event.button !== 0) return;
    dragRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: kind === "sidebar" ? liveSidebarWidth : liveInputSplit,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "sidebar") {
      updateSidebarWidth(clamp(drag.startValue + event.clientX - drag.startX, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH));
      return;
    }
    const available = Math.max(1, (contentRef.current?.clientWidth ?? 1) - 8);
    updateInputSplit(clamp(drag.startValue + (event.clientX - drag.startX) / available * 100, MIN_INPUT_SPLIT, MAX_INPUT_SPLIT));
  };

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.kind === "sidebar") onSidebarWidthChange(Math.round(liveSidebarWidthRef.current));
    else onInputSplitChange(Math.round(liveInputSplitRef.current * 10) / 10);
  };

  const handleKey = (kind: DragState["kind"], event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    if (event.key === "Home" || event.key === "Enter") {
      event.preventDefault();
      if (kind === "sidebar") {
        updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
        onSidebarWidthChange(undefined);
      } else {
        updateInputSplit(DEFAULT_INPUT_SPLIT);
        onInputSplitChange(undefined);
      }
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (kind === "sidebar") {
      const next = clamp(liveSidebarWidth + direction * (event.shiftKey ? 24 : 8), MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
      updateSidebarWidth(next);
      onSidebarWidthChange(next);
    } else {
      const next = clamp(liveInputSplit + direction * (event.shiftKey ? 4 : 1.5), MIN_INPUT_SPLIT, MAX_INPUT_SPLIT);
      updateInputSplit(next);
      onInputSplitChange(next);
    }
  };

  const reset = (kind: DragState["kind"]) => {
    if (locked) return;
    if (kind === "sidebar") {
      updateSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
      onSidebarWidthChange(undefined);
    } else {
      updateInputSplit(DEFAULT_INPUT_SPLIT);
      onInputSplitChange(undefined);
    }
  };

  const style = {
    "--project-sidebar-width": `${liveSidebarWidth}px`,
    "--input-pane-weight": `${liveInputSplit}fr`,
    "--result-pane-weight": `${100 - liveInputSplit}fr`,
  } as React.CSSProperties;

  return (
    <div className={`workspace ${sidebarVisible ? "" : "sidebar-collapsed"}`} style={style}>
      {sidebarVisible ? sidebar : null}
      {sidebarVisible ? (
        <div
          className="workspace-splitter workspace-splitter-sidebar"
          role="separator"
          aria-label="调整项目任务栏宽度"
          aria-orientation="vertical"
          aria-valuemin={MIN_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SIDEBAR_WIDTH}
          aria-valuenow={Math.round(liveSidebarWidth)}
          tabIndex={locked ? -1 : 0}
          aria-disabled={locked}
          onPointerDown={(event) => startDrag("sidebar", event)}
          onPointerMove={moveDrag}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
          onDoubleClick={() => reset("sidebar")}
          onKeyDown={(event) => handleKey("sidebar", event)}
        ><span /></div>
      ) : null}
      <main ref={contentRef} className={`workbench-grid ${overview ? "has-overview" : ""}`}>
        {overview ?? (
          <>
            {input}
            <div
              className="workspace-splitter workspace-splitter-content"
              role="separator"
              aria-label="调整视觉输入和结果区域宽度"
              aria-orientation="vertical"
              aria-valuemin={MIN_INPUT_SPLIT}
              aria-valuemax={MAX_INPUT_SPLIT}
              aria-valuenow={Math.round(liveInputSplit)}
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              onPointerDown={(event) => startDrag("input", event)}
              onPointerMove={moveDrag}
              onPointerUp={stopDrag}
              onPointerCancel={stopDrag}
              onDoubleClick={() => reset("input")}
              onKeyDown={(event) => handleKey("input", event)}
            ><span /></div>
            {result}
          </>
        )}
      </main>
    </div>
  );
}
