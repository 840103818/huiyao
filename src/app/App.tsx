import { Alert, Button, Drawer, Message, Modal, Popconfirm, Spin } from "@arco-design/web-react";
import { IconCheckCircle, IconClockCircle, IconExperiment, IconStorage } from "@arco-design/web-react/icon";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "./shell/Toolbar";
import type { AppView } from "./shell/Toolbar";
import { useMediaQuery } from "./state/useMediaQuery";
import { useTheme } from "./state/useTheme";
import { useClipboardImage, useWorkspaceShortcuts } from "./state/useWorkspaceInteractions";
import { countCompletedAnalysis, fileTitle, generationStateClass, generationStateLabel, simplifyAspectRatio, toImageInfo } from "./state/workspace";
import { ResultsWorkspace } from "../features/analysis/ResultsWorkspace";
import { Sidebar } from "../features/history/Sidebar";
import type { HistoryCopyKind } from "../features/history/Sidebar";
import { ImageWorkbench } from "../features/image-input/ImageWorkbench";
import {
  cancelReversePrompt,
  discardOriginalStage,
  exportDiagnostic,
  exportOriginalImage,
  exportResult,
  getActivePromptVersion,
  getCommandFailure,
  getErrorCode,
  getErrorMessage,
  getSettings,
  isDesktopApp,
  loadOriginalImage,
  loadHistory,
  persistHistory,
  runReversePrompt,
  removeHistoryOriginal,
  saveTheme,
  saveWorkspacePreferences,
  stageOriginalImage,
  toMarkdown,
} from "../infrastructure/tauri";
import { prepareImage } from "../features/image-input/image";
import { parseStreamingResult } from "../features/generation/stream";
import type {
  CommandFailure,
  DetailLevel,
  FitMode,
  GenerationState,
  HistoryItem,
  ImageInfo,
  OriginalImageCommit,
  OutputLanguage,
  PreparedImage,
  PublicSettings,
  ResultExportFormat,
  ReverseResult,
  ReverseStreamEvent,
  ThemeMode,
} from "../shared/contracts";

const LogsView = lazy(() => import("../features/diagnostics/LogsView").then((module) => ({ default: module.LogsView })));
const SettingsView = lazy(() => import("../features/settings/SettingsView").then((module) => ({ default: module.SettingsView })));

const DEFAULT_SETTINGS: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutSeconds: 120,
  theme: "system",
  hasApiKey: false,
  autoSaveHistory: true,
  workspace: { outputLanguage: "chinese", detailLevel: "expert", fitMode: "contain" },
};

