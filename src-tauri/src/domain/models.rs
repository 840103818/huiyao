use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub theme: ThemeMode,
    #[serde(default = "default_true")]
    pub auto_save_history: bool,
    #[serde(default)]
    pub insecure_http_origin: Option<String>,
    #[serde(default)]
    pub workspace: WorkspacePreferences,
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4.1-mini".into(),
            timeout_seconds: 120,
            theme: ThemeMode::System,
            auto_save_history: true,
            insecure_http_origin: None,
            workspace: WorkspacePreferences::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSettings {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub theme: ThemeMode,
    pub has_api_key: bool,
    pub auto_save_history: bool,
    pub insecure_http_origin: Option<String>,
    pub workspace: WorkspacePreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub theme: ThemeMode,
    #[serde(default = "default_true")]
    pub auto_save_history: bool,
    #[serde(default)]
    pub insecure_http_origin: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

impl SettingsFile {
    pub fn apply_input(&mut self, value: &SettingsInput) {
        self.base_url = value.base_url.trim().trim_end_matches('/').to_owned();
        self.model = value.model.trim().to_owned();
        self.timeout_seconds = value.timeout_seconds.clamp(10, 300);
        self.theme = value.theme;
        self.auto_save_history = value.auto_save_history;
        self.insecure_http_origin = value.insecure_http_origin.clone();
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreferences {
    #[serde(default = "default_output_language")]
    pub output_language: OutputLanguage,
    #[serde(default = "default_detail_level")]
    pub detail_level: DetailLevel,
    #[serde(default = "default_fit_mode")]
    pub fit_mode: FitMode,
    #[serde(default)]
    pub result_split_percent: Option<f64>,
}

impl Default for WorkspacePreferences {
    fn default() -> Self {
        Self {
            output_language: OutputLanguage::Chinese,
            detail_level: DetailLevel::Expert,
            fit_mode: FitMode::Contain,
            result_split_percent: None,
        }
    }
}

impl WorkspacePreferences {
    pub fn normalized(mut self) -> Self {
        self.result_split_percent = self
            .result_split_percent
            .filter(|value| value.is_finite())
            .map(|value| value.clamp(28.0, 66.0));
        self
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FitMode {
    Contain,
    Cover,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseRequest {
    pub image_data_url: String,
    #[serde(default)]
    pub requirements: String,
    pub output_language: OutputLanguage,
    pub detail_level: DetailLevel,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OutputLanguage {
    Chinese,
    English,
    Bilingual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DetailLevel {
    Concise,
    Standard,
    Detailed,
    Expert,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub scene: String,
    #[serde(default)]
    pub composition: String,
    #[serde(default)]
    pub lighting: String,
    #[serde(default)]
    pub tonality: String,
    #[serde(default)]
    pub colors: String,
    #[serde(default)]
    pub palette: Vec<String>,
    #[serde(default)]
    pub materials: String,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub camera: String,
    #[serde(default)]
    pub post_processing: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prompts {
    #[serde(default)]
    pub zh: String,
    #[serde(default)]
    pub en: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultMetadata {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub elapsed_ms: u64,
    #[serde(default)]
    pub total_tokens: Option<u64>,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub provider_request_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReverseResult {
    #[serde(default)]
    pub analysis: Analysis,
    #[serde(default)]
    pub prompts: Prompts,
    #[serde(default)]
    pub metadata: ResultMetadata,
    #[serde(default)]
    pub prompt_versions: Vec<PromptVersion>,
    #[serde(default)]
    pub active_prompt_version_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptOptimizationTarget {
    General,
    Midjourney,
    Flux,
    Sdxl,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptOptimizationOutput {
    #[serde(default)]
    pub prompts: Prompts,
    #[serde(default)]
    pub negative_prompts: Prompts,
    #[serde(default)]
    pub metadata: ResultMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptVersion {
    pub id: String,
    pub target: PromptOptimizationTarget,
    #[serde(default)]
    pub origin: PromptVersionOrigin,
    #[serde(default)]
    pub source_version_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub requirements: String,
    #[serde(default)]
    pub prompts: Prompts,
    #[serde(default)]
    pub negative_prompts: Prompts,
    #[serde(default)]
    pub metadata: ResultMetadata,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptVersionOrigin {
    #[default]
    Optimization,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptOptimizationRequest {
    pub analysis: Analysis,
    pub source_prompts: Prompts,
    #[serde(default)]
    pub source_negative_prompts: Option<Prompts>,
    pub target: PromptOptimizationTarget,
    #[serde(default)]
    pub requirements: String,
    #[serde(default)]
    pub aspect_ratio: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryItem {
    pub id: String,
    pub title: String,
    pub input_summary: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub image_info: Option<ImageInfo>,
    #[serde(default)]
    pub original_image: Option<OriginalImageInfo>,
    #[serde(default)]
    pub capture_metadata: Option<CaptureMetadata>,
    pub result: ReverseResult,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    #[serde(default)]
    pub camera_make: Option<String>,
    #[serde(default)]
    pub camera_model: Option<String>,
    #[serde(default)]
    pub lens_make: Option<String>,
    #[serde(default)]
    pub lens_model: Option<String>,
    #[serde(default)]
    pub focal_length: Option<String>,
    #[serde(default)]
    pub focal_length_35mm: Option<String>,
    #[serde(default)]
    pub aperture: Option<String>,
    #[serde(default)]
    pub exposure_time: Option<String>,
    #[serde(default)]
    pub iso: Option<String>,
    #[serde(default)]
    pub exposure_bias: Option<String>,
    #[serde(default)]
    pub flash: Option<String>,
    #[serde(default)]
    pub white_balance: Option<String>,
    #[serde(default)]
    pub captured_at: Option<String>,
    #[serde(default)]
    pub color_space: Option<String>,
}

impl CaptureMetadata {
    pub fn is_empty(&self) -> bool {
        self.camera_make.is_none()
            && self.camera_model.is_none()
            && self.lens_make.is_none()
            && self.lens_model.is_none()
            && self.focal_length.is_none()
            && self.focal_length_35mm.is_none()
            && self.aperture.is_none()
            && self.exposure_time.is_none()
            && self.iso.is_none()
            && self.exposure_bias.is_none()
            && self.flash.is_none()
            && self.white_balance.is_none()
            && self.captured_at.is_none()
            && self.color_space.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalImageInfo {
    pub file_name: String,
    pub mime_type: String,
    pub size: u64,
    pub stored_at: String,
    pub encryption_version: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalImageStage {
    pub staging_id: String,
    pub info: OriginalImageInfo,
    #[serde(default)]
    pub capture_metadata: Option<CaptureMetadata>,
    pub source_width: u32,
    pub source_height: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ResultExportFormat {
    #[default]
    Markdown,
    Json,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalImageCommit {
    pub history_id: String,
    pub staging_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalStorageStats {
    pub count: usize,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReverseStreamEvent {
    Started { interaction_id: String },
    Delta { content: String },
    Fallback { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionStatus {
    pub model: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interaction_id: Option<String>,
    #[serde(skip)]
    pub diagnostic_payload: Option<String>,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            diagnostic_id: None,
            provider_request_id: None,
            interaction_id: None,
            diagnostic_payload: None,
        }
    }

    pub fn with_diagnostic_payload(mut self, payload: impl Into<String>) -> Self {
        self.diagnostic_payload = Some(payload.into());
        self
    }

    pub fn with_provider_request_id(mut self, provider_request_id: Option<String>) -> Self {
        self.provider_request_id = provider_request_id;
        self
    }
}

fn default_true() -> bool {
    true
}

fn default_output_language() -> OutputLanguage {
    OutputLanguage::Chinese
}

fn default_detail_level() -> DetailLevel {
    DetailLevel::Expert
}

fn default_fit_mode() -> FitMode {
    FitMode::Contain
}
