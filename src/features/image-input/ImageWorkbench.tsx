import { Button, Drawer, Dropdown, Input, Menu, Modal, Radio, Slider, Tag, Tooltip, Upload } from "@arco-design/web-react";
import {
  IconDelete,
  IconDownload,
  IconExpand,
  IconFullscreen,
  IconImage,
  IconMore,
  IconPlayArrow,
  IconRefresh,
  IconScan,
  IconSettings,
  IconStop,
  IconZoomIn,
  IconZoomOut,
} from "@arco-design/web-react/icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { DetailLevel, GenerationState, ImageInfo, OutputLanguage, PreparedImage } from "../../shared/contracts";
import { ProcessingStatus } from "../generation/ProcessingStatus";
import { ImageViewer } from "./ImageViewer";
import { formatBytes } from "./image";

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
  elapsedMs?: number;
  firstTokenMs?: number;
  requestStarted?: boolean;
  receivedCharacters?: number;
  completedItems?: number;
  totalItems?: number;
  hasApiKey?: boolean;
  hasUnsavedResult?: boolean;
  onImageFile: (file: File) => void | Promise<void>;
  onImageFiles?: (files: File[]) => void | Promise<void>;
  onRequirementsChange: (value: string) => void;
  onOutputLanguageChange: (value: OutputLanguage) => void;
  onDetailLevelChange: (value: DetailLevel) => void;
  onZoomChange: (value: number) => void;
  onFitModeChange: (value: "contain" | "cover") => void;
  onGenerate: () => void;
  onStop: () => void;
  onConfigure?: () => void;
  originalStatus?: "staged" | "retained" | "thumbnail" | "loading" | "error";
  onExportOriginal?: () => void;
  onRemoveImage?: () => void | Promise<void>;
}

