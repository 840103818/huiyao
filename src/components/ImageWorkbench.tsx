import { Button, Input, Select, Slider, Tag, Tooltip, Upload } from "@arco-design/web-react";
import {
  IconClose,
  IconExpand,
  IconFullscreen,
  IconImage,
  IconPlayArrow,
  IconRefresh,
  IconScan,
  IconStop,
  IconZoomIn,
  IconZoomOut,
} from "@arco-design/web-react/icon";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { DetailLevel, GenerationState, ImageInfo, OutputLanguage, PreparedImage } from "../types";
import { formatBytes } from "../lib/image";

interface ImageWorkbenchProps {
  image: PreparedImage | null;
  displayImage?: string;
  imageInfo: ImageInfo | null;
  requirements: string;
  outputLanguage: OutputLanguage;
  detailLevel: DetailLevel;
  zoom: number;
  fitMode: "contain" | "cover";
  loading: boolean;
  generationState: GenerationState;
  onImageFile: (file: File) => void;
  onRequirementsChange: (value: string) => void;
  onOutputLanguageChange: (value: OutputLanguage) => void;
  onDetailLevelChange: (value: DetailLevel) => void;
  onZoomChange: (value: number) => void;
  onFitModeChange: (value: "contain" | "cover") => void;
  onGenerate: () => void;
  onStop: () => void;
}

