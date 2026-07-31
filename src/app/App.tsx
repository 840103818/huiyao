import { Alert, Button, Checkbox, Drawer, Message, Modal, Popconfirm, Spin } from "@arco-design/web-react";
import { IconCheckCircle, IconClockCircle, IconExperiment, IconStorage } from "@arco-design/web-react/icon";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "./shell/Toolbar";
import type { AppView } from "./shell/Toolbar";
import { WorkspaceLayout } from "./shell/WorkspaceLayout";
import { useMediaQuery } from "./state/useMediaQuery";
import { useTheme } from "./state/useTheme";
import { useClipboardImage, useWorkspaceShortcuts } from "./state/useWorkspaceInteractions";
import { AnalysisRunCoordinator } from "./state/analysisRunCoordinator";
import { countCompletedAnalysis, fileTitle, generationStateClass, generationStateLabel, simplifyAspectRatio, toImageInfo } from "./state/workspace";
import { ResultsWorkspace } from "../features/analysis/ResultsWorkspace";
import { Sidebar } from "../features/history/Sidebar";
import type { HistoryCopyKind } from "../features/history/Sidebar";
import { ProjectTaskSidebar } from "../features/projects/ProjectTaskSidebar";
import { ProjectOverview } from "../features/projects/ProjectOverview";
import { runTaskQueue } from "../features/projects/queue";
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
  runPromptOptimization,
  removeHistoryOriginal,
  saveTheme,
  saveWorkspacePreferences,
  stageOriginalImage,
  toMarkdown,
  completeProjectTask,
  createProject,
  deleteProject,
  deleteProjectTasks,
  deleteReversePreset,
  duplicateProjectTask,
  emptyTrash,
  exportProjectTasks,
  exportWorkspaceOriginalImage,
  failProjectTask,
  getBatchProgress,
  getProjectTask,
  importProjectTask,
  listProjectTasks,
  listProjects,
  listReversePresets,
  listTrash,
  loadWorkspaceOriginalImage,
  moveProjectTasks,
  permanentlyDeleteTrashEntry,
  renameProject,
  reorderProjectTasks,
  restoreTrashEntry,
  saveWorkspaceSession,
  saveReversePreset,
  setProjectTaskFavorite,
  setProjectTaskTags,
  setProjectTasksFavorite,
  updateProjectTasksTags,
  renameProjectTask,
  updateProjectTaskStatus,
  updateProjectTaskResult,
} from "../infrastructure/tauri";
import { prepareImage, revokePreparedImagePreview } from "../features/image-input/image";
import { createStreamPrinterController, parseStreamingResult } from "../features/generation/stream";
import previewImage from "../assets/huiyao-mark.png";
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
  BatchProgress,
  Project,
  ProjectTask,
  ReversePreset,
  TaskFilter,
  TrashEntry,
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
  batchConcurrency: 1,
  storageQuotaBytes: 10 * 1024 * 1024 * 1024,
  progressiveDisclosure: true,
};

const EMPTY_BATCH_PROGRESS: BatchProgress = { total: 0, ready: 0, queued: 0, running: 0, completed: 0, failed: 0, paused: 0 };