export function ImageWorkbench({
  image, displayImage, imageInfo, requirements, outputLanguage, detailLevel, zoom, fitMode,
  loading, generationState, hasApiKey = true, onImageFile, onImageFiles, onRequirementsChange, onOutputLanguageChange,
  onDetailLevelChange, onZoomChange, onFitModeChange, onGenerate, onStop, onConfigure,
  originalStatus = "thumbnail", onExportOriginal, onRemoveImage, hasUnsavedResult = false,
  elapsedMs = 0, firstTokenMs, requestStarted = false, receivedCharacters = 0, completedItems = 0, totalItems = 10,
}: ImageWorkbenchProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<DragState | null>(null);
  const dragDepthRef = useRef(0);
  const processingTaskRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputStatus = loading ? "分析中" : displayImage ? "图像就绪" : "等待图片";

  useEffect(() => setPan({ x: 0, y: 0 }), [displayImage, fitMode]);
  useEffect(() => {
    if (generationState !== "complete") {
      setShowCompletion(false);
      return;
    }
    setShowCompletion(true);
    const timer = window.setTimeout(() => setShowCompletion(false), 1_400);
    return () => window.clearTimeout(timer);
  }, [generationState]);
  const clampStagePan = useCallback((value: { x: number; y: number }, atZoom = zoom) => {
    const stage = stageRef.current;
    if (!stage || !imageInfo) return { x: 0, y: 0 };
    const ratio = imageInfo.width / imageInfo.height;
    const stageRatio = stage.clientWidth / Math.max(1, stage.clientHeight);
    const containWidth = ratio > stageRatio ? stage.clientWidth : stage.clientHeight * ratio;
    const containHeight = ratio > stageRatio ? stage.clientWidth / ratio : stage.clientHeight;
    const baseWidth = fitMode === "cover" ? Math.max(stage.clientWidth, stage.clientHeight * ratio) : containWidth;
    const baseHeight = fitMode === "cover" ? Math.max(stage.clientHeight, stage.clientWidth / ratio) : containHeight;
    const maxX = Math.max(0, (baseWidth * atZoom / 100 - stage.clientWidth) / 2);
    const maxY = Math.max(0, (baseHeight * atZoom / 100 - stage.clientHeight) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, value.x)), y: Math.min(maxY, Math.max(-maxY, value.y)) };
  }, [fitMode, imageInfo, zoom]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setPan((current) => clampStagePan(current)));
    });
    observer.observe(stage);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [clampStagePan]);

  const updateStageZoom = useCallback((next: number, point?: { x: number; y: number }) => {
    const clamped = clampZoom(next, 50, 400);
    setPan((current) => {
      if (!point || !stageRef.current) return clampStagePan(current, clamped);
      const rect = stageRef.current.getBoundingClientRect();
      const offsetX = point.x - rect.left - rect.width / 2;
      const offsetY = point.y - rect.top - rect.height / 2;
      const ratio = clamped / zoom;
      return clampStagePan({ x: offsetX - (offsetX - current.x) * ratio, y: offsetY - (offsetY - current.y) * ratio }, clamped);
    });
    onZoomChange(clamped);
  }, [clampStagePan, onZoomChange, zoom]);
  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!displayImage) return;
    if (event.ctrlKey) {
      event.preventDefault();
      updateStageZoom(zoom - event.deltaY * 0.22, { x: event.clientX, y: event.clientY });
    } else if (zoom > 100 || fitMode === "cover") {
      event.preventDefault();
      setPan((current) => clampStagePan({ x: current.x - event.deltaX, y: current.y - event.deltaY }));
    }
  };
  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!displayImage || event.button !== 0 || event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan(clampStagePan({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY }));
  };
  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resetStage = () => { setPan({ x: 0, y: 0 }); onZoomChange(100); };
  const toggleFitMode = () => {
    setPan({ x: 0, y: 0 });
    onZoomChange(100);
    onFitModeChange(fitMode === "contain" ? "cover" : "contain");
  };
  const processFile = (file: File) => {
    if (!loading) {
      const task = ++processingTaskRef.current;
      setProcessing(true);
      void Promise.resolve(onImageFile(file)).finally(() => {
        if (task === processingTaskRef.current) setProcessing(false);
      });
    }
  };
  const chooseFile = (file: File) => {
    if (hasUnsavedResult) {
      Modal.confirm({
        title: "替换当前图片？",
        content: "当前生成结果尚未保存，替换图片后将清空这些内容。",
        okText: "继续替换",
        cancelText: "取消",
        onOk: () => processFile(file),
      });
    } else processFile(file);
    return false;
  };
  const removeImage = () => {
    if (!displayImage || !onRemoveImage) return;
    const execute = () => void Promise.resolve(onRemoveImage());
    if (hasUnsavedResult) {
      Modal.confirm({
        title: "移除当前图片？",
        content: "当前生成结果尚未保存，移除图片后将清空这些内容。",
        okText: "移除图片",
        cancelText: "取消",
        onOk: execute,
      });
    } else execute();
  };
  const hasDraggedFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  };
  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = loading ? "none" : "copy";
  };
  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragActive) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };
  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (loading) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 1 && onImageFiles) void Promise.resolve(onImageFiles(files));
    else if (files[0]) chooseFile(files[0]);
  };
  const handleStageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!displayImage) return;
    if (event.key === "Enter") {
      event.preventDefault();
      setViewerOpen(true);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      updateStageZoom(zoom + 10);
    } else if (event.key === "-") {
      event.preventDefault();
      updateStageZoom(zoom - 10);
    } else if (event.key === "0") {
      event.preventDefault();
      resetStage();
    } else if ((zoom > 100 || fitMode === "cover") && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 40 : 16;
      setPan((current) => clampStagePan({
        x: current.x + (event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
        y: current.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
      }));
    }
  };
  const originalStatusLabel = originalStatus === "retained" ? "原图已保留"
    : originalStatus === "staged" ? "原图待归档"
      : originalStatus === "loading" ? "正在读取原图"
        : originalStatus === "error" ? "原图不可用" : "仅保留缩略图";
  const moreMenu = (
    <Menu onClickMenuItem={(key) => {
      if (key === "export") onExportOriginal?.();
      else if (key === "remove") removeImage();
    }}>
      <Menu.Item key="export" disabled={!onExportOriginal || originalStatus !== "retained"}><IconDownload />导出原图</Menu.Item>
      <Menu.Item key="remove" disabled={!displayImage || loading || processing || !onRemoveImage}><IconDelete />移除图片</Menu.Item>
    </Menu>
  );

  return (
    <section ref={panelRef} className="input-lab panel" aria-busy={loading}>
      <header className="panel-header">
        <div><h2>视觉输入</h2></div>
        <Tag size="small" color={loading ? "purple" : displayImage ? "arcoblue" : "gray"}>{processing ? "处理图片" : inputStatus}</Tag>
      </header>
      <div className="image-workspace">
        <div className="image-stage-wrap">
          <div
            ref={stageRef}
            className={`image-stage ${zoom > 100 || fitMode === "cover" ? "can-pan" : ""} ${loading ? "is-processing" : ""}`}
            tabIndex={displayImage ? 0 : -1}
            aria-label={displayImage ? "视觉输入画布" : undefined}
            onWheel={handleWheel}
            onDoubleClick={(event) => { if (displayImage && event.target === event.currentTarget) setViewerOpen(true); }}
            onKeyDown={handleStageKeyDown}
            onPointerDown={beginPan}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onDragEnterCapture={handleDragEnter}
            onDragOverCapture={handleDragOver}
            onDragLeaveCapture={handleDragLeave}
            onDropCapture={handleDrop}
            title={displayImage ? "双击放大查看" : undefined}
          >
            {displayImage ? (
              <img src={displayImage} alt="待分析图片" draggable={false} style={{ objectFit: fitMode, transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom / 100})` }} />
            ) : (
              <Upload
                className="drop-target"
                drag
                multiple
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                autoUpload={false}
                disabled={loading}
                beforeUpload={chooseFile}
              >
                <div className="drop-content"><IconImage /><strong>拖入图片或点击选择</strong><span>PNG / JPEG / WebP，最大 20 MB</span></div>
              </Upload>
            )}
            {imageInfo ? <span className="resolution-tag">{imageInfo.width} × {imageInfo.height}</span> : null}
            {dragActive ? (
              <div className={`image-drop-overlay ${loading ? "is-disabled" : ""}`} role="status">
                <IconImage />
                <strong>{loading ? "当前无法替换图片" : displayImage ? "松开以替换图片" : "松开以导入图片"}</strong>
                <span>支持 PNG、JPEG 和 WebP</span>
              </div>
            ) : null}
            {displayImage && !parametersOpen ? (
              <div
                className="image-floating-tools"
                role="toolbar"
                aria-label="图片画布工具"
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <ToolButton label="缩小" onClick={() => updateStageZoom(zoom - 10)}><IconZoomOut /></ToolButton>
                <Slider min={50} max={400} step={10} value={zoom} onChange={(value) => updateStageZoom(value as number)} aria-label="画布缩放比例" />
                <output>{zoom}%</output>
                <ToolButton label="放大" onClick={() => updateStageZoom(zoom + 10)}><IconZoomIn /></ToolButton>
                <span className="image-tool-divider" aria-hidden="true" />
                <ToolButton label="重置视图" onClick={resetStage}><IconRefresh /></ToolButton>
                <ToolButton label={fitMode === "contain" ? "填满画布" : "适应画布"} onClick={toggleFitMode}><IconExpand /></ToolButton>
                <ToolButton label="放大查看" onClick={() => setViewerOpen(true)}><IconFullscreen /></ToolButton>
                <Dropdown droplist={moreMenu} position="br" trigger="click">
                  <Button shape="circle" type="text" icon={<IconMore />} aria-label="更多图片操作" />
                </Dropdown>
              </div>
            ) : null}
            {loading || showCompletion ? (
              <ProcessingStatus
                kind="generation"
                state={generationState}
                elapsedMs={elapsedMs}
                requestStarted={requestStarted}
                firstTokenMs={firstTokenMs}
                receivedCharacters={receivedCharacters}
                completedItems={completedItems}
                totalItems={totalItems}
                compact
              />
            ) : null}
          </div>
          <div className="image-info-strip">
            <span className="image-meta" title={imageInfo?.name}>{imageInfo ? imageInfo.name : "尚未选择图片"}</span>
            {imageInfo ? <><strong>{imageInfo.width} × {imageInfo.height}</strong><span>{formatBytes(imageInfo.size)} · {imageInfo.mimeType.replace("image/", "").toUpperCase()}</span></> : null}
            {imageInfo ? <Tag color={originalStatus === "retained" || originalStatus === "staged" ? "green" : originalStatus === "error" ? "red" : "orange"} size="small">{originalStatusLabel}</Tag> : null}
          </div>
        </div>
        <footer className="input-actionbar" aria-label="视觉输入操作">
          <Upload accept="image/png,image/jpeg,image/webp" showUploadList={false} autoUpload={false} disabled={loading} beforeUpload={chooseFile}>
            <Button icon={<IconImage />} loading={processing} disabled={loading}>{displayImage ? "替换图片" : "选择图片"}</Button>
          </Upload>
          <Button icon={<IconSettings />} disabled={processing} onClick={() => setParametersOpen(true)}>反推参数</Button>
          <Button
            className="generate-action"
            type="primary"
            status={loading ? "danger" : undefined}
            loading={generationState === "stopping"}
            icon={loading ? <IconStop /> : <IconPlayArrow />}
            onClick={loading ? onStop : hasApiKey ? onGenerate : onConfigure}
            disabled={!loading && hasApiKey && !image?.modelDataUrl}
          >{generationState === "stopping" ? "正在停止" : loading ? "停止生成" : hasApiKey ? "开始反推" : "配置模型服务"}</Button>
        </footer>
      </div>
      <Drawer
        className="input-parameters-drawer"
        width={370}
        title="反推参数"
        placement="right"
        visible={parametersOpen}
        footer={null}
        maskClosable
        unmountOnExit={false}
        getPopupContainer={() => panelRef.current ?? document.body}
        onCancel={() => setParametersOpen(false)}
      >
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
              <Radio.Group
                className="segmented-control"
                type="button"
                aria-labelledby="output-language-label"
                value={outputLanguage}
                disabled={loading}
                onChange={(value) => onOutputLanguageChange(value as OutputLanguage)}
              >
                {languageOptions.map((option) => <Radio key={option.value} value={option.value}>{option.label}</Radio>)}
              </Radio.Group>
            </div>
            <div className="field-group">
              <span id="detail-level-label">详细程度</span>
              <Radio.Group
                className="segmented-control"
                type="button"
                aria-labelledby="detail-level-label"
                value={detailLevel}
                disabled={loading}
                onChange={(value) => onDetailLevelChange(value as DetailLevel)}
              >
                {detailOptions.map((option) => <Radio key={option.value} value={option.value}>{option.label}</Radio>)}
              </Radio.Group>
            </div>
          </div>
          {imageInfo ? (
            <div className="file-diagnostics">
              <span><IconScan /> {image ? "原始图像" : "历史缩略图"}</span>
              <strong>{imageInfo.width} × {imageInfo.height}</strong>
              <small>{formatBytes(imageInfo.size)} · {imageInfo.mimeType.replace("image/", "").toUpperCase()}</small>
              <Tag color={originalStatus === "retained" || originalStatus === "staged" ? "green" : originalStatus === "error" ? "red" : "orange"} size="small">{originalStatusLabel}</Tag>
            </div>
          ) : null}
          <div className="generate-dock">
            <span className="privacy-note"><i />原图由 Keychain 密钥加密后保存在本机应用私有目录</span>
          </div>
        </div>
      </Drawer>
      {viewerOpen && displayImage
        ? createPortal(
            <ImageViewer src={displayImage} alt={imageInfo?.name || "图片预览"} info={imageInfo} onClose={() => setViewerOpen(false)} />,
            document.body,
          )
        : null}
    </section>
  );
}

const languageOptions = [
  { value: "chinese", label: "中文" }, { value: "english", label: "英文" }, { value: "bilingual", label: "中英双语" },
];
const detailOptions = [
  { value: "concise", label: "精简" }, { value: "standard", label: "标准" }, { value: "detailed", label: "详细" }, { value: "expert", label: "专家级" },
];

function ToolButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Tooltip content={label}><Button shape="circle" type="text" icon={children} disabled={disabled} onClick={onClick} aria-label={label} /></Tooltip>;
}

interface DragState { pointerId: number; startX: number; startY: number; originX: number; originY: number }

function clampZoom(value: number, min: number, max: number): number { return Math.round(Math.min(max, Math.max(min, value))); }
