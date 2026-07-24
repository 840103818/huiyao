import { Drawer, Message } from "@arco-design/web-react";
import { IconCheckCircle, IconClockCircle, IconExperiment, IconStorage } from "@arco-design/web-react/icon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageWorkbench } from "./components/ImageWorkbench";
import { LogsView } from "./components/LogsView";
import { PromptPanel } from "./components/PromptPanel";
import { ResultPanel } from "./components/ResultPanel";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import type { HistoryCopyKind } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import type { AppView } from "./components/Toolbar";
import {
  applyNativeTheme,
  cancelReversePrompt,
  exportResult,
  getErrorCode,
  getErrorMessage,
  getRawResponse,
  getSettings,
  loadHistory,
  persistHistory,
  runReversePrompt,
  saveTheme,
  toMarkdown,
} from "./lib/bridge";
import { prepareImage } from "./lib/image";
import { parseStreamingResult } from "./lib/stream";
import type {
  DetailLevel,
  GenerationState,
  HistoryItem,
  ImageInfo,
  OutputLanguage,
  PreparedImage,
  PublicSettings,
  ReverseResult,
  ReverseStreamEvent,
  ThemeMode,
} from "./types";

const DEFAULT_SETTINGS: PublicSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  timeoutSeconds: 120,
  theme: "system",
  hasApiKey: false,
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
  const [outputLanguage, setOutputLanguage] = useState<OutputLanguage>("bilingual");
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("expert");
  const [zoom, setZoom] = useState(100);
  const [fitMode, setFitMode] = useState<"contain" | "cover">("contain");
  const [result, setResult] = useState<ReverseResult | null>(null);
  const [isFinalResult, setIsFinalResult] = useState(false);
  const [rawResponse, setRawResponse] = useState<string>();
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [interactionId, setInteractionId] = useState<string>();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [firstTokenMs, setFirstTokenMs] = useState<number>();
  const streamBufferRef = useRef("");
  const themeOverrideRef = useRef<ThemeMode | undefined>(undefined);
  const requestStartedAtRef = useRef(0);
  const firstTokenRecordedRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const loading = ["connecting", "streaming", "fallback", "stopping"].includes(generationState);

  const compactHistory = useMediaQuery("(max-width: 1239px)");
  const showNotice = useCallback((message: string, kind: "success" | "error" = "success") => {
    messageApiRef.current[kind]?.(message);
  }, []);

  useEffect(() => {
    Promise.all([getSettings(), loadHistory()])
      .then(([nextSettings, nextHistory]) => {
        setSettings(themeOverrideRef.current ? { ...nextSettings, theme: themeOverrideRef.current } : nextSettings);
        setHistory(nextHistory);
      })
      .catch((error) => showNotice(getErrorMessage(error), "error"));
  }, [showNotice]);

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
    setRawResponse(undefined);
    setGenerationState("idle");
    setInteractionId(undefined);
    setElapsedMs(0);
    setFirstTokenMs(undefined);
    firstTokenRecordedRef.current = false;
    streamBufferRef.current = "";
  }, []);

  const handleImageFile = useCallback(async (file: File) => {
    try {
      const prepared = await prepareImage(file);
      setImage(prepared);
      setDisplayImage(prepared.previewUrl);
      setDisplayImageInfo(toImageInfo(prepared));
      setActiveHistoryId(undefined);
      setZoom(100);
      resetOutput();
      showNotice("图片已就绪");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  }, [resetOutput, showNotice]);

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
    const partial = parseStreamingResult(streamBufferRef.current);
    if (partial) setResult(partial);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!image?.modelDataUrl) {
      showNotice("请重新选择图片后再生成", "error");
      return;
    }
    setResult(null);
    setIsFinalResult(false);
    setRawResponse(undefined);
    setGenerationState("connecting");
    setInteractionId(undefined);
    setElapsedMs(0);
    setFirstTokenMs(undefined);
    firstTokenRecordedRef.current = false;
    streamBufferRef.current = "";
    cancelRequestedRef.current = false;
    requestStartedAtRef.current = Date.now();
    try {
      const next = await runReversePrompt({
        imageDataUrl: image.modelDataUrl,
        requirements,
        outputLanguage,
        detailLevel,
      }, handleStreamEvent);
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
        title: fileTitle(image.name),
        inputSummary: image.name,
        thumbnail: image.thumbnail,
        imageInfo: toImageInfo(image),
        result: next,
        createdAt: new Date().toISOString(),
      };
      const nextHistory = [item, ...history].slice(0, 50);
      await persistHistory(nextHistory);
      setHistory(nextHistory);
      setActiveHistoryId(item.id);
      showNotice("反推完成并已保存");
    } catch (error) {
      if (getErrorCode(error) === "cancelled") {
        setGenerationState("cancelled");
        showNotice("已停止生成");
      } else {
        setGenerationState("idle");
        setRawResponse(getRawResponse(error));
        showNotice(getErrorMessage(error), "error");
      }
    } finally {
      setInteractionId(undefined);
      cancelRequestedRef.current = false;
    }
  }, [detailLevel, handleStreamEvent, history, image, outputLanguage, requirements, showNotice]);

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

  const selectHistory = (item: HistoryItem) => {
    setResult(item.result);
    setIsFinalResult(true);
    setGenerationState("complete");
    setActiveHistoryId(item.id);
    setDisplayImage(item.thumbnail);
    setDisplayImageInfo(item.imageInfo ?? null);
    setImage(null);
    setRawResponse(undefined);
    setZoom(100);
    setElapsedMs(item.result.metadata.elapsedMs);
    setFirstTokenMs(undefined);
    setHistoryDrawerOpen(false);
  };

  const deleteHistory = async (id: string) => {
    const next = history.filter((item) => item.id !== id);
    try {
      await persistHistory(next);
      setHistory(next);
      if (activeHistoryId === id) setActiveHistoryId(undefined);
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const clearHistory = async () => {
    try {
      await persistHistory([]);
      setHistory([]);
      setActiveHistoryId(undefined);
      showNotice("历史记录已清空");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const copyHistory = (item: HistoryItem, kind: HistoryCopyKind) => {
    const text = kind === "zh" ? item.result.prompts.zh
      : kind === "en" ? item.result.prompts.en
        : toMarkdown(item.result);
    void copyPrompt(text);
  };

  const renameHistory = async (id: string, title: string) => {
    const next = history.map((item) => item.id === id ? { ...item, title } : item);
    try {
      await persistHistory(next);
      setHistory(next);
      showNotice("标题已更新");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
      throw error;
    }
  };

  const copyPrompt = async (text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showNotice("已复制到剪贴板");
    } catch {
      showNotice("无法访问剪贴板，请检查系统权限", "error");
    }
  };

  const exportPrompt = async () => {
    if (!result || !isFinalResult) return;
    try {
      await exportResult(result);
      showNotice("结果已导出");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  };

  const handleThemeChange = useCallback(async (theme: ThemeMode) => {
    const previous = settings;
    themeOverrideRef.current = theme;
    setSettings((current) => ({ ...current, theme }));
    try {
      setSettings(await saveTheme(theme));
    } catch (error) {
      themeOverrideRef.current = previous.theme;
      setSettings(previous);
      showNotice(getErrorMessage(error), "error");
      throw error;
    }
  }, [settings, showNotice]);

  const statusTime = useMemo(() => `${(elapsedMs / 1000).toFixed(2)} 秒`, [elapsedMs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (view !== "workspace") return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (loading) void handleStop();
        else void handleGenerate();
      } else if (event.key === "Escape" && loading && !document.querySelector('[data-image-viewer="open"]')) {
        event.preventDefault();
        void handleStop();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleGenerate, handleStop, loading, view]);

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
        onToggleSidebar={() => compactHistory ? setHistoryDrawerOpen(true) : setSidebarCollapsed((value) => !value)}
        onNavigate={setView}
      />

      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onBack={() => setView("workspace")}
          onSaved={setSettings}
          onThemeChange={handleThemeChange}
        />
      ) : view === "logs" ? (
        <LogsView onBack={() => setView("workspace")} />
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
              onImageFile={handleImageFile}
              onRequirementsChange={setRequirements}
              onOutputLanguageChange={setOutputLanguage}
              onDetailLevelChange={setDetailLevel}
              onZoomChange={setZoom}
              onFitModeChange={setFitMode}
              onGenerate={handleGenerate}
              onStop={handleStop}
            />
            <div className="result-column">
              <ResultPanel result={result} generationState={generationState} />
              <PromptPanel
                result={result}
                rawResponse={rawResponse}
                generationState={generationState}
                isFinal={isFinalResult}
                canRegenerate={Boolean(image?.modelDataUrl)}
                onCopy={copyPrompt}
                onRegenerate={handleGenerate}
                onExport={exportPrompt}
              />
            </div>
          </main>
          <Drawer className="history-drawer" width={280} title="历史记录" placement="left" visible={historyDrawerOpen} onCancel={() => setHistoryDrawerOpen(false)} footer={null} unmountOnExit>
            {sidebar}
          </Drawer>
        </div>
      )}

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

function useTheme(theme: ThemeMode) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyCssTheme = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      if (resolved === "dark") document.body.setAttribute("arco-theme", "dark");
      else document.body.removeAttribute("arco-theme");
    };
    applyCssTheme();
    void applyNativeTheme(theme).catch(() => undefined);
    media.addEventListener("change", applyCssTheme);
    return () => media.removeEventListener("change", applyCssTheme);
  }, [theme]);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function generationStateLabel(state: GenerationState): string {
  if (state === "connecting") return "正在连接";
  if (state === "streaming") return "实时生成";
  if (state === "fallback") return "兼容模式";
  if (state === "stopping") return "正在停止";
  if (state === "cancelled") return "已停止";
  if (state === "complete") return "生成完成";
  return "等待生成";
}

function generationStateClass(state: GenerationState): string {
  if (["connecting", "streaming", "fallback", "stopping"].includes(state)) return "working";
  if (state === "cancelled") return "cancelled";
  return state === "complete" ? "" : "idle";
}

function fileTitle(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").slice(0, 32) || "图片反推";
}

function toImageInfo(image: PreparedImage): ImageInfo {
  return {
    name: image.name,
    width: image.width,
    height: image.height,
    size: image.size,
    mimeType: image.mimeType,
  };
}
