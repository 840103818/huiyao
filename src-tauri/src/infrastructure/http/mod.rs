use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::models::{
    AnalysisFieldKey, AnalysisRefinementOutput, AnalysisRefinementRequest, CommandError,
    ConnectionStatus, DetailLevel, OutputLanguage, PromptOptimizationOutput,
    PromptOptimizationRequest, PromptOptimizationTarget, ResultMetadata, ReverseRequest,
    ReverseResult, SettingsFile,
};

const SYSTEM_PROMPT: &str = r##"你是专业的 AI 图片提示词逆向分析师。根据用户提供的图片，提炼可复用的生成指令。
只返回一个合法 JSON 对象，不要使用 Markdown，不要补充解释。结构必须严格为：
{
  "analysis": {
    "subject": "主体与关键视觉元素",
    "scene": "环境类型、前中后景关系、背景复杂度与主体分离方式",
    "composition": "构图、视角与空间关系",
    "lighting": "光源方向、软硬与氛围",
    "tonality": "高调或低调、对比度、动态范围、黑位与亮部表现",
    "colors": "主色、辅色与色彩关系",
    "palette": ["#000000", "#FFFFFF"],
    "materials": "材质、纹理与表面特征",
    "style": "媒介、审美与整体风格",
    "camera": "景别、机位、拍摄角度、透视、焦段倾向、焦点、景深、焦外、运动模糊与镜头畸变",
    "postProcessing": "白平衡倾向、调色、颗粒、锐化、柔光、晕影与胶片或数字成像质感"
  },
  "prompts": { "zh": "完整中文提示词", "en": "Complete English prompt" }
}
准确描述图片中可见事实，不虚构品牌、相机型号、精确光圈、快门、ISO、焦距、色温或其他不可见信息。无法确认的摄影特征使用“倾向”或“可能”表述。提示词应吸收全部分析并可直接用于图像生成。"##;

const MAX_BASE_URL_CHARS: usize = 2_048;
const MAX_MODEL_CHARS: usize = 200;
const MAX_REQUIREMENTS_CHARS: usize = 500;
const MAX_OPTIMIZATION_CONTEXT_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_BYTES: usize = 32 * 1024 * 1024;
const MAX_IMAGE_EDGE: usize = 32_768;
const MAX_IMAGE_PIXELS: usize = 80_000_000;
const MAX_STREAM_BYTES: usize = 4 * 1024 * 1024;
const MAX_STREAM_CONTENT_BYTES: usize = 1024 * 1024;
const MAX_SSE_BUFFER_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ERROR_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [Value],
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_options: Option<StreamOptions>,
}

#[derive(Debug, Serialize)]
struct StreamOptions {
    include_usage: bool,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    model: String,
    choices: Vec<ChatChoice>,
    usage: Option<Usage>,
    #[serde(skip)]
    provider_request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Usage {
    total_tokens: Option<u64>,
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct StreamChunk {
    #[serde(default)]
    model: String,
    #[serde(default)]
    choices: Vec<StreamChoice>,
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct StreamChoice {
    delta: StreamDelta,
}

#[derive(Debug, Deserialize)]
struct StreamDelta {
    content: Option<String>,
}

pub enum ApiStreamEvent {
    Delta(String),
    Fallback,
}

pub struct StreamOutcome {
    pub result: ReverseResult,
    pub first_token_ms: Option<u64>,
    pub used_fallback: bool,
}

pub struct OptimizationStreamOutcome {
    pub result: PromptOptimizationOutput,
    pub first_token_ms: Option<u64>,
    pub used_fallback: bool,
}

pub struct AnalysisRefinementStreamOutcome {
    pub result: AnalysisRefinementOutput,
    pub first_token_ms: Option<u64>,
    pub used_fallback: bool,
}

struct ContentStreamOutcome {
    content: String,
    metadata: ResultMetadata,
    first_token_ms: Option<u64>,
    used_fallback: bool,
}

include!("endpoint.rs");
include!("transport.rs");
include!("parser.rs");
include!("errors.rs");
include!("sse.rs");
include!("tests.rs");

enum StreamAttemptError {
    Unsupported,
    Fatal(CommandError),
}
