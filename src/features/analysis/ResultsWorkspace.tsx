import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CaptureMetadata, CommandFailure, GenerationState, ResultExportFormat, ReverseResult } from "../../shared/contracts";
import { PromptPanel } from "../prompts/PromptPanel";
import { ResultPanel } from "./ResultPanel";
import { RevisionBar } from "./RevisionBar";
import { activeResultView } from "./revisions";

interface ResultsWorkspaceProps {
  result: ReverseResult | null;
  error?: CommandFailure;
  generationState: GenerationState;
  isFinal: boolean;
  canRegenerate: boolean;
  aspectRatio?: string;
  captureMetadata?: CaptureMetadata;
  imageDataUrl?: string;
  hasApiKey?: boolean;
  onCopy: (text: string) => void;
  onCopyFull?: (result: ReverseResult) => void;
  onRegenerate: () => void;
  onExport: (format: ResultExportFormat) => void;
  onResultChange?: (result: ReverseResult) => Promise<void> | void;
  onRetry?: () => void;
  onOpenSettings?: () => void;
  onOpenLogs?: (requestId?: string) => void;
  onExportDiagnostic?: (diagnosticId: string) => void;
  canSaveHistory?: boolean;
  onSaveHistory?: () => void;
  initialSplitPercent?: number;
  onSplitChange?: (percent?: number) => void;
  previewInteraction?: "refinement" | "compare";
}

const DIVIDER_HEIGHT = 10;

export function ResultsWorkspace(props: ResultsWorkspaceProps) {
  const { result, error, generationState, initialSplitPercent, onSplitChange } = props;
  const columnRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const initialSplitAppliedRef = useRef(false);
  const [analysisHeight, setAnalysisHeight] = useState<number>();
  const [manual, setManual] = useState(initialSplitPercent !== undefined);
  const [refineRequestId, setRefineRequestId] = useState(props.previewInteraction === "refinement" ? 1 : 0);
  const streaming = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const displayResult = result ? activeResultView(result) : null;

  const limits = useCallback(() => {
    const total = columnRef.current?.clientHeight ?? 0;
    const available = Math.max(0, total - DIVIDER_HEIGHT);
    const min = Math.min(220, Math.max(150, available * 0.28));
    const max = Math.max(min, available * 0.5);
    return { available, min, max };
  }, []);

  const resizeTo = useCallback((height: number) => {
    const { min, max } = limits();
    setAnalysisHeight(Math.round(Math.min(max, Math.max(min, height))));
  }, [limits]);

  const fitToContent = useCallback(() => {
    const column = columnRef.current;
    if (!column) return;
    const { available, min, max } = limits();
    if (!available) return;

    if (!result && !error) {
      setAnalysisHeight(Math.round(available * 0.42));
      return;
    }

    const promptBody = column.querySelector<HTMLElement>(".prompt-content pre");
    const promptDemand = 110 + Math.min(560, Math.max(220, promptBody?.scrollHeight ?? 0));
    const base = available * 0.42;
    const promptOverflow = Math.max(0, promptDemand - available * 0.58);
    const target = base - Math.min(available * 0.14, promptOverflow * 0.35);
    setAnalysisHeight(Math.round(Math.min(max, Math.max(min, target))));
  }, [error, limits, result]);

  useLayoutEffect(() => {
    if (initialSplitPercent === undefined || initialSplitAppliedRef.current) return;
    const { available } = limits();
    if (available) {
      initialSplitAppliedRef.current = true;
      setManual(true);
      resizeTo(available * initialSplitPercent / 100);
    }
  }, [analysisHeight, initialSplitPercent, limits, resizeTo]);

  useLayoutEffect(() => {
    if (manual) return;
    if (streaming) {
      const { available } = limits();
      if (available && generationState === "connecting") setAnalysisHeight(Math.round(available * 0.42));
      return;
    }
    fitToContent();
  }, [fitToContent, generationState, limits, manual, streaming]);

  useLayoutEffect(() => {
    const column = columnRef.current;
    if (!column || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (manual) resizeTo(analysisHeight ?? column.clientHeight * 0.42);
        else if (streaming) {
          const { available } = limits();
          if (available) setAnalysisHeight(Math.round(available * 0.42));
        } else fitToContent();
      });
    });
    observer.observe(column);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [analysisHeight, fitToContent, limits, manual, resizeTo, streaming]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const { available } = limits();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: analysisHeight ?? available * 0.42,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setManual(true);
  };

  const moveResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    resizeTo(drag.startHeight + event.clientY - drag.startY);
  };

  const stopResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const { available } = limits();
    if (available && analysisHeight) onSplitChange?.(Math.round(analysisHeight / available * 100));
  };

  const handleDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === "Home") {
      event.preventDefault();
      setManual(false);
      fitToContent();
      onSplitChange?.(undefined);
      return;
    }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const { available } = limits();
    const step = event.shiftKey ? 40 : 12;
    setManual(true);
    resizeTo((analysisHeight ?? available * 0.42) + (event.key === "ArrowDown" ? step : -step));
  };

  const { available } = limits();
  const splitPercent = available && analysisHeight ? Math.round(analysisHeight / available * 100) : 42;

  return (
    <div className="result-workspace">
      <RevisionBar result={result} isFinal={props.isFinal} imageDataUrl={props.imageDataUrl} hasApiKey={props.hasApiKey} captureMetadata={props.captureMetadata} onResultChange={props.onResultChange} onCopy={props.onCopy} onOpenLogs={props.onOpenLogs} onExportDiagnostic={props.onExportDiagnostic} refineRequestId={refineRequestId} previewInteraction={props.previewInteraction === "compare" ? "compare" : undefined} />
      <div
        ref={columnRef}
        className={`result-column ${manual ? "is-manual" : "is-auto"}`}
        style={analysisHeight ? { "--analysis-height": `${analysisHeight}px` } as React.CSSProperties : undefined}
      >
      <ResultPanel result={displayResult} generationState={generationState} captureMetadata={props.captureMetadata} onRefine={() => setRefineRequestId((value) => value + 1)} />
      <div
        className="result-divider"
        role="separator"
        aria-label="调整摄影测定和提示词区域高度"
        aria-orientation="horizontal"
        aria-valuemin={28}
        aria-valuemax={50}
        aria-valuenow={splitPercent}
        tabIndex={0}
        title={manual ? "拖动调整高度，双击恢复自动布局" : "自动布局，拖动可手动调整"}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onDoubleClick={() => { setManual(false); fitToContent(); onSplitChange?.(undefined); }}
        onKeyDown={handleDividerKeyDown}
      >
        <span aria-hidden="true" />
      </div>
      <PromptPanel {...props} />
      </div>
    </div>
  );
}
