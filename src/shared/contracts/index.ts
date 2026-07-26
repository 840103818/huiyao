export type ThemeMode = "system" | "light" | "dark";
export type OutputLanguage = "chinese" | "english" | "bilingual";
export type DetailLevel = "concise" | "standard" | "detailed" | "expert";
export type FitMode = "contain" | "cover";
export type GenerationState = "idle" | "connecting" | "streaming" | "fallback" | "stopping" | "cancelled" | "complete";

export interface PublicSettings {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  theme: ThemeMode;
  hasApiKey: boolean;
  autoSaveHistory: boolean;
  insecureHttpOrigin?: string;
  workspace: WorkspacePreferences;
}

export interface WorkspacePreferences {
  outputLanguage: OutputLanguage;
  detailLevel: DetailLevel;
  fitMode: FitMode;
  resultSplitPercent?: number;
}

export interface SettingsInput {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  theme: ThemeMode;
  autoSaveHistory: boolean;
  insecureHttpOrigin?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface Analysis {
  subject: string;
  scene: string;
  composition: string;
  lighting: string;
  tonality: string;
  colors: string;
  palette: string[];
  materials: string;
  style: string;
  camera: string;
  postProcessing: string;
}

export interface Prompts {
  zh: string;
  en: string;
}

export interface ResultMetadata {
  model: string;
  elapsedMs: number;
  totalTokens?: number;
  createdAt: string;
  providerRequestId?: string;
}

export interface ReverseResult {
  analysis: Analysis;
  prompts: Prompts;
  metadata: ResultMetadata;
  promptVersions?: PromptVersion[];
  activePromptVersionId?: string;
}

export type PromptOptimizationTarget = "general" | "midjourney" | "flux" | "sdxl";
export type PromptVersionOrigin = "optimization" | "manual";
export type ResultExportFormat = "markdown" | "json" | "text";

export interface PromptVersion {
  id: string;
  target: PromptOptimizationTarget;
  origin?: PromptVersionOrigin;
  sourceVersionId?: string;
  title?: string;
  requirements: string;
  prompts: Prompts;
  negativePrompts: Prompts;
  metadata: ResultMetadata;
}

export interface PromptOptimizationRequest {
  analysis: Analysis;
  sourcePrompts: Prompts;
  sourceNegativePrompts?: Prompts;
  target: PromptOptimizationTarget;
  requirements: string;
  aspectRatio?: string;
}

export interface PromptOptimizationOutput {
  prompts: Prompts;
  negativePrompts: Prompts;
  metadata: ResultMetadata;
}

export interface ImageInfo {
  name: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
}

export interface ReverseRequest {
  imageDataUrl: string;
  requirements: string;
  outputLanguage: OutputLanguage;
  detailLevel: DetailLevel;
}

export interface HistoryItem {
  id: string;
  title: string;
  inputSummary: string;
  thumbnail?: string;
  imageInfo?: ImageInfo;
  originalImage?: OriginalImageInfo;
  captureMetadata?: CaptureMetadata;
  result: ReverseResult;
  createdAt: string;
}

export interface PreparedImage {
  name: string;
  previewUrl: string;
  modelDataUrl: string;
  thumbnail: string;
  width: number;
  height: number;
  size: number;
  mimeType: string;
  originalFile?: File;
  originalStage?: OriginalImageStage;
  captureMetadata?: CaptureMetadata;
}

export interface CaptureMetadata {
  cameraMake?: string;
  cameraModel?: string;
  lensMake?: string;
  lensModel?: string;
  focalLength?: string;
  focalLength35mm?: string;
  aperture?: string;
  exposureTime?: string;
  iso?: string;
  exposureBias?: string;
  flash?: string;
  whiteBalance?: string;
  capturedAt?: string;
  colorSpace?: string;
}

export interface OriginalImageInfo {
  fileName: string;
  mimeType: string;
  size: number;
  storedAt: string;
  encryptionVersion: number;
}

export interface OriginalImageStage {
  stagingId: string;
  info: OriginalImageInfo;
  captureMetadata?: CaptureMetadata;
  sourceWidth: number;
  sourceHeight: number;
}

export interface OriginalImageCommit {
  historyId: string;
  stagingId: string;
}

export interface OriginalStorageStats {
  count: number;
  totalBytes: number;
}

export interface CommandFailure {
  code: string;
  message: string;
  diagnosticId?: string;
  providerRequestId?: string;
  interactionId?: string;
}

export type ReverseStreamEvent =
  | { type: "started"; interactionId: string }
  | { type: "delta"; content: string }
  | { type: "fallback"; reason: string };

export type RuntimeLogLevel = "info" | "warn" | "error";

export interface RuntimeLogEntry {
  id: string;
  timestamp: string;
  level: RuntimeLogLevel;
  category: string;
  event: string;
  message: string;
  details: Record<string, unknown>;
}