export default function App() {
  const [messageApi, messageContext] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  messageApiRef.current = messageApi;
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [view, setView] = useState<AppView>("workspace");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [activeHistoryId, setActiveHistoryId] = useState<string>();
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [displayImage, setDisplayImage] = useState<string>();
  const [displayImageInfo, setDisplayImageInfo] = useState<ImageInfo | null>(null);
  const [requirements, setRequirements] = useState("");
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("chinese");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("expert");
  const [zoom, setZoom] = useState(100);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [result, setResult] = useState<ReverseResult | null>(null);
  const [isFinalResult, setIsFinalResult] = useState(false);
  const [generationError, setGenerationError] = useState<CommandFailure>();
  const [historySaveError, setHistorySaveError] = useState<string>();
  const [pendingHistoryItem, setPendingHistoryItem] = useState<HistoryItem>();
  const [pendingOriginalCommit, setPendingOriginalCommit] = useState<OriginalImageCommit>();
  const [originalStageError, setOriginalStageError] = useState<string>();
  const [originalLoadFailure, setOriginalLoadFailure] = useState<CommandFailure>();
  const [originalLoading, setOriginalLoading] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string>();
  const [historyLoadError, setHistoryLoadError] = useState<string>();
  const [settingsReloading, setSettingsReloading] = useState(false);
  const [historyReloading, setHistoryReloading] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [logsRequestFilter, setLogsRequestFilter] = useState<string>();
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [interactionId, setInteractionId] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [firstTokenMs, setFirstTokenMs] = useState<number>();
  const [receivedCharacters, setReceivedCharacters] = useState(0);
  const streamBufferRef = useRef("");
  const streamFrameRef = useRef(0);
  const receivedCharactersRef = useRef(0);
  const themeOverrideRef = useRef<ThemeMode | undefined>(undefined);
  const requestStartedAtRef = useRef(0);
  const firstTokenRecordedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const imageTaskRef = useRef(0);
  const historyRef = useRef<HistoryItem[]>([]);
  const historyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferencesTimerRef = useRef<number>();
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);

  const compactHistory = useMediaQuery("(max-width: 1239px)");
  const showNotice = useCallback((message: string, kind: "success" | "error" = "success") => {
    messageApiRef.current[kind]?.(message);
  }, []);
  const showPasteRejected = useCallback((message: string) => showNotice(message, "error"), [showNotice]);

  const reloadSettings = useCallback(async () => {
    setSettingsReloading(true);
    try {
      const nextSettings = await getSettings();
      const resolved = themeOverrideRef.current ? { ...nextSettings, theme: themeOverrideRef.current } : nextSettings;
      setSettings(resolved);
      setOutputLanguage(resolved.workspace.outputLanguage);
      setDetailLevel(resolved.workspace.detailLevel);
      setFitMode(resolved.workspace.fitMode);
      setSettingsLoadError(undefined);
    } catch (error) {
      setSettingsLoadError(getErrorMessage(error));
    } finally {
      setSettingsReloading(false);
    }
  }, []);

  const reloadHistory = useCallback(async () => {
    setHistoryReloading(true);
    const operation = historyQueueRef.current.catch(() => undefined).then(async () => {
      const nextHistory = await loadHistory();
      historyRef.current = nextHistory;
      setHistory(nextHistory);
    });
    historyQueueRef.current = operation.then(() => undefined, () => undefined);
    try {
      await operation;
      setHistoryLoadError(undefined);
    } catch (error) {
      setHistoryLoadError(getErrorMessage(error));
    } finally {
      setHistoryReloading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSettings();
    void reloadHistory();
  }, []);

  useTheme(settings.theme);

  useEffect(() => () => {
    if (image?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  }, [image]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - requestStartedAtRef.current);
    }, 100);
    return () => window.clearInterval(timer);
  }, [loading]);

  const resetOutput = useCallback(() => {
    setResult(null);
    setIsFinalResult(false);
    setGenerationError(undefined);
    setHistorySaveError(undefined);
    setPendingHistoryItem(undefined);
    setPendingOriginalCommit(undefined);
    setOriginalLoadFailure(undefined);
    setGenerationState("idle");
    setInteractionId(undefined);
    setElapsedMs(0);
    setFirstTokenMs(undefined);
    setReceivedCharacters(0);
    receivedCharactersRef.current = 0;
    firstTokenRecordedRef.current = false;
    streamBufferRef.current = "";
    window.cancelAnimationFrame(streamFrameRef.current);
    streamFrameRef.current = 0;
  }, []);

  const handleImageFile = useCallback(async (file: File) => {
    const task = ++imageTaskRef.current;
    let originalStage: PreparedImage["originalStage"];
    let stageFailure: string | undefined;
    try {
      if (isDesktopApp()) {
        try {
          originalStage = await stageOriginalImage(file);
          if (task !== imageTaskRef.current) {
            await discardOriginalStage(originalStage.stagingId);
            return;
          }
        } catch (error) {
          stageFailure = getErrorMessage(error);
        }
      }
      const prepared = await prepareImage(file, originalStage ? {
        width: originalStage.sourceWidth,
        height: originalStage.sourceHeight,
      } : undefined);
      if (task !== imageTaskRef.current) {
        if (prepared.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prepared.previewUrl);
        return;
      }
      const staged = { ...prepared, originalStage, captureMetadata: originalStage?.captureMetadata };
      setOriginalStageError(stageFailure);
      if (image?.originalStage && image.originalStage.stagingId !== staged.originalStage?.stagingId) {
        await discardOriginalStage(image.originalStage.stagingId).catch(() => undefined);
      }
      setImage(staged);
      setDisplayImage(staged.previewUrl);
      setDisplayImageInfo(toImageInfo(staged));
      setActiveHistoryId(undefined);
      setZoom(100);
      resetOutput();
      showNotice("图片已就绪");
    } catch (error) {
      if (originalStage) await discardOriginalStage(originalStage.stagingId).catch(() => undefined);
      if (task !== imageTaskRef.current) return;
      showNotice(getErrorMessage(error), "error");
    }
  }, [image?.originalStage, resetOutput, showNotice]);

  const handleRemoveCurrentImage = useCallback(async () => {
    ++imageTaskRef.current;
    if (image?.originalStage) await discardOriginalStage(image.originalStage.stagingId).catch(() => undefined);
    setImage(null);
    setDisplayImage(undefined);
    setDisplayImageInfo(null);
    setActiveHistoryId(undefined);
    setZoom(100);
    resetOutput();
    showNotice("当前图片已移除");
  }, [image?.originalStage, resetOutput, showNotice]);

  const handleStreamEvent = useCallback((event: ReverseStreamEvent) => {
    if (event.type === "started") {
      setInteractionId(event.interactionId);
      if (cancelRequestedRef.current) void cancelReversePrompt(event.interactionId);
      return;
    }
    if (event.type === "fallback") {
      setGenerationState("fallback");
      return;
    }
    if (!firstTokenRecordedRef.current) {
      firstTokenRecordedRef.current = true;
      setFirstTokenMs(Date.now() - requestStartedAtRef.current);
    }
    setGenerationState("streaming");
    streamBufferRef.current += event.content;
    receivedCharactersRef.current += Array.from(event.content).length;
    if (!streamFrameRef.current) {
      streamFrameRef.current = window.requestAnimationFrame(() => {
        streamFrameRef.current = 0;
        setReceivedCharacters(receivedCharactersRef.current);
        const partial = parseStreamingResult(streamBufferRef.current);
        if (partial) setResult(partial);
      });
    }
  }, []);

  const updateHistory = useCallback((mutate: (items: HistoryItem[]) => HistoryItem[], originalCommit?: OriginalImageCommit) => {
    const operation = historyQueueRef.current.catch(() => undefined).then(async () => {
      const next = mutate(historyRef.current).slice(0, 50);
      if (originalCommit) await persistHistory(next, originalCommit);
      else await persistHistory(next);
      historyRef.current = next;
      setHistory(next);
      return next;
    });
    historyQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!settings.hasApiKey) {
      setView("settings");
      return;
    }
    if (!image?.modelDataUrl) {
      showNotice("请重新选择图片后再生成", "error");
      return;
    }
    let requestImage = image;
    if (isDesktopApp() && requestImage.originalFile && !requestImage.originalStage) {
      try {
        const originalStage = await stageOriginalImage(requestImage.originalFile);
        requestImage = { ...requestImage, originalStage, captureMetadata: originalStage.captureMetadata ?? requestImage.captureMetadata };
        setImage(requestImage);
        setOriginalStageError(undefined);
      } catch (error) {
        setOriginalStageError(getErrorMessage(error));
      }
    }
    setResult(null);
    setIsFinalResult(false);
    setGenerationError(undefined);
    setHistorySaveError(undefined);
    setPendingHistoryItem(undefined);
    setPendingOriginalCommit(undefined);
    setGenerationState("connecting");
    setInteractionId(undefined);
    setElapsedMs(0);
    setFirstTokenMs(undefined);
    setReceivedCharacters(0);
    receivedCharactersRef.current = 0;
    firstTokenRecordedRef.current = false;
    streamBufferRef.current = "";
    cancelRequestedRef.current = false;
    requestStartedAtRef.current = Date.now();
    try {
      const next = await runReversePrompt({
        imageDataUrl: requestImage.modelDataUrl,
        requirements,
        outputLanguage,
        detailLevel,
      }, handleStreamEvent);
      window.cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = 0;
      if (cancelRequestedRef.current) {
        setGenerationState("cancelled");
        showNotice("已停止生成");
        return;
      }
      setResult(next);
      setIsFinalResult(true);
      setGenerationState("complete");
      setElapsedMs(next.metadata.elapsedMs);
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        title: fileTitle(requestImage.name),
        inputSummary: requestImage.name,
        thumbnail: requestImage.thumbnail,
        imageInfo: toImageInfo(requestImage),
        originalImage: requestImage.originalStage?.info,
        captureMetadata: requestImage.captureMetadata,
        result: next,
        createdAt: new Date().toISOString(),
      };
      const commit = requestImage.originalStage
        ? { historyId: item.id, stagingId: requestImage.originalStage.stagingId }
        : undefined;
      setPendingHistoryItem(item);
      setPendingOriginalCommit(commit);
      if (settings.autoSaveHistory) {
        if (isDesktopApp() && !commit) {
          setHistorySaveError("原图尚未安全暂存。请重试保存原图，或明确选择仅保存缩略图。");
          showNotice("反推已完成，等待确认历史保存方式", "error");
          return;
        }
        try {
          await updateHistory((current) => [item, ...current.filter((entry) => entry.id !== item.id)], commit);
          setActiveHistoryId(item.id);
          setPendingHistoryItem(undefined);
          setPendingOriginalCommit(undefined);
          if (commit) {
            setImage((current) => current?.originalStage?.stagingId === commit.stagingId
              ? { ...current, originalStage: undefined }
              : current);
          }
          showNotice("反推完成并已保存");
        } catch (error) {
          setHistorySaveError(getErrorMessage(error));
          showNotice("反推已完成，但历史保存失败", "error");
        }
      } else {
        showNotice("反推完成");
      }
    } catch (error) {
      if (getErrorCode(error) === "cancelled") {
        setGenerationState("cancelled");
        showNotice("已停止生成");
      } else {
        setGenerationState("idle");
        const failure = getCommandFailure(error);
        setGenerationError(failure);
        showNotice(failure.message, "error");
      }
    } finally {
      setInteractionId(undefined);
      cancelRequestedRef.current = false;
    }
  }, [detailLevel, handleStreamEvent, image, outputLanguage, requirements, settings.autoSaveHistory, settings.hasApiKey, showNotice, updateHistory]);

  const handleStop = useCallback(async () => {
    if (!loading) return;
    cancelRequestedRef.current = true;
    setGenerationState("stopping");
    if (!interactionId) return;
    try {
      await cancelReversePrompt(interactionId);
    } catch (error) {
      cancelRequestedRef.current = false;
      setGenerationState("streaming");
      showNotice(getErrorMessage(error), "error");
    }
  }, [interactionId, loading, showNotice]);

  const selectHistory = async (item: HistoryItem) => {
    const task = ++imageTaskRef.current;
    if (image?.originalStage) void discardOriginalStage(image.originalStage.stagingId);
    setResult(item.result);
    setIsFinalResult(true);
    setGenerationState("complete");
    setActiveHistoryId(item.id);
    setDisplayImage(item.thumbnail);
    setDisplayImageInfo(item.imageInfo ?? null);
    setImage(null);
    setOriginalLoadFailure(undefined);
    setOriginalStageError(undefined);
    setGenerationError(undefined);
    setHistorySaveError(undefined);
    setPendingHistoryItem(undefined);
    setZoom(100);
    setElapsedMs(item.result.metadata.elapsedMs);
    setFirstTokenMs(undefined);
    setReceivedCharacters(0);
    setHistoryDrawerOpen(false);
    if (!item.originalImage || !isDesktopApp()) return;
    setOriginalLoading(true);
    try {
      const bytes = await loadOriginalImage(item.id);
      if (task !== imageTaskRef.current) return;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([buffer], item.originalImage.fileName, { type: item.originalImage.mimeType });
      const prepared = await prepareImage(file, item.imageInfo ? { width: item.imageInfo.width, height: item.imageInfo.height } : undefined);
      if (task !== imageTaskRef.current) {
        if (prepared.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prepared.previewUrl);
        return;
      }
      setImage({ ...prepared, captureMetadata: item.captureMetadata });
      setDisplayImage(prepared.previewUrl);
      setDisplayImageInfo(toImageInfo(prepared));
    } catch (error) {
      if (task === imageTaskRef.current) setOriginalLoadFailure(getCommandFailure(error));
    } finally {
      if (task === imageTaskRef.current) setOriginalLoading(false);
    }
  };

  const deleteHistory = async (id: string) => {
    try {
      await updateHistory((current) => current.filter((item) => item.id !== id));
      if (activeHistoryId === id) setActiveHistoryId(undefined);
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const clearHistory = async () => {
    try {
      await updateHistory(() => []);
      setActiveHistoryId(undefined);
      showNotice("历史记录已清空");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const copyHistory = (item: HistoryItem, kind: HistoryCopyKind) => {
    const active = getActivePromptVersion(item.result);
    const prompts = active?.prompts ?? item.result.prompts;
    const text = kind === "zh" ? prompts.zh
      : kind === "en" ? prompts.en
        : toMarkdown(item.result, item.captureMetadata);
    void copyPrompt(text, kind === "all" ? "完整结果已复制" : "提示词已复制");
  };

  const renameHistory = async (id: string, title: string) => {
    try {
      await updateHistory((current) => current.map((item) => item.id === id ? { ...item, title } : item));
      showNotice("标题已更新");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
      throw error;
    }
  };

  const copyPrompt = async (text: string, successMessage = "提示词已复制") => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showNotice(successMessage);
    } catch {
      showNotice("无法访问剪贴板，请检查系统权限", "error");
    }
  };

  const exportPrompt = async (format: ResultExportFormat) => {
    if (!result || !isFinalResult) return;
    try {
      const captureMetadata = image?.captureMetadata
        ?? historyRef.current.find((item) => item.id === activeHistoryId)?.captureMetadata;
      if (await exportResult(result, format, captureMetadata)) showNotice("结果已导出");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const savePendingHistory = useCallback(async (thumbnailOnly = false) => {
    if (!pendingHistoryItem) return;
    const item = thumbnailOnly
      ? { ...pendingHistoryItem, originalImage: undefined }
      : pendingHistoryItem;
    if (isDesktopApp() && !thumbnailOnly && !pendingOriginalCommit) {
      setHistorySaveError("原图尚未安全暂存。请先重试保存原图，或选择仅保存缩略图。");
      return;
    }
    try {
      await updateHistory(
        (current) => [item, ...current.filter((entry) => entry.id !== item.id)],
        thumbnailOnly ? undefined : pendingOriginalCommit,
      );
      setActiveHistoryId(item.id);
      setPendingHistoryItem(undefined);
      if (pendingOriginalCommit) {
        if (thumbnailOnly) await discardOriginalStage(pendingOriginalCommit.stagingId);
        setImage((current) => current?.originalStage?.stagingId === pendingOriginalCommit.stagingId
          ? { ...current, originalStage: undefined }
          : current);
      }
      setPendingOriginalCommit(undefined);
      setHistorySaveError(undefined);
      showNotice(thumbnailOnly ? "已仅保存结果和缩略图" : "原图与结果已保存");
    } catch (error) {
      setHistorySaveError(getErrorMessage(error));
      showNotice(getErrorMessage(error), "error");
    }
  }, [pendingHistoryItem, pendingOriginalCommit, showNotice, updateHistory]);

  const retryStageOriginal = useCallback(async () => {
    if (!image?.originalFile) return;
    try {
      const originalStage = await stageOriginalImage(image.originalFile);
      setImage((current) => current ? { ...current, originalStage, captureMetadata: originalStage.captureMetadata ?? current.captureMetadata } : current);
      setOriginalStageError(undefined);
      if (pendingHistoryItem) {
        setPendingHistoryItem({ ...pendingHistoryItem, originalImage: originalStage.info, captureMetadata: originalStage.captureMetadata ?? pendingHistoryItem.captureMetadata });
        setPendingOriginalCommit({ historyId: pendingHistoryItem.id, stagingId: originalStage.stagingId });
      }
      showNotice("原图已加密暂存");
    } catch (error) {
      setOriginalStageError(getErrorMessage(error));
      showNotice(getErrorMessage(error), "error");
    }
  }, [image?.originalFile, pendingHistoryItem, showNotice]);

  const updatePromptResult = useCallback(async (next: ReverseResult) => {
    if (activeHistoryId) {
      await updateHistory((current) => current.map((item) => item.id === activeHistoryId ? { ...item, result: next } : item));
    }
    setResult(next);
    setPendingHistoryItem((current) => current ? { ...current, result: next } : current);
  }, [activeHistoryId, updateHistory]);

  const handleExportOriginal = useCallback(async (historyId = activeHistoryId) => {
    if (!historyId) return;
    try {
      if (await exportOriginalImage(historyId)) showNotice("原图已导出");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  }, [activeHistoryId, showNotice]);

  const handleRemoveOriginal = useCallback(async () => {
    if (!activeHistoryId) return;
    try {
      await removeHistoryOriginal(activeHistoryId);
      await reloadHistory();
      setOriginalLoadFailure(undefined);
      showNotice("原图已永久删除，分析结果和缩略图已保留");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  }, [activeHistoryId, reloadHistory, showNotice]);

  const updateWorkspacePreferences = useCallback((patch: Partial<PublicSettings["workspace"]>) => {
    setSettings((current) => {
      const workspace = { ...current.workspace, ...patch };
      window.clearTimeout(preferencesTimerRef.current);
      preferencesTimerRef.current = window.setTimeout(() => {
        void saveWorkspacePreferences(workspace)
          .then((saved) => setSettings((latest) => ({ ...latest, workspace: saved.workspace })))
          .catch((error) => showNotice(`工作台偏好保存失败：${getErrorMessage(error)}`, "error"));
      }, 300);
      return { ...current, workspace };
    });
  }, [showNotice]);

  useEffect(() => () => window.clearTimeout(preferencesTimerRef.current), []);

  useEffect(() => () => window.cancelAnimationFrame(streamFrameRef.current), []);

  const navigate = useCallback((next: AppView) => {
    if (view === "settings" && next !== "settings" && settingsDirty) {
      Modal.confirm({
        title: "放弃未保存的修改？",
        content: "模型服务配置尚未保存，离开后修改将丢失。",
        okText: "放弃修改",
        cancelText: "继续编辑",
        onOk: () => { setSettingsDirty(false); setView(next); },
      });
      return;
    }
    setView(next);
  }, [settingsDirty, view]);

  const openAssociatedLogs = useCallback((requestId?: string) => {
    setLogsRequestFilter(requestId);
    navigate("logs");
  }, [navigate]);

  const handleExportDiagnostic = useCallback(async (diagnosticId: string) => {
    try {
      if (await exportDiagnostic(diagnosticId)) showNotice("诊断信息已导出");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  }, [showNotice]);

  const handleThemeChange = useCallback(async (theme: ThemeMode) => {
    const previousTheme = settings.theme;
    themeOverrideRef.current = theme;
    setSettings((current) => ({ ...current, theme }));
    try {
      const saved = await saveTheme(theme);
      setSettings((current) => ({ ...saved, workspace: current.workspace }));
    } catch (error) {
      themeOverrideRef.current = previousTheme;
      setSettings((current) => ({ ...current, theme: previousTheme }));
      showNotice(getErrorMessage(error), "error");
      throw error;
    }
  }, [settings, showNotice]);

  const statusTime = useMemo(() => `${(elapsedMs / 1000).toFixed(2)} 秒`, [elapsedMs]);
  const completedAnalysisItems = useMemo(() => countCompletedAnalysis(result), [result]);

  useWorkspaceShortcuts({ view, loading, onGenerate: handleGenerate, onStop: handleStop });
  useClipboardImage({
    view,
    loading,
    result,
    activeHistoryId,
    onImageFile: handleImageFile,
    onRejected: showPasteRejected,
  });

  const sidebar = (
    <Sidebar
      items={history}
      activeId={activeHistoryId}
      query={historyQuery}
      onQueryChange={setHistoryQuery}
      onSelect={selectHistory}
      onDelete={deleteHistory}
      onCopy={copyHistory}
      onRename={renameHistory}
      onExportOriginal={(id) => void handleExportOriginal(id)}
      onClear={clearHistory}
    />
  );

  return (
    <div className="app-shell">
      {messageContext}
      <Toolbar
        sidebarCollapsed={sidebarCollapsed}
        compactHistory={compactHistory}
        view={view}
        generationState={generationState}
        elapsedMs={elapsedMs}
        onToggleSidebar={() => compactHistory ? setHistoryDrawerOpen(true) : setSidebarCollapsed((value) => !value)}
        onNavigate={navigate}
      />

      {settingsLoadError || historyLoadError || historySaveError || originalStageError || originalLoadFailure ? (
        <div className="notice-stack" role="region" aria-label="应用通知">
          {settingsLoadError ? (
            <Alert
              type="error"
              title="设置加载失败"
              content={settingsLoadError}
              action={<Button size="mini" loading={settingsReloading} onClick={() => void reloadSettings()}>重试加载设置</Button>}
            />
          ) : null}
          {historyLoadError ? (
            <Alert
              type="error"
              title="历史记录加载失败"
              content={historyLoadError}
              action={<Button size="mini" loading={historyReloading} onClick={() => void reloadHistory()}>重试加载历史</Button>}
            />
          ) : null}
          {historySaveError ? (
            <Alert
              type="warning"
              title="结果已生成，但历史记录尚未保存"
              content={historySaveError}
              action={pendingHistoryItem ? (
                <div className="notice-actions">
                  <Button size="mini" onClick={() => void savePendingHistory()}>重试保存原图与结果</Button>
                  <Button size="mini" type="text" onClick={() => void savePendingHistory(true)}>仅保存缩略图</Button>
                </div>
              ) : undefined}
              closable
              onClose={() => setHistorySaveError(undefined)}
            />
          ) : null}
          {originalStageError ? (
            <Alert
              type="warning"
              title="原图尚未安全暂存"
              content={originalStageError}
              action={<Button size="mini" onClick={() => void retryStageOriginal()}>重试保存原图</Button>}
              closable
              onClose={() => setOriginalStageError(undefined)}
            />
          ) : null}
          {originalLoadFailure ? (
            <Alert
              type="error"
              title="原图无法解密"
              content={`${originalLoadFailure.message}。缩略图和已有分析结果仍可继续使用。`}
              action={(
                <div className="notice-actions">
                  <Button size="mini" onClick={() => {
                    const item = historyRef.current.find((entry) => entry.id === activeHistoryId);
                    if (item) void selectHistory(item);
                  }}>重试加载</Button>
                  {originalLoadFailure.diagnosticId ? <Button size="mini" type="text" onClick={() => void handleExportDiagnostic(originalLoadFailure.diagnosticId!)}>导出诊断</Button> : null}
                  <Popconfirm title="永久删除这张原图？" content="分析结果和缩略图将保留。" okText="删除原图" cancelText="取消" onOk={() => void handleRemoveOriginal()}>
                    <Button size="mini" status="danger" type="text">删除原图</Button>
                  </Popconfirm>
                </div>
              )}
            />
          ) : null}
        </div>
      ) : null}

      <Suspense fallback={<div className="view-loading"><Spin dot tip="正在加载页面" /></div>}>
      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onBack={() => navigate("workspace")}
          onSaved={(saved) => { setSettings(saved); setSettingsDirty(false); }}
          onThemeChange={handleThemeChange}
          onDirtyChange={setSettingsDirty}
          onOriginalsCleared={reloadHistory}
        />
      ) : view === "logs" ? (
        <LogsView onBack={() => navigate("workspace")} requestFilter={logsRequestFilter} />
      ) : (
        <div className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
          {!compactHistory && !sidebarCollapsed ? sidebar : null}
          <main className="workbench-grid">
            <ImageWorkbench
              image={image}
              displayImage={displayImage}
              imageInfo={displayImageInfo}
              requirements={requirements}
              outputLanguage={outputLanguage}
              detailLevel={detailLevel}
              zoom={zoom}
              fitMode={fitMode}
              loading={loading}
              generationState={generationState}
              elapsedMs={elapsedMs}
              firstTokenMs={firstTokenMs}
              requestStarted={Boolean(interactionId)}
              receivedCharacters={receivedCharacters}
              completedItems={completedAnalysisItems}
              totalItems={10}
              hasApiKey={settings.hasApiKey}
              hasUnsavedResult={Boolean(result && !activeHistoryId)}
              onImageFile={handleImageFile}
              onRequirementsChange={setRequirements}
              onOutputLanguageChange={(value) => { setOutputLanguage(value); updateWorkspacePreferences({ outputLanguage: value }); }}
              onDetailLevelChange={(value) => { setDetailLevel(value); updateWorkspacePreferences({ detailLevel: value }); }}
              onZoomChange={setZoom}
              onFitModeChange={(value: FitMode) => { setFitMode(value); updateWorkspacePreferences({ fitMode: value }); }}
              onGenerate={handleGenerate}
              onStop={handleStop}
              onConfigure={() => navigate("settings")}
              originalStatus={originalLoading ? "loading" : originalLoadFailure ? "error"
                : activeHistoryId && history.find((item) => item.id === activeHistoryId)?.originalImage ? "retained"
                  : image?.originalStage ? "staged" : "thumbnail"}
              onExportOriginal={activeHistoryId && history.find((item) => item.id === activeHistoryId)?.originalImage
                ? () => void handleExportOriginal()
                : undefined}
              onRemoveImage={handleRemoveCurrentImage}
            />
            <ResultsWorkspace
              result={result}
              error={generationError}
              generationState={generationState}
              isFinal={isFinalResult}
              canRegenerate={Boolean(image?.modelDataUrl)}
              aspectRatio={displayImageInfo ? simplifyAspectRatio(displayImageInfo.width, displayImageInfo.height) : undefined}
              onCopy={copyPrompt}
              onCopyFull={(currentResult) => void copyPrompt(toMarkdown(currentResult, image?.captureMetadata
                ?? history.find((item) => item.id === activeHistoryId)?.captureMetadata), "完整结果已复制")}
              onRegenerate={handleGenerate}
              onExport={exportPrompt}
              captureMetadata={image?.captureMetadata ?? history.find((item) => item.id === activeHistoryId)?.captureMetadata}
              onResultChange={updatePromptResult}
              onRetry={handleGenerate}
              onOpenSettings={() => navigate("settings")}
              onOpenLogs={openAssociatedLogs}
              onExportDiagnostic={handleExportDiagnostic}
              canSaveHistory={Boolean(pendingHistoryItem)}
              onSaveHistory={() => void savePendingHistory()}
              initialSplitPercent={settings.workspace.resultSplitPercent}
              onSplitChange={(value) => updateWorkspacePreferences({ resultSplitPercent: value })}
            />
          </main>
          <Drawer className="history-drawer" width={280} title="历史记录" placement="left" visible={historyDrawerOpen} onCancel={() => setHistoryDrawerOpen(false)} footer={null} unmountOnExit>
            {sidebar}
          </Drawer>
        </div>
      )}
      </Suspense>

      {view === "workspace" ? (
        <footer className="statusbar">
          <span><IconExperiment />模型：<strong>{result?.metadata.model || (loading ? settings.model : "--")}</strong></span>
          <span><IconClockCircle />首字：<strong>{firstTokenMs ? `${firstTokenMs} 毫秒` : "--"}</strong></span>
          <span><IconStorage />令牌数：<strong>{isFinalResult ? result?.metadata.totalTokens?.toLocaleString() ?? "--" : "--"}</strong></span>
          <span><IconClockCircle />耗时：<strong>{statusTime}</strong></span>
          <span className={`status-saved ${generationStateClass(generationState)}`}>
            {generationState === "complete" ? <IconCheckCircle /> : <IconClockCircle />}
            {generationStateLabel(generationState)}
          </span>
        </footer>
      ) : null}
    </div>
  );
}