export default function App() {
  const previewParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const previewMode = previewParams?.get("workspace-preview") ?? null;
  const previewTheme = previewParams?.get("theme-preview");
  const previewInteractionValue = previewParams?.get("interaction-preview");
  const previewGenerationValue = previewParams?.get("generation-preview");
  const previewInteraction = previewInteractionValue === "refinement" || previewInteractionValue === "compare" ? previewInteractionValue : undefined;
  const previewGeneration = previewGenerationValue === "locked" || previewGenerationValue === "stopping" || previewGenerationValue === "stopped" ? previewGenerationValue : undefined;
  const previewThemeMode: ThemeMode | undefined = previewTheme === "light" || previewTheme === "dark" ? previewTheme : undefined;
  const workspaceUi = isDesktopApp() || Boolean(previewMode);
  const [messageApi, messageContext] = Message.useMessage();
  const messageApiRef = useRef(messageApi);
  messageApiRef.current = messageApi;
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, theme: previewThemeMode ?? DEFAULT_SETTINGS.theme });
  const [view, setView] = useState<AppView>("workspace");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [projectTaskTotal, setProjectTaskTotal] = useState(0);
  const [activeTaskId, setActiveTaskId] = useState<string>();
  const [activeTaskSnapshot, setActiveTaskSnapshot] = useState<ProjectTask>();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [taskQuery, setTaskQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [presets, setPresets] = useState<ReversePreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>();
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchProgress>(EMPTY_BATCH_PROGRESS);
  const [queueRunning, setQueueRunning] = useState(false);
  const [analysisLocked, setAnalysisLocked] = useState(false);
  const [rerunningTaskId, setRerunningTaskId] = useState<string>();
  const [resultBusySources, setResultBusySources] = useState({ revision: false, prompt: false });
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchImportLabel, setBatchImportLabel] = useState<string>();
  const [commandOpen, setCommandOpen] = useState(false);
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
  const receivedCharactersRef = useRef(0);
  const preserveResultDuringAnalysisRef = useRef(false);
  const streamPrinterRef = useRef<ReturnType<typeof createStreamPrinterController> | null>(null);
  if (!streamPrinterRef.current) {
    streamPrinterRef.current = createStreamPrinterController((content) => {
      setReceivedCharacters(receivedCharactersRef.current);
      const partial = parseStreamingResult(content);
      if (partial && !preserveResultDuringAnalysisRef.current) setResult(partial);
    });
  }
  const themeOverrideRef = useRef<ThemeMode | undefined>(previewThemeMode);
  const requestStartedAtRef = useRef(0);
  const firstTokenRecordedRef = useRef(false);
  const runCoordinatorRef = useRef<AnalysisRunCoordinator | null>(null);
  if (!runCoordinatorRef.current) runCoordinatorRef.current = new AnalysisRunCoordinator(cancelReversePrompt);
  const imageTaskRef = useRef(0);
  const historyRef = useRef<HistoryItem[]>([]);
  const historyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferencesTimerRef = useRef<number | undefined>(undefined);
  const batchImportCancelRef = useRef(false);
  const sessionRestoredRef = useRef(false);
  const loading = analysisLocked || ["connecting", "streaming", "fallback", "stopping"].includes(generationState);
  const resultOperationBusy = resultBusySources.revision || resultBusySources.prompt;

  const compactHistory = useMediaQuery("(max-width: 1239px)");
  const showNotice = useCallback((message: string, kind: "success" | "error" = "success") => {
    messageApiRef.current[kind]?.(message);
  }, []);
  const handleResultBusyChange = useCallback((source: "revision" | "prompt", busy: boolean) => {
    setResultBusySources((current) => current[source] === busy ? current : { ...current, [source]: busy });
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

  const reloadProjects = useCallback(async (preferredProjectId?: string) => {
    if (!isDesktopApp()) return;
    const next = await listProjects();
    setProjects(next);
    setActiveProjectId((current) => {
      const preferred = preferredProjectId ?? current;
      return next.some((item) => item.id === preferred) ? preferred : next[0]?.id;
    });
  }, []);

  const reloadProjectTasks = useCallback(async (projectId: string, reset = true) => {
    if (!isDesktopApp()) return;
    const offset = reset ? 0 : projectTasks.length;
    const page = await listProjectTasks(projectId, taskFilter, taskQuery, offset, 50);
    setProjectTasks((current) => reset ? page.items : [...current, ...page.items]);
    setProjectTaskTotal(page.total);
    setBatchProgress(await getBatchProgress(projectId));
  }, [projectTasks.length, taskFilter, taskQuery]);

  const reloadTrash = useCallback(async () => {
    if (isDesktopApp()) setTrash(await listTrash());
  }, []);

  useEffect(() => {
    void reloadSettings();
    void reloadHistory();
    if (isDesktopApp()) {
      void Promise.all([listProjects(), listReversePresets(), listTrash()]).then(([nextProjects, nextPresets, nextTrash]) => {
        setProjects(nextProjects);
        setPresets(nextPresets);
        setTrash(nextTrash);
        setActivePresetId(nextPresets[0]?.id);
        setActiveProjectId((current) => current ?? nextProjects[0]?.id);
      }).catch((error) => showNotice(getErrorMessage(error), "error"));
    } else if (workspaceUi) {
      const now = new Date().toISOString();
      const previewProject: Project = { id: "preview-project", title: "产品摄影", taskCount: 3, completedCount: 1, createdAt: now, updatedAt: now };
      const previewPreset: ReversePreset = { id: "preview-preset", title: "商业产品", builtIn: true, snapshot: { requirements: "突出材质、布光和商业陈列关系", outputLanguage: "chinese", detailLevel: "expert", autoOptimizeRequirements: "" }, createdAt: now, updatedAt: now };
      const previewResult: ReverseResult = {
        analysis: {
          subject: "曜光银色金属香氛瓶置于深色石材台面，瓶身轮廓清晰，标签区域保持无品牌化处理。",
          scene: "中性深灰无缝背景，台面干净，留有充足商业排版空间。",
          composition: "主体居中略偏下，采用稳定三分构图，画面留白均衡。",
          lighting: "大型柔光箱从左上方形成柔和主光，右侧弱补光勾勒金属边缘。",
          tonality: "低调曝光与克制高光，暗部保留层次，金属反射不过曝。",
          colors: "冷灰、银白与少量紫色点缀，整体保持中性商业色调。",
          palette: ["#17171a", "#55545b", "#a9a7b2", "#f1f0f4"],
          materials: "拉丝金属、磨砂玻璃与细腻石材形成软硬材质对比。",
          style: "高端商业产品摄影，精密、克制、现代。",
          camera: "85mm 中长焦视角，f/8 景深，低 ISO，机位与产品视线齐平。",
          postProcessing: "控制高光边缘，轻微冷色调色，保留真实材质纹理。",
        },
        prompts: {
          zh: "高端商业产品摄影，一只无品牌的银色金属香氛瓶置于深灰石材台面，柔和左侧主光与右侧轮廓补光，低调曝光，冷灰银白色调，真实拉丝金属与磨砂玻璃质感，85mm 中长焦，f/8，画面干净克制。",
          en: "Premium commercial product photography of an unbranded silver fragrance bottle on a dark gray stone surface, soft key light from the upper left, subtle rim light, restrained highlights, cool neutral palette, realistic brushed metal and frosted glass, 85mm lens, f/8.",
        },
        metadata: { model: "gpt-4.1-mini", elapsedMs: 6_400, totalTokens: 1268, createdAt: now },
      };
      previewResult.resultRevisions = [
        {
          id: "preview-revision-analysis", title: "高光与镜头校正", origin: "manualAnalysis",
          analysis: { ...previewResult.analysis, lighting: "左上柔光箱压低一档，右后方窄条灯只保留瓶肩轮廓。", camera: "采用 EXIF 实拍参数：85mm，f/8，1/125s，ISO 100。" },
          lockedFields: ["lighting", "camera"], prompts: previewResult.prompts,
          negativePrompts: { zh: "", en: "" }, requirements: "压低瓶肩高光并采用实拍参数", syncState: "synced",
          metadata: { ...previewResult.metadata, elapsedMs: 0, createdAt: now },
        },
        {
          id: "preview-revision-prompt", title: "商业平台精修", origin: "optimization", sourceRevisionId: "preview-revision-analysis",
          analysis: { ...previewResult.analysis, lighting: "左上柔光箱压低一档，右后方窄条灯只保留瓶肩轮廓。", camera: "采用 EXIF 实拍参数：85mm，f/8，1/125s，ISO 100。" },
          lockedFields: ["lighting", "camera"], prompts: { ...previewResult.prompts, zh: `${previewResult.prompts.zh} 控制瓶肩高光，保留右后方细窄轮廓光。` },
          negativePrompts: { zh: "过曝高光，塑料质感，品牌文字", en: "clipped highlights, plastic texture, brand text" },
          target: "sdxl", requirements: "保留真实材质并降低高光", syncState: "synced",
          metadata: { ...previewResult.metadata, elapsedMs: 2_100, createdAt: now },
        },
      ];
      previewResult.activeResultRevisionId = "preview-revision-prompt";
      const previewTasks: ProjectTask[] = [
        { id: "preview-1", projectId: previewProject.id, title: "金属香氛瓶", fileName: "product-01.jpg", status: "ready", favorite: true, tags: ["商业", "静物"], originalImage: { fileName: "product-01.jpg", mimeType: "image/jpeg", size: 2_400_000, storedAt: now, encryptionVersion: 1 }, queuePosition: 0, createdAt: now, updatedAt: now },
        { id: "preview-2", projectId: previewProject.id, title: "玻璃护肤套装", fileName: "product-02.jpg", status: "completed", favorite: false, tags: ["棚拍"], originalImage: { fileName: "product-02.jpg", mimeType: "image/jpeg", size: 3_100_000, storedAt: now, encryptionVersion: 1 }, queuePosition: 1, result: previewResult, createdAt: now, updatedAt: now },
        { id: "preview-3", projectId: previewProject.id, title: "织物材质测试", fileName: "product-03.webp", status: "failed", favorite: false, tags: [], errorCode: "timeout", errorMessage: "请求超时", queuePosition: 2, createdAt: now, updatedAt: now },
      ];
      setProjects([previewProject, { ...previewProject, id: "preview-archive", title: "灵感归档", taskCount: 12, completedCount: 12 }]);
      setPresets([previewPreset]); setActivePresetId(previewPreset.id); setActiveProjectId(previewProject.id);
      setProjectTasks(previewTasks);
      setActiveTaskSnapshot(previewMode === "task" || previewMode === "streaming" ? previewTasks[1] : undefined);
      setProjectTaskTotal(3); setBatchProgress({ total: 3, ready: 1, queued: 0, running: 0, completed: 1, failed: 1, paused: 0 });
      if (previewMode === "task" || previewMode === "streaming") {
        const previewActive = previewMode === "streaming" || previewGeneration === "locked" || previewGeneration === "stopping";
        const previewInfo: ImageInfo = { name: "studio-product.jpg", width: 3000, height: 2000, size: 2_400_000, mimeType: "image/jpeg" };
        setActiveTaskId("preview-2");
        setDisplayImage(previewImage);
        setDisplayImageInfo(previewInfo);
        setImage({ ...previewInfo, previewUrl: previewImage, modelDataUrl: previewImage, thumbnail: previewImage });
        setResult(previewActive || previewGeneration === "stopped" ? {
          ...previewResult,
          analysis: { ...previewResult.analysis, lighting: "", tonality: "", colors: "", materials: "", style: "", camera: "", postProcessing: "" },
          prompts: { zh: "高端商业产品摄影，一只无品牌的银色金属香氛瓶", en: "" },
        } : previewResult);
        setIsFinalResult(!previewActive && previewGeneration !== "stopped");
        setGenerationState(previewGeneration === "stopping" ? "stopping" : previewGeneration === "stopped" ? "cancelled" : previewActive ? "streaming" : "complete");
        setAnalysisLocked(previewActive);
        setElapsedMs(6_400);
        setFirstTokenMs(820);
        setReceivedCharacters(previewActive || previewGeneration === "stopped" ? 186 : 0);
        if (previewActive) {
          requestStartedAtRef.current = Date.now() - 6_400;
          setInteractionId("preview-stream");
        }
      }
    }
  }, []);

  useEffect(() => {
    if (sessionRestoredRef.current || !settings.lastTaskId) return;
    const task = projectTasks.find((item) => item.id === settings.lastTaskId);
    if (task) { sessionRestoredRef.current = true; void selectProjectTask(task); }
  }, [projectTasks, settings.lastTaskId]);

  useEffect(() => {
    if (!activeProjectId) return;
    void reloadProjectTasks(activeProjectId).catch((error) => showNotice(getErrorMessage(error), "error"));
    void saveWorkspaceSession(activeProjectId, activeTaskId).catch(() => undefined);
  }, [activeProjectId, taskFilter, taskQuery]);

  useEffect(() => {
    if (settings.lastProjectId && projects.some((item) => item.id === settings.lastProjectId) && activeProjectId !== settings.lastProjectId) {
      setActiveProjectId(settings.lastProjectId);
    }
  }, [activeProjectId, projects, settings.lastProjectId]);

  useEffect(() => {
    if (activeProjectId) void saveWorkspaceSession(activeProjectId, activeTaskId).catch(() => undefined);
  }, [activeProjectId, activeTaskId]);

  useTheme(settings.theme);

  useEffect(() => () => {
    revokePreparedImagePreview(image);
  }, [image]);
  useEffect(() => () => {
    runCoordinatorRef.current?.requestStop();
    streamPrinterRef.current?.flush();
  }, []);

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
    streamPrinterRef.current?.reset();
  }, []);

  const handleImageFile = useCallback(async (file: File) => {
    const task = ++imageTaskRef.current;
    let originalStage: PreparedImage["originalStage"];
    let prepared: PreparedImage | undefined;
    let previewTransferred = false;
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
      prepared = await prepareImage(file, originalStage ? {
        width: originalStage.sourceWidth,
        height: originalStage.sourceHeight,
      } : undefined);
      if (task !== imageTaskRef.current) {
        return;
      }
      let staged = { ...prepared, originalStage, captureMetadata: originalStage?.captureMetadata };
      if (isDesktopApp() && activeProjectId && originalStage) {
        const preset = presets.find((item) => item.id === activePresetId)?.snapshot ?? {
          requirements, outputLanguage, detailLevel, autoOptimizeRequirements: "",
        };
        const taskItem = await importProjectTask({
          projectId: activeProjectId,
          title: fileTitle(file.name),
          fileName: file.name,
          thumbnail: prepared.thumbnail,
          imageInfo: toImageInfo(prepared),
          originalStage,
          presetSnapshot: preset,
        });
        staged = { ...staged, originalStage: undefined };
        setActiveTaskId(taskItem.id);
        setActiveTaskSnapshot(taskItem);
        setRequirements(taskItem.presetSnapshot?.requirements ?? "");
        setOutputLanguage(taskItem.presetSnapshot?.outputLanguage ?? "chinese");
        setDetailLevel(taskItem.presetSnapshot?.detailLevel ?? "expert");
        await Promise.all([reloadProjects(activeProjectId), reloadProjectTasks(activeProjectId)]);
      }
      setOriginalStageError(stageFailure);
      if (image?.originalStage && image.originalStage.stagingId !== staged.originalStage?.stagingId) {
        await discardOriginalStage(image.originalStage.stagingId).catch(() => undefined);
      }
      setImage(staged);
      previewTransferred = true;
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
    } finally {
      if (!previewTransferred) revokePreparedImagePreview(prepared);
    }
  }, [activePresetId, activeProjectId, detailLevel, image?.originalStage, outputLanguage, presets, reloadProjectTasks, reloadProjects, requirements, resetOutput, showNotice]);

  const handleBatchImport = useCallback(async (files: File[]) => {
    if (!activeProjectId || batchImporting) return;
    if (files.length > 100) { showNotice("每次最多导入 100 张图片", "error"); return; }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 1024 * 1024 * 1024) { showNotice("单次导入总大小不能超过 1 GB", "error"); return; }
    setBatchImporting(true);
    batchImportCancelRef.current = false;
    let firstTask: ProjectTask | undefined;
    const preset = presets.find((item) => item.id === activePresetId)?.snapshot ?? { requirements, outputLanguage, detailLevel, autoOptimizeRequirements: "" };
    try {
      for (let index = 0; index < files.length; index += 1) {
        if (batchImportCancelRef.current) break;
        const file = files[index];
        setBatchImportLabel(`${index + 1}/${files.length} · ${file.name}`);
        let stage;
        let prepared: PreparedImage | undefined;
        try {
          stage = await stageOriginalImage(file);
          prepared = await prepareImage(file, { width: stage.sourceWidth, height: stage.sourceHeight });
          const task = await importProjectTask({ projectId: activeProjectId, title: fileTitle(file.name), fileName: file.name, thumbnail: prepared.thumbnail, imageInfo: toImageInfo(prepared), originalStage: stage, presetSnapshot: preset });
          firstTask ??= task;
        } catch (error) {
          if (stage) await discardOriginalStage(stage.stagingId).catch(() => undefined);
          showNotice(`${file.name}：${getErrorMessage(error)}`, "error");
        } finally {
          revokePreparedImagePreview(prepared);
        }
      }
      await Promise.all([reloadProjects(activeProjectId), reloadProjectTasks(activeProjectId)]);
      if (firstTask) await selectProjectTask(firstTask);
    } finally {
      setBatchImporting(false);
      batchImportCancelRef.current = false;
      setBatchImportLabel(undefined);
    }
  }, [activePresetId, activeProjectId, batchImporting, detailLevel, outputLanguage, presets, reloadProjectTasks, reloadProjects, requirements, showNotice]);

  const handleRemoveCurrentImage = useCallback(async () => {
    ++imageTaskRef.current;
    if (image?.originalStage) await discardOriginalStage(image.originalStage.stagingId).catch(() => undefined);
    setImage(null);
    setDisplayImage(undefined);
    setDisplayImageInfo(null);
    setActiveHistoryId(undefined);
    setActiveTaskId(undefined);
    setActiveTaskSnapshot(undefined);
    setZoom(100);
    resetOutput();
    showNotice("当前图片已移除");
  }, [image?.originalStage, resetOutput, showNotice]);

  const handleStreamEvent = useCallback((event: ReverseStreamEvent) => {
    if (event.type === "started") {
      setInteractionId(event.interactionId);
      runCoordinatorRef.current?.registerInteraction(event.interactionId);
      return;
    }
    if (runCoordinatorRef.current?.shouldStop()) return;
    if (event.type === "fallback") {
      setGenerationState("fallback");
      return;
    }
    if (!firstTokenRecordedRef.current) {
      firstTokenRecordedRef.current = true;
      setFirstTokenMs(Date.now() - requestStartedAtRef.current);
    }
    setGenerationState("streaming");
    receivedCharactersRef.current += Array.from(event.content).length;
    streamPrinterRef.current?.append(event.content);
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

  const runCurrentAnalysis = useCallback(async (rerunTaskId?: string) => {
    const coordinator = runCoordinatorRef.current!;
    if (coordinator.isActive()) return;
    if (!settings.hasApiKey) {
      setView("settings");
      return;
    }
    if (!image?.modelDataUrl) {
      showNotice("请重新选择图片后再生成", "error");
      return;
    }
    coordinator.begin();
    coordinator.beginWorker();
    preserveResultDuringAnalysisRef.current = Boolean(rerunTaskId);
    setAnalysisLocked(true);
    setCommandOpen(false);
    setHistoryDrawerOpen(false);
    setRerunningTaskId(rerunTaskId);
    const previousResult = rerunTaskId ? result : null;
    const previousIsFinal = rerunTaskId ? isFinalResult : false;
    let requestImage = image;
    try {
      setGenerationState("connecting");
      setInteractionId(undefined);
      setElapsedMs(0);
      setFirstTokenMs(undefined);
      setReceivedCharacters(0);
      receivedCharactersRef.current = 0;
      firstTokenRecordedRef.current = false;
      streamPrinterRef.current?.reset();
      requestStartedAtRef.current = Date.now();
      if (isDesktopApp() && !activeTaskId && requestImage.originalFile && !requestImage.originalStage) {
        try {
          const originalStage = await stageOriginalImage(requestImage.originalFile);
          requestImage = { ...requestImage, originalStage, captureMetadata: originalStage.captureMetadata ?? requestImage.captureMetadata };
          setImage(requestImage);
          setOriginalStageError(undefined);
        } catch (error) {
          setOriginalStageError(getErrorMessage(error));
        }
      }
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "生成已停止" };
      if (!rerunTaskId) {
        setResult(null);
        setIsFinalResult(false);
      }
      setGenerationError(undefined);
      setHistorySaveError(undefined);
      setPendingHistoryItem(undefined);
      setPendingOriginalCommit(undefined);
      if (activeTaskId && !rerunTaskId) {
        await updateProjectTaskStatus([activeTaskId], "queued");
        await updateProjectTaskStatus([activeTaskId], "preparing");
        if (coordinator.shouldStop()) throw { code: "cancelled", message: "生成已停止" };
        await updateProjectTaskStatus([activeTaskId], "running");
      }
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "生成已停止" };
      const next = await runReversePrompt({
        imageDataUrl: requestImage.modelDataUrl,
        requirements,
        outputLanguage,
        detailLevel,
      }, handleStreamEvent);
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "生成已停止" };
      await streamPrinterRef.current?.finish();
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "生成已停止" };
      setResult(next);
      setIsFinalResult(true);
      setGenerationState("complete");
      setElapsedMs(next.metadata.elapsedMs);
      if (activeTaskId) {
        if (rerunTaskId) await updateProjectTaskResult(rerunTaskId, next);
        else await completeProjectTask(activeTaskId, next);
        setActiveTaskSnapshot((current) => current?.id === activeTaskId ? { ...current, status: "completed", result: next } : current);
        if (activeProjectId) await Promise.all([reloadProjectTasks(activeProjectId), reloadProjects(activeProjectId)]);
        showNotice(rerunTaskId ? "重新分析完成，原任务已更新" : "任务已完成并保存到项目");
        return;
      }
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
      if (coordinator.shouldStop() || getErrorCode(error) === "cancelled") {
        streamPrinterRef.current?.flush();
        if (rerunTaskId) {
          setResult(previousResult);
          setIsFinalResult(previousIsFinal);
        } else if (activeTaskId) {
          await updateProjectTaskStatus([activeTaskId], "paused").catch(() => undefined);
        }
      } else {
        streamPrinterRef.current?.flush();
        setGenerationState("idle");
        const failure = getCommandFailure(error);
        setGenerationError(failure);
        if (rerunTaskId) {
          setResult(previousResult);
          setIsFinalResult(previousIsFinal);
        } else if (activeTaskId) {
          await failProjectTask(activeTaskId, failure.code, failure.message).catch(() => undefined);
        }
        showNotice(failure.message, "error");
      }
    } finally {
      const stopped = coordinator.shouldStop();
      coordinator.endWorker();
      await coordinator.waitForSettled();
      coordinator.finish();
      preserveResultDuringAnalysisRef.current = false;
      setInteractionId(undefined);
      setRerunningTaskId(undefined);
      setAnalysisLocked(false);
      if (stopped) {
        setGenerationState("cancelled");
        showNotice("已停止生成");
        window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="设置"]:not(:disabled)')?.focus(), 0);
      }
    }
  }, [activeProjectId, activeTaskId, detailLevel, handleStreamEvent, image, isFinalResult, outputLanguage, reloadProjectTasks, reloadProjects, requirements, result, settings.autoSaveHistory, settings.hasApiKey, showNotice, updateHistory]);

  const handleGenerate = useCallback(() => runCurrentAnalysis(), [runCurrentAnalysis]);

  const handleStop = useCallback(async () => {
    const coordinator = runCoordinatorRef.current!;
    if (!analysisLocked || !coordinator.requestStop()) return;
    setGenerationState("stopping");
  }, [analysisLocked]);

  const loadAllProjectTasks = useCallback(async (projectId: string, filter: TaskFilter = "all") => {
    const items: ProjectTask[] = [];
    for (let offset = 0; ; offset += 50) {
      const page = await listProjectTasks(projectId, filter, "", offset, 50);
      items.push(...page.items);
      if (items.length >= page.total) break;
    }
    return items;
  }, []);

  const processQueueTask = useCallback(async (taskItem: ProjectTask, forceSelected = false) => {
    const coordinator = runCoordinatorRef.current!;
    coordinator.beginWorker();
    let interaction: string | undefined;
    let prepared: PreparedImage | undefined;
    let previewTransferred = false;
    try {
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      await updateProjectTaskStatus([taskItem.id], "queued");
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      await updateProjectTaskStatus([taskItem.id], "preparing");
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      if (!taskItem.originalImage) throw { code: "original_missing", message: "原图不可用，无法继续反推" };
      const bytes = await loadWorkspaceOriginalImage(taskItem.id);
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([buffer], taskItem.originalImage.fileName, { type: taskItem.originalImage.mimeType });
      prepared = await prepareImage(file, taskItem.imageInfo ? { width: taskItem.imageInfo.width, height: taskItem.imageInfo.height } : undefined);
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      await updateProjectTaskStatus([taskItem.id], "running");
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      const isSelected = forceSelected || taskItem.id === activeTaskId;
      if (isSelected) {
        setImage({ ...prepared, captureMetadata: taskItem.captureMetadata });
        previewTransferred = true;
        setDisplayImage(prepared.previewUrl);
        setDisplayImageInfo(toImageInfo(prepared));
        setResult(null);
        setIsFinalResult(false);
        setGenerationState("connecting");
        streamPrinterRef.current?.reset();
        receivedCharactersRef.current = 0;
        setReceivedCharacters(0);
        firstTokenRecordedRef.current = false;
        requestStartedAtRef.current = Date.now();
      }
      const preset = taskItem.presetSnapshot ?? { requirements: "", outputLanguage: "chinese" as const, detailLevel: "expert" as const, autoOptimizeRequirements: "" };
      let next = await runReversePrompt({ imageDataUrl: prepared.modelDataUrl, requirements: preset.requirements, outputLanguage: preset.outputLanguage, detailLevel: preset.detailLevel }, (event) => {
        if (event.type === "started") { interaction = event.interactionId; coordinator.registerInteraction(interaction); }
        if (isSelected) handleStreamEvent(event);
      });
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      if (isSelected) await streamPrinterRef.current?.finish();
      coordinator.unregisterInteraction(interaction);
      interaction = undefined;
      if (preset.autoOptimizeTarget) {
        if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
        const optimized = await runPromptOptimization({ analysis: next.analysis, sourcePrompts: next.prompts, target: preset.autoOptimizeTarget, requirements: preset.autoOptimizeRequirements, aspectRatio: taskItem.imageInfo ? simplifyAspectRatio(taskItem.imageInfo.width, taskItem.imageInfo.height) : undefined }, (event) => {
          if (event.type === "started") { interaction = event.interactionId; coordinator.registerInteraction(interaction); }
        });
        if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
        coordinator.unregisterInteraction(interaction);
        interaction = undefined;
        const versionId = crypto.randomUUID();
        next = { ...next, promptVersions: [...(next.promptVersions ?? []), { id: versionId, target: preset.autoOptimizeTarget, origin: "optimization", requirements: preset.autoOptimizeRequirements, prompts: optimized.prompts, negativePrompts: optimized.negativePrompts, metadata: optimized.metadata }], activePromptVersionId: versionId };
      }
      if (coordinator.shouldStop()) throw { code: "cancelled", message: "队列已停止" };
      await completeProjectTask(taskItem.id, next);
      if (isSelected) {
        setResult(next);
        setIsFinalResult(true);
        setGenerationState("complete");
        setElapsedMs(next.metadata.elapsedMs);
        setActiveTaskSnapshot((current) => current?.id === taskItem.id ? { ...current, status: "completed", result: next } : current);
      }
    } catch (error) {
      coordinator.unregisterInteraction(interaction);
      const failure = getCommandFailure(error);
      if (coordinator.shouldStop() || failure.code === "cancelled") await updateProjectTaskStatus([taskItem.id], "paused");
      else await failProjectTask(taskItem.id, failure.code, failure.message);
      if (taskItem.id === activeTaskId) {
        streamPrinterRef.current?.flush();
        if (!coordinator.shouldStop() && failure.code !== "cancelled") {
          setGenerationState("idle");
          setGenerationError(failure);
        }
      }
    } finally {
      if (!previewTransferred) revokePreparedImagePreview(prepared);
      coordinator.endWorker();
    }
  }, [activeTaskId, handleStreamEvent]);

  const handleRegenerate = useCallback(async () => {
    if (resultOperationBusy) return;
    await runCurrentAnalysis(activeTaskId && activeTaskSnapshot?.id === activeTaskId && activeTaskSnapshot.status === "completed" ? activeTaskId : undefined);
  }, [activeTaskId, activeTaskSnapshot, resultOperationBusy, runCurrentAnalysis]);

  const startQueue = useCallback(async () => {
    const coordinator = runCoordinatorRef.current!;
    if (!activeProjectId || queueRunning || coordinator.isActive()) return;
    if (!settings.hasApiKey) { setView("settings"); return; }
    const all = await loadAllProjectTasks(activeProjectId);
    const pending = all.filter((task) => ["ready", "queued", "paused"].includes(task.status));
    if (!pending.length) { showNotice("当前项目没有待处理任务", "error"); return; }
    coordinator.begin();
    setAnalysisLocked(true);
    setCommandOpen(false);
    setHistoryDrawerOpen(false);
    setQueueRunning(true);
    setGenerationState("connecting");
    try {
      await updateProjectTaskStatus(pending.map((task) => task.id), "queued");
      const started = await runTaskQueue(pending, settings.batchConcurrency, () => !coordinator.shouldStop(), async (task) => {
        await processQueueTask(task);
        if (activeProjectId) {
          const progress = await getBatchProgress(activeProjectId);
          setBatchProgress(progress);
        }
      });
      await coordinator.waitForSettled();
      const remaining = pending.slice(started).map((task) => task.id);
      if (remaining.length) await updateProjectTaskStatus(remaining, "paused");
      if (coordinator.shouldStop()) {
        const latest = await loadAllProjectTasks(activeProjectId);
        const unfinished = latest.filter((task) => ["queued", "preparing", "running"].includes(task.status)).map((task) => task.id);
        if (unfinished.length) await updateProjectTaskStatus(unfinished, "paused");
        setGenerationState("cancelled");
        showNotice("队列已停止");
      } else {
        setGenerationState("complete");
        showNotice("队列处理完成");
      }
      await Promise.all([reloadProjectTasks(activeProjectId), reloadProjects(activeProjectId)]);
    } catch (error) {
      const failure = getCommandFailure(error);
      setGenerationState("idle");
      setGenerationError(failure);
      showNotice(failure.message, "error");
    } finally {
      const stopped = coordinator.shouldStop();
      await coordinator.waitForSettled();
      coordinator.finish();
      setQueueRunning(false);
      setAnalysisLocked(false);
      setInteractionId(undefined);
      if (stopped) {
        window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="设置"]:not(:disabled)')?.focus(), 0);
      }
    }
  }, [activeProjectId, loadAllProjectTasks, processQueueTask, queueRunning, reloadProjectTasks, reloadProjects, settings.batchConcurrency, settings.hasApiKey, showNotice]);

  const retryFailedQueue = useCallback(async () => {
    if (!activeProjectId) return;
    const failed = await loadAllProjectTasks(activeProjectId, "failed");
    if (failed.length) await updateProjectTaskStatus(failed.map((task) => task.id), "ready");
    await reloadProjectTasks(activeProjectId);
  }, [activeProjectId, loadAllProjectTasks, reloadProjectTasks]);

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

  const selectProjectTask = async (taskItem: ProjectTask) => {
    const selectionTask = ++imageTaskRef.current;
    if (image?.originalStage) void discardOriginalStage(image.originalStage.stagingId);
    let latest: ProjectTask;
    try {
      latest = await getProjectTask(taskItem.id);
    } catch (error) {
      showNotice(`任务详情加载失败：${getErrorMessage(error)}`, "error");
      return;
    }
    setSettings((current) => ({ ...current, lastProjectId: latest.projectId, lastTaskId: latest.id }));
    setActiveTaskId(latest.id);
    setActiveTaskSnapshot(latest);
    setActiveHistoryId(undefined);
    setResult(latest.result ?? null);
    setIsFinalResult(Boolean(latest.result));
    setGenerationState(latest.status === "completed" ? "complete" : "idle");
    setDisplayImage(latest.thumbnail);
    setDisplayImageInfo(latest.imageInfo ?? null);
    setImage(null);
    setRequirements(latest.presetSnapshot?.requirements ?? "");
    setOutputLanguage(latest.presetSnapshot?.outputLanguage ?? settings.workspace.outputLanguage);
    setDetailLevel(latest.presetSnapshot?.detailLevel ?? settings.workspace.detailLevel);
    setGenerationError(latest.errorCode ? { code: latest.errorCode, message: latest.errorMessage ?? "任务处理失败" } : undefined);
    setOriginalLoadFailure(undefined);
    setOriginalStageError(undefined);
    setHistorySaveError(undefined);
    setZoom(100);
    setElapsedMs(latest.result?.metadata.elapsedMs ?? 0);
    setHistoryDrawerOpen(false);
    void saveWorkspaceSession(latest.projectId, latest.id).catch(() => undefined);
    if (!latest.originalImage || !isDesktopApp()) return;
    setOriginalLoading(true);
    try {
      const bytes = await loadWorkspaceOriginalImage(latest.id);
      if (selectionTask !== imageTaskRef.current) return;
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const file = new File([buffer], latest.originalImage.fileName, { type: latest.originalImage.mimeType });
      const prepared = await prepareImage(file, latest.imageInfo ? { width: latest.imageInfo.width, height: latest.imageInfo.height } : undefined);
      if (selectionTask !== imageTaskRef.current) { if (prepared.previewUrl.startsWith("blob:")) URL.revokeObjectURL(prepared.previewUrl); return; }
      setImage({ ...prepared, captureMetadata: latest.captureMetadata });
      setDisplayImage(prepared.previewUrl);
      setDisplayImageInfo(toImageInfo(prepared));
    } catch (error) {
      if (selectionTask === imageTaskRef.current) setOriginalLoadFailure(getCommandFailure(error));
    } finally {
      if (selectionTask === imageTaskRef.current) setOriginalLoading(false);
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
        ?? projectTasks.find((item) => item.id === activeTaskId)?.captureMetadata
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
    if (activeTaskId) {
      await updateProjectTaskResult(activeTaskId, next);
      if (activeProjectId) await reloadProjectTasks(activeProjectId);
    } else if (activeHistoryId) {
      await updateHistory((current) => current.map((item) => item.id === activeHistoryId ? { ...item, result: next } : item));
    }
    setResult(next);
    setPendingHistoryItem((current) => current ? { ...current, result: next } : current);
  }, [activeHistoryId, activeProjectId, activeTaskId, reloadProjectTasks, updateHistory]);

  const handleExportOriginal = useCallback(async (historyId = activeHistoryId) => {
    const id = activeTaskId ?? historyId;
    if (!id) return;
    try {
      if (await (activeTaskId ? exportWorkspaceOriginalImage(id) : exportOriginalImage(id))) showNotice("原图已导出");
    } catch (error) {
      showNotice(getErrorMessage(error), "error");
    }
  }, [activeHistoryId, activeTaskId, showNotice]);

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

  useEffect(() => () => streamPrinterRef.current?.reset(), []);

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

  const handleProjectChange = useCallback((projectId: string) => {
    setSettings((current) => ({ ...current, lastProjectId: projectId, lastTaskId: undefined }));
    setActiveProjectId(projectId);
    setActiveTaskId(undefined);
    setActiveTaskSnapshot(undefined);
    setSelectedTaskIds([]);
    setResult(null);
    setImage(null);
    setDisplayImage(undefined);
    setDisplayImageInfo(null);
  }, []);

  const handleCreateProject = useCallback(async (title: string) => {
    const project = await createProject(title);
    await reloadProjects(project.id);
    setActiveProjectId(project.id);
    showNotice("项目已创建");
  }, [reloadProjects, showNotice]);

  const handleRenameProject = useCallback(async (id: string, title: string) => {
    await renameProject(id, title); await reloadProjects(id); showNotice("项目名称已更新");
  }, [reloadProjects, showNotice]);

  const handleDeleteProject = useCallback(async (id: string) => {
    await deleteProject(id); await Promise.all([reloadProjects(), reloadTrash()]); showNotice("项目已移入废纸篓");
  }, [reloadProjects, reloadTrash, showNotice]);

  const handleFavoriteTask = useCallback(async (task: ProjectTask) => {
    await setProjectTaskFavorite(task.id, !task.favorite); if (activeProjectId) await reloadProjectTasks(activeProjectId);
  }, [activeProjectId, reloadProjectTasks]);

  const handleTaskTags = useCallback(async (task: ProjectTask, tags: string[]) => {
    await setProjectTaskTags(task.id, tags); if (activeProjectId) await reloadProjectTasks(activeProjectId); showNotice("标签已更新");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleRenameTask = useCallback(async (task: ProjectTask, title: string) => {
    await renameProjectTask(task.id, title);
    if (activeProjectId) await reloadProjectTasks(activeProjectId);
    showNotice("任务名称已更新");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleRetryTask = useCallback(async (task: ProjectTask) => {
    await updateProjectTaskStatus([task.id], "ready");
    if (activeProjectId) await reloadProjectTasks(activeProjectId);
    showNotice("任务已重新加入待处理队列");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleBatchFavorite = useCallback(async (ids: string[], favorite: boolean) => {
    await setProjectTasksFavorite(ids, favorite);
    if (activeProjectId) await reloadProjectTasks(activeProjectId);
    showNotice(favorite ? "已批量收藏" : "已取消批量收藏");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleBatchTags = useCallback(async (ids: string[], tags: string[], remove: boolean) => {
    await updateProjectTasksTags(ids, tags, remove);
    if (activeProjectId) await reloadProjectTasks(activeProjectId);
    showNotice(remove ? "已批量移除标签" : "已批量添加标签");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleDuplicateTask = useCallback(async (task: ProjectTask) => {
    const duplicate = await duplicateProjectTask(task.id); if (activeProjectId) await reloadProjectTasks(activeProjectId); await selectProjectTask(duplicate); showNotice("已创建关联任务副本");
  }, [activeProjectId, reloadProjectTasks, showNotice]);

  const handleDeleteTasks = useCallback(async (ids: string[]) => {
    await deleteProjectTasks(ids); setSelectedTaskIds([]); if (ids.includes(activeTaskId ?? "")) { setActiveTaskId(undefined); setActiveTaskSnapshot(undefined); } if (activeProjectId) await reloadProjectTasks(activeProjectId); await reloadTrash(); showNotice("任务已移入废纸篓");
  }, [activeProjectId, activeTaskId, reloadProjectTasks, reloadTrash, showNotice]);

  const handleBatchExport = useCallback((ids: string[]) => {
    const options = { markdown: true, json: true, text: false, includeOriginals: false };
    Modal.confirm({
      title: `导出 ${ids.length} 个任务`,
      content: <div className="batch-export-options"><Checkbox defaultChecked onChange={(value) => { options.markdown = value; }}>Markdown</Checkbox><Checkbox defaultChecked onChange={(value) => { options.json = value; }}>结构化 JSON</Checkbox><Checkbox onChange={(value) => { options.text = value; }}>纯提示词</Checkbox><Checkbox onChange={(value) => { options.includeOriginals = value; }}>包含解密后的原图</Checkbox><Alert type="warning" content="包含原图时，ZIP 中的图片将以未加密形式写出。" /></div>,
      okText: "选择保存位置",
      onOk: async () => { if (await exportProjectTasks({ taskIds: ids, ...options })) showNotice("批量导出完成"); },
    });
  }, [showNotice]);

  const handlePresetChange = useCallback((id: string) => {
    setActivePresetId(id);
    const snapshot = presets.find((preset) => preset.id === id)?.snapshot;
    if (snapshot) { setRequirements(snapshot.requirements); setOutputLanguage(snapshot.outputLanguage); setDetailLevel(snapshot.detailLevel); }
  }, [presets]);
  const handleSavePreset = useCallback(async (title: string, snapshot: ReversePreset["snapshot"], id?: string) => {
    const saved = await saveReversePreset(title, snapshot, id);
    const next = await listReversePresets(); setPresets(next); setActivePresetId(saved.id); showNotice("预设已保存");
  }, [showNotice]);
  const handleDeletePreset = useCallback(async (id: string) => {
    await deleteReversePreset(id); const next = await listReversePresets(); setPresets(next); setActivePresetId(next[0]?.id); showNotice("预设已删除");
  }, [showNotice]);

  useEffect(() => {
    const handleCommandKey = (event: KeyboardEvent) => {
      if (analysisLocked) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); }
    };
    window.addEventListener("keydown", handleCommandKey);
    return () => window.removeEventListener("keydown", handleCommandKey);
  }, [analysisLocked]);

  useWorkspaceShortcuts({ view, loading: analysisLocked, blocked: resultOperationBusy, onGenerate: handleRegenerate, onStop: handleStop });
  useClipboardImage({
    view,
    loading,
    result,
    activeHistoryId,
    onImageFile: handleImageFile,
    onRejected: showPasteRejected,
  });

  const projectSidebar = (
    <ProjectTaskSidebar
      projects={projects}
      activeProjectId={activeProjectId}
      tasks={projectTasks}
      total={projectTaskTotal}
      activeTaskId={activeTaskId}
      selectedTaskIds={selectedTaskIds}
      query={taskQuery}
      filter={taskFilter}
      presets={presets}
      activePresetId={activePresetId}
      progress={batchProgress}
      queueRunning={queueRunning}
      analysisLocked={analysisLocked}
      rerunningTaskId={rerunningTaskId}
      importing={batchImporting}
      importLabel={batchImportLabel}
      trash={trash}
      onProjectChange={handleProjectChange}
      onCreateProject={handleCreateProject}
      onRenameProject={handleRenameProject}
      onDeleteProject={handleDeleteProject}
      onQueryChange={setTaskQuery}
      onFilterChange={setTaskFilter}
      onPresetChange={handlePresetChange}
      onSavePreset={handleSavePreset}
      onDeletePreset={handleDeletePreset}
      onImport={(files) => void handleBatchImport(files)}
      onCancelImport={() => { batchImportCancelRef.current = true; setBatchImportLabel("正在取消导入"); }}
      onSelectTask={(task) => void selectProjectTask(task)}
      onSelectionChange={setSelectedTaskIds}
      onFavorite={(task) => void handleFavoriteTask(task)}
      onTags={handleTaskTags}
      onRenameTask={handleRenameTask}
      onRetryTask={handleRetryTask}
      onBatchFavorite={handleBatchFavorite}
      onBatchTags={handleBatchTags}
      onDuplicate={(task) => void handleDuplicateTask(task)}
      onDeleteTasks={(ids) => void handleDeleteTasks(ids)}
      onReorder={(ids) => void reorderProjectTasks(ids).then(() => activeProjectId ? reloadProjectTasks(activeProjectId) : undefined)}
      onMove={(ids, projectId) => void moveProjectTasks(ids, projectId).then(() => activeProjectId ? Promise.all([reloadProjectTasks(activeProjectId), reloadProjects(activeProjectId)]) : undefined)}
      onStartQueue={() => void startQueue()}
      onRetryFailed={() => void retryFailedQueue()}
      onLoadMore={() => activeProjectId && void reloadProjectTasks(activeProjectId, false)}
      onExport={handleBatchExport}
      onRestoreTrash={(entry) => void restoreTrashEntry(entry.id, entry.kind).then(() => Promise.all([reloadProjects(), reloadProjectTasks(activeProjectId ?? ""), reloadTrash()]))}
      onDeleteTrash={(entry) => void permanentlyDeleteTrashEntry(entry.id, entry.kind).then(() => reloadTrash())}
      onEmptyTrash={() => void emptyTrash().then(() => Promise.all([reloadTrash(), reloadProjects()]))}
    />
  );
  const legacySidebar = (
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
  const sidebar = workspaceUi ? projectSidebar : (
    <div className="legacy-sidebar-lock" inert={analysisLocked ? true : undefined}>{legacySidebar}</div>
  );

  return (
    <div className="app-shell">
      {messageContext}
      <Toolbar
        sidebarCollapsed={sidebarCollapsed}
        compactHistory={compactHistory}
        view={view}
        generationState={generationState}
        disabled={analysisLocked}
        elapsedMs={elapsedMs}
        projectTitle={projects.find((item) => item.id === activeProjectId)?.title}
        taskTitle={activeTaskId && activeTaskSnapshot?.id === activeTaskId ? activeTaskSnapshot.title : projectTasks.find((item) => item.id === activeTaskId)?.title}
        onToggleSidebar={() => compactHistory ? setHistoryDrawerOpen(true) : setSidebarCollapsed((value) => !value)}
        onNavigate={navigate}
        onStop={() => void handleStop()}
      />

      {settingsLoadError || historyLoadError || historySaveError || originalStageError || originalLoadFailure ? (
        <div className="notice-stack" role="region" aria-label="应用通知" inert={analysisLocked ? true : undefined}>
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
          onSaved={(saved) => { setSettings(saved); setSettingsDirty(false); }}
          onThemeChange={handleThemeChange}
          onDirtyChange={setSettingsDirty}
          onOriginalsCleared={reloadHistory}
        />
      ) : view === "logs" ? (
        <LogsView requestFilter={logsRequestFilter} />
      ) : (
        <>
        <WorkspaceLayout
          sidebar={sidebar}
          sidebarVisible={!compactHistory && !sidebarCollapsed}
          sidebarWidth={settings.workspace.projectSidebarWidth}
          inputSplitPercent={settings.workspace.inputSplitPercent}
          onSidebarWidthChange={(value) => updateWorkspacePreferences({ projectSidebarWidth: value })}
          onInputSplitChange={(value) => updateWorkspacePreferences({ inputSplitPercent: value })}
          locked={analysisLocked}
          overview={workspaceUi && !activeTaskId && !displayImage ? (
            <div className="project-overview-lock" inert={analysisLocked ? true : undefined}>
              <ProjectOverview project={projects.find((item) => item.id === activeProjectId)} tasks={projectTasks} progress={batchProgress} onImport={() => document.querySelector<HTMLInputElement>('.project-import input')?.click()} onImportFiles={handleBatchImport} onStart={() => void startQueue()} onSelect={(task) => void selectProjectTask(task)} />
            </div>
          ) : undefined}
          input={workspaceUi && !activeTaskId && !displayImage ? undefined : (
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
              hasUnsavedResult={Boolean(result && !activeHistoryId && !activeTaskId)}
              onImageFile={handleImageFile}
              onImageFiles={handleBatchImport}
              onRequirementsChange={setRequirements}
              onOutputLanguageChange={(value) => { setOutputLanguage(value); updateWorkspacePreferences({ outputLanguage: value }); }}
              onDetailLevelChange={(value) => { setDetailLevel(value); updateWorkspacePreferences({ detailLevel: value }); }}
              onZoomChange={setZoom}
              onFitModeChange={(value: FitMode) => { setFitMode(value); updateWorkspacePreferences({ fitMode: value }); }}
              onGenerate={handleRegenerate}
              generateLabel={activeTaskId && activeTaskSnapshot?.id === activeTaskId && activeTaskSnapshot.status === "completed" ? "重新分析" : "开始反推"}
              onConfigure={() => navigate("settings")}
              originalStatus={originalLoading ? "loading" : originalLoadFailure ? "error"
                : activeTaskId && projectTasks.find((item) => item.id === activeTaskId)?.originalImage ? "retained"
                : activeHistoryId && history.find((item) => item.id === activeHistoryId)?.originalImage ? "retained"
                  : image?.originalStage ? "staged" : "thumbnail"}
              onExportOriginal={(activeTaskId && projectTasks.find((item) => item.id === activeTaskId)?.originalImage)
                || (activeHistoryId && history.find((item) => item.id === activeHistoryId)?.originalImage)
                ? () => void handleExportOriginal()
                : undefined}
              onRemoveImage={handleRemoveCurrentImage}
            />
          )}
          result={workspaceUi && !activeTaskId && !displayImage ? undefined : (
            <ResultsWorkspace
              result={result}
              error={generationError}
              generationState={generationState}
              analysisLocked={analysisLocked}
              isFinal={isFinalResult}
              canRegenerate={Boolean(image?.modelDataUrl)}
              aspectRatio={displayImageInfo ? simplifyAspectRatio(displayImageInfo.width, displayImageInfo.height) : undefined}
              onCopy={copyPrompt}
              onCopyFull={(currentResult) => void copyPrompt(toMarkdown(currentResult, image?.captureMetadata
                ?? projectTasks.find((item) => item.id === activeTaskId)?.captureMetadata
                ?? history.find((item) => item.id === activeHistoryId)?.captureMetadata), "完整结果已复制")}
              onRegenerate={handleRegenerate}
              onExport={exportPrompt}
              captureMetadata={image?.captureMetadata ?? projectTasks.find((item) => item.id === activeTaskId)?.captureMetadata ?? history.find((item) => item.id === activeHistoryId)?.captureMetadata}
              imageDataUrl={image?.modelDataUrl}
              hasApiKey={settings.hasApiKey}
              onResultChange={updatePromptResult}
              onRetry={handleGenerate}
              onOpenSettings={() => navigate("settings")}
              onOpenLogs={openAssociatedLogs}
              onExportDiagnostic={handleExportDiagnostic}
              canSaveHistory={Boolean(pendingHistoryItem)}
              onSaveHistory={() => void savePendingHistory()}
              initialSplitPercent={settings.workspace.resultSplitPercent}
              onSplitChange={(value) => updateWorkspacePreferences({ resultSplitPercent: value })}
              previewInteraction={previewInteraction}
              onBusyChange={handleResultBusyChange}
            />
          )}
        />
        <Drawer className="history-drawer" width={320} title="项目与任务" placement="left" visible={historyDrawerOpen} onCancel={() => setHistoryDrawerOpen(false)} footer={null} unmountOnExit>
          {sidebar}
        </Drawer>
        </>
      )}
      </Suspense>

      {view === "workspace" ? (
        <footer className="statusbar">
          {settings.hasApiKey ? <span><IconExperiment />模型：<strong>{result?.metadata.model || settings.model}</strong></span> : null}
          {firstTokenMs ? <span><IconClockCircle />首字：<strong>{firstTokenMs} 毫秒</strong></span> : null}
          {isFinalResult && result?.metadata.totalTokens ? <span><IconStorage />令牌数：<strong>{result.metadata.totalTokens.toLocaleString()}</strong></span> : null}
          {elapsedMs > 0 ? <span><IconClockCircle />耗时：<strong>{statusTime}</strong></span> : null}
          {generationState !== "idle" ? (
            <span className={`status-saved ${generationStateClass(generationState)}`}>
              {generationState === "complete" ? <IconCheckCircle /> : <IconClockCircle />}
              {generationStateLabel(generationState)}
            </span>
          ) : null}
          {batchProgress.total ? <span className="queue-status">队列：<strong>{batchProgress.completed}/{batchProgress.total}</strong></span> : null}
        </footer>
      ) : null}
      <Modal title="快捷命令" visible={commandOpen && !analysisLocked} footer={null} onCancel={() => setCommandOpen(false)} className="command-palette" unmountOnExit>
        <div className="command-list">
          <Button long type="text" onClick={() => { setCommandOpen(false); document.querySelector<HTMLInputElement>('.project-import input')?.click(); }}>导入图片 <kbd>⌘I</kbd></Button>
          <Button long type="text" onClick={() => { setCommandOpen(false); void startQueue(); }}>开始或继续队列</Button>
          {projects.map((project) => <Button key={project.id} long type="text" onClick={() => { handleProjectChange(project.id); setCommandOpen(false); }}>切换到“{project.title}”</Button>)}
          <Button long type="text" onClick={() => { setCommandOpen(false); navigate("settings"); }}>打开设置</Button>
          <Button long type="text" onClick={() => { setCommandOpen(false); navigate("logs"); }}>打开运行日志</Button>
        </div>
      </Modal>
    </div>
  );
}
