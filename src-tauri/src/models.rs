use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub theme: ThemeMode,
}

impl Default for SettingsFile {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            model: "gpt-4.1-mini".into(),
            timeout_seconds: 120,
            theme: ThemeMode::System,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub base_url: String,
    pub model: String,
    pub timeout_seconds: u64,
    pub theme: ThemeMode,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub clear_api_key: bool,
}

impl From<&SettingsInput> for SettingsFile {
    fn from(value: &SettingsInput) -> Self {
        Self {
            base_url: value.base_url.trim().trim_end_matches('/').to_owned(),
            model: value.model.trim().to_owned(),
            timeout_seconds: value.timeout_seconds.clamp(10, 300),
            theme: value.theme,
        }
    }
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputLanguage {
    Chinese,
    English,
    Bilingual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
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
    pub composition: String,
    #[serde(default)]
    pub lighting: String,
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
    pub raw_response: Option<String>,
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
    pub result: ReverseResult,
    pub created_at: String,
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
    pub raw_response: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_request_id: Option<String>,
}

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            raw_response: None,
            provider_request_id: None,
        }
    }

    pub fn with_raw_response(mut self, raw_response: impl Into<String>) -> Self {
        self.raw_response = Some(raw_response.into());
        self
    }

    pub fn with_provider_request_id(mut self, provider_request_id: Option<String>) -> Self {
        self.provider_request_id = provider_request_id;
        self
    }
}
