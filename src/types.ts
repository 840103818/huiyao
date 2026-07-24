export type ThemeMode = "system" | "light" | "dark";
export type OutputLanguage = "chinese" | "english" | "bilingual";
export type DetailLevel = "concise" | "standard" | "detailed" | "expert";
export type GenerationState = "idle" | "connecting" | "streaming" | "fallback" | "stopping" | "cancelled" | "complete";

export interface PublicSettings {
  baseUrl: string;
  model: string;
  timeoutSeconds: number;
  theme: ThemeMode;
  hasApiKey: boolean;
}

export interface SettingsInput extends Omit<PublicSettings, "hasApiKey"> {
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface Analysis {
  subject: string;
  composition: string;
  lighting: string;
  colors: string;
  palette: string[];
  materials: string;
  style: string;
  camera: string;
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
  rawResponse?: string;
  providerRequestId?: string;
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
}

export interface CommandFailure {
  code: string;
  message: string;
  rawResponse?: string;
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