export function ImageWorkbench({
  image, displayImage, imageInfo, requirements, outputLanguage, detailLevel, zoom, fitMode,
  loading, generationState, onImageFile, onRequirementsChange, onOutputLanguageChange,
  onDetailLevelChange, onZoomChange, onFitModeChange, onGenerate, onStop,
}: ImageWorkbenchProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const inputStatus = loading ? "分析中" : displayImage ? "图像就绪" : "等待图片";

  useEffect(() => setPan({ x: 0, y: 0 }), [displayImage, fitMode]);
  useEffect(() => { if (zoom <= 100) setPan({ x: 0, y: 0 }); }, [zoom]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!displayImage) return;
    event.preventDefault();
    onZoomChange(clampZoom(zoom - event.deltaY * (event.ctrlKey ? 0.22 : 0.12), 50, 400));
  };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!displayImage || zoom <= 100 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resetStage = () => { setPan({ x: 0, y: 0 }); onZoomChange(100); };
  const chooseFile = (file: File) => { if (!loading) onImageFile(file); return false; };

  return (
    <section className="input-lab panel" aria-busy={loading}>
      <header className="panel-header">
        <div><span className="section-index">01</span><h2>视觉输入</h2></div>
        <Tag size="small" color={loading ? "purple" : displayImage ? "arcoblue" : "gray"}>{inputStatus}</Tag>
      </header>
      <div className="image-mode-layout">
        <div className="image-stage-wrap">
          <Rulers width={imageInfo?.width} height={imageInfo?.height} />
          <div
            className={`image-stage ${zoom > 100 ? "can-pan" : ""}`}
            onWheel={handleWheel}
            onDoubleClick={() => { if (displayImage) setViewerOpen(true); }}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            title={displayImage ? "双击放大查看" : undefined}
          >
            {displayImage ? (
              <img src={displayImage} alt="待分析图片" draggable={false} style={{ objectFit: fitMode, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})` }} />
            ) : (
              <Upload
                className="drop-target"
                drag
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                autoUpload={false}
                disabled={loading}
                beforeUpload={chooseFile}
              >
                <div className="drop-content"><IconImage /><strong>拖入图片或点击选择</strong><span>PNG / JPEG / WebP，最大 20 MB</span></div>
              </Upload>
            )}
            <div className="scan-corners" aria-hidden="true"><i /><i /><i /><i /></div>
            {imageInfo ? <span className="resolution-tag">{imageInfo.width} × {imageInfo.height}</span> : null}
          </div>
          <div className="image-tools">
            <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} autoUpload={false} disabled={loading} beforeUpload={chooseFile}>
              <Button icon={<IconImage />} disabled={loading}>替换</Button>
            </Upload>
            <ToolButton label="缩小" disabled={!displayImage} onClick={() => onZoomChange(Math.max(50, zoom - 10))}><IconZoomOut /></ToolButton>
            <span className="zoom-value">{zoom}%</span>
            <ToolButton label="放大" disabled={!displayImage} onClick={() => onZoomChange(Math.min(400, zoom + 10))}><IconZoomIn /></ToolButton>
            <ToolButton label="重置视图" disabled={!displayImage} onClick={resetStage}><IconRefresh /></ToolButton>
            <ToolButton label={fitMode === "contain" ? "填满画布" : "适应画布"} disabled={!displayImage} onClick={() => onFitModeChange(fitMode === "contain" ? "cover" : "contain")}><IconExpand /></ToolButton>
            <span className="image-meta" title={imageInfo?.name}>{imageInfo ? `${imageInfo.name} · ${formatBytes(imageInfo.size)}` : "未选择图片"}</span>
            <ToolButton label="放大查看" disabled={!displayImage} onClick={() => setViewerOpen(true)}><IconFullscreen /></ToolButton>
          </div>
        </div>
        <div className="input-controls">
          <div className="field-group stretch-field">
            <span id="requirements-label">补充要求 <small>可选</small></span>
            <Input.TextArea
              value={requirements}
              disabled={loading}
              maxLength={500}
              showWordLimit
              autoSize={{ minRows: 3, maxRows: 6 }}
              onChange={onRequirementsChange}
              aria-labelledby="requirements-label"
              placeholder="突出金属质感，排除品牌标识，保持专业商业摄影语气…"
            />
          </div>
          <div className="select-row">
            <div className="field-group">
              <span id="output-language-label">输出语言</span>
              <Select aria-labelledby="output-language-label" value={outputLanguage} disabled={loading} onChange={onOutputLanguageChange} options={languageOptions} />
            </div>
            <div className="field-group">
              <span id="detail-level-label">详细程度</span>
              <Select aria-labelledby="detail-level-label" value={detailLevel} disabled={loading} onChange={onDetailLevelChange} options={detailOptions} />
            </div>
          </div>
          {imageInfo ? (
            <div className="file-diagnostics">
              <span><IconScan /> {image ? "原始图像" : "历史缩略图"}</span>
              <strong>{imageInfo.width} × {imageInfo.height}</strong>
              <small>{formatBytes(imageInfo.size)} · {imageInfo.mimeType.replace("image/", "").toUpperCase()}</small>
              {!image ? <Tag color="orange" size="small">重新生成需选择原图</Tag> : null}
            </div>
          ) : null}
          <Button
            className="generate-action"
            type="primary"
            status={loading ? "danger" : undefined}
            size="large"
            long
            loading={generationState === "stopping"}
            icon={loading ? <IconStop /> : <IconPlayArrow />}
            onClick={loading ? onStop : onGenerate}
            disabled={!loading && !image?.modelDataUrl}
          >{generationState === "stopping" ? "正在停止" : loading ? "停止生成" : "开始反推"}</Button>
          <span className="privacy-note"><i />原图仅用于本次请求，历史记录只保存缩略图</span>
        </div>
      </div>
      {viewerOpen && displayImage ? <ImageViewer src={displayImage} alt={imageInfo?.name || "图片预览"} info={imageInfo} onClose={() => setViewerOpen(false)} /> : null}
    </section>
  );
}

const languageOptions = [
  { value: "bilingual", label: "中英双语" }, { value: "chinese", label: "仅中文" }, { value: "english", label: "仅英文" },
];
const detailOptions = [
  { value: "concise", label: "精简" }, { value: "standard", label: "标准" }, { value: "detailed", label: "详细" }, { value: "expert", label: "专家级" },
];

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tooltip content={label}><Button shape="circle" type="text" icon={children} disabled={disabled} onClick={onClick} aria-label={label} /></Tooltip>;
}

function Rulers({ width, height }: { width?: number; height?: number }) {
  return <><div className="ruler ruler-x">{width ? [0, 1, 2, 3, 4, 5].map((index) => <span key={index}>{Math.round((width / 5) * index)}</span>) : null}</div><div className="ruler ruler-y">{height ? [0, 1, 2, 3, 4].map((index) => <span key={index}>{Math.round((height / 4) * index)}</span>) : null}</div></>;
}

interface DragState { pointerId: number; startX: number; startY: number; originX: number; originY: number }

function ImageViewer({ src, alt, info, onClose }: { src: string; alt: string; info: ImageInfo | null; onClose: () => void }) {
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const clampPan = useCallback((value: { x: number; y: number }, atZoom: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !info || atZoom <= 100) return { x: 0, y: 0 };
    const availableWidth = Math.max(1, canvas.clientWidth - 48);
    const availableHeight = Math.max(1, canvas.clientHeight - 48);
    const imageRatio = info.width / info.height;
    const canvasRatio = availableWidth / availableHeight;
    const baseWidth = imageRatio > canvasRatio ? availableWidth : availableHeight * imageRatio;
    const baseHeight = imageRatio > canvasRatio ? availableWidth / imageRatio : availableHeight;
    const maxX = Math.max(0, (baseWidth * atZoom / 100 - availableWidth) / 2);
    const maxY = Math.max(0, (baseHeight * atZoom / 100 - availableHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, value.x)), y: Math.min(maxY, Math.max(-maxY, value.y)) };
  }, [info]);

  const updateZoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const clamped = clampZoom(next, 25, 500);
    setZoom((previous) => {
      setPan((current) => {
        if (clamped <= 100) return { x: 0, y: 0 };
        if (!point || !canvasRef.current) return clampPan(current, clamped);
        const rect = canvasRef.current.getBoundingClientRect();
        const offsetX = point.x - rect.left - rect.width / 2;
        const offsetY = point.y - rect.top - rect.height / 2;
        const ratio = clamped / previous;
        return clampPan({ x: offsetX - (offsetX - current.x) * ratio, y: offsetY - (offsetY - current.y) * ratio }, clamped);
      });
      return clamped;
    });
  }, [clampPan]);
  const reset = useCallback(() => { setZoom(100); setPan({ x: 0, y: 0 }); }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "0") reset();
      else if (event.key === "+" || event.key === "=") updateZoom(zoom + 25);
      else if (event.key === "-") updateZoom(zoom - 25);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, reset, updateZoom, zoom]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setPan((current) => clampPan(current, zoom)));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [clampPan, zoom]);

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (zoom <= 100 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan(clampPan({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }, zoom));
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片查看器" data-image-viewer="open">
      <header className="viewer-toolbar">
        <div><strong>{alt}</strong><span>{info ? `${info.width} × ${info.height} · ${formatBytes(info.size)}` : "历史缩略图"}</span></div>
        <nav aria-label="图片缩放工具">
          <ToolButton label="缩小" onClick={() => updateZoom(zoom - 25)}><IconZoomOut /></ToolButton>
          <Slider min={25} max={500} step={5} value={zoom} onChange={(value) => updateZoom(value as number)} aria-label="缩放比例" />
          <output>{zoom}%</output>
          <ToolButton label="放大" onClick={() => updateZoom(zoom + 25)}><IconZoomIn /></ToolButton>
          <ToolButton label="适应窗口" onClick={reset}><IconRefresh /></ToolButton>
          <ToolButton label="关闭" onClick={onClose}><IconClose /></ToolButton>
        </nav>
      </header>
      <div
        ref={canvasRef}
        className={`viewer-canvas ${zoom > 100 ? "can-pan" : ""}`}
        onWheel={(event) => { event.preventDefault(); updateZoom(zoom - event.deltaY * (event.ctrlKey ? 0.3 : 0.16), { x: event.clientX, y: event.clientY }); }}
        onDoubleClick={(event) => { if (zoom === 100) updateZoom(200, { x: event.clientX, y: event.clientY }); else reset(); }}
        onPointerDown={beginPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      ><img src={src} alt={alt} draggable={false} style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})` }} /></div>
    </div>
  );
}

function clampZoom(value: number, min: number, max: number): number { return Math.round(Math.min(max, Math.max(min, value))); }
