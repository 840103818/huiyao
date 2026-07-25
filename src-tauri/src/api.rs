use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::models::{
    CommandError, ConnectionStatus, DetailLevel, OutputLanguage, PromptOptimizationOutput,
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

struct ContentStreamOutcome {
    content: String,
    metadata: ResultMetadata,
    first_token_ms: Option<u64>,
    used_fallback: bool,
}

enum StreamAttemptError {
    Unsupported,
    Fatal(CommandError),
}

pub fn endpoint_from_base_url(base_url: &str) -> Result<String, CommandError> {
    let mut url = parse_base_url(base_url)?;
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        url.set_path(&format!("{path}/chat/completions"));
    }
    Ok(url.to_string())
}

pub fn insecure_http_origin(base_url: &str) -> Result<Option<String>, CommandError> {
    let url = parse_base_url(base_url)?;
    if url.scheme() != "http" || is_loopback_host(url.host_str()) {
        return Ok(None);
    }
    Ok(Some(url.origin().ascii_serialization()))
}

pub fn validate_base_url_security(
    base_url: &str,
    acknowledged_origin: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(origin) = insecure_http_origin(base_url)? {
        if acknowledged_origin != Some(origin.as_str()) {
            return Err(CommandError::new(
                "insecure_http_confirmation_required",
                "该模型服务使用明文 HTTP，请确认 API Key 可能被网络监听",
            ));
        }
    }
    Ok(())
}

fn parse_base_url(base_url: &str) -> Result<Url, CommandError> {
    let normalized = base_url.trim();
    if normalized.is_empty() || normalized.chars().count() > MAX_BASE_URL_CHARS {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 为空或长度超过限制",
        ));
    }
    let mut url = Url::parse(normalized)
        .map_err(|_| CommandError::new("invalid_base_url", "Base URL 必须是有效的 HTTP(S) 地址"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 必须是有效的 HTTP(S) 地址",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 不能包含用户名、密码或片段",
        ));
    }
    url.set_fragment(None);
    Ok(url)
}

fn is_loopback_host(host: Option<&str>) -> bool {
    matches!(host, Some("localhost"))
        || host
            .and_then(|value| value.parse::<std::net::IpAddr>().ok())
            .is_some_and(|address| address.is_loopback())
}

pub fn build_messages(request: &ReverseRequest) -> Result<Vec<Value>, CommandError> {
    validate_reverse_request(request)?;
    let image = request.image_data_url.trim();
    let language = match request.output_language {
        OutputLanguage::Chinese => "仅输出中文提示词，但仍保留 en 字段为空字符串",
        OutputLanguage::English => "仅输出英文提示词，但仍保留 zh 字段为空字符串",
        OutputLanguage::Bilingual => "同时输出完整中文和英文提示词",
    };
    let detail = match request.detail_level {
        DetailLevel::Concise => "精简",
        DetailLevel::Standard => "标准",
        DetailLevel::Detailed => "详细",
        DetailLevel::Expert => "专家级，包含可执行的视觉与镜头描述",
    };
    let instruction = format!(
        "输出要求：{language}；详细程度：{detail}。补充要求：{}。",
        empty_as_none(&request.requirements)
    );

    Ok(vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({
            "role": "user",
            "content": [
                { "type": "text", "text": instruction },
                { "type": "image_url", "image_url": { "url": image } }
            ]
        }),
    ])
}

pub async fn reverse_prompt_stream<F>(
    client: &reqwest::Client,
    settings: &SettingsFile,
    api_key: &str,
    request: &ReverseRequest,
    cancellation: &CancellationToken,
    mut on_event: F,
) -> Result<StreamOutcome, CommandError>
where
    F: FnMut(ApiStreamEvent) + Send,
{
    validate_service_settings(settings, api_key)?;
    let started = Instant::now();
    let messages = build_messages(request)?;
    let endpoint = endpoint_from_base_url(&settings.base_url)?;
    match stream_attempt(
        client,
        &endpoint,
        settings,
        api_key,
        &messages,
        true,
        started,
        cancellation,
        &mut on_event,
    )
    .await
    {
        Ok(outcome) => return Ok(outcome),
        Err(StreamAttemptError::Fatal(error)) => return Err(error),
        Err(StreamAttemptError::Unsupported) => {}
    }

    match stream_attempt(
        client,
        &endpoint,
        settings,
        api_key,
        &messages,
        false,
        started,
        cancellation,
        &mut on_event,
    )
    .await
    {
        Ok(outcome) => return Ok(outcome),
        Err(StreamAttemptError::Fatal(error)) => return Err(error),
        Err(StreamAttemptError::Unsupported) => {}
    }

    on_event(ApiStreamEvent::Fallback);
    let response = send_chat_with_client(
        client,
        &endpoint,
        settings,
        api_key,
        &messages,
        Some(cancellation),
    )
    .await?;
    Ok(StreamOutcome {
        result: result_from_chat_response(response, settings, started)?,
        first_token_ms: None,
        used_fallback: true,
    })
}

pub fn build_optimization_messages(
    request: &PromptOptimizationRequest,
) -> Result<Vec<Value>, CommandError> {
    if request.requirements.chars().count() > MAX_REQUIREMENTS_CHARS {
        return Err(CommandError::new(
            "requirements_too_long",
            "优化要求不能超过 500 个字符",
        ));
    }
    if request.source_prompts.zh.trim().is_empty() && request.source_prompts.en.trim().is_empty() {
        return Err(CommandError::new(
            "optimization_invalid",
            "当前结果没有可优化的提示词",
        ));
    }
    if request.aspect_ratio.as_ref().is_some_and(|value| {
        value.len() > 32
            || value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b':')
            || !value.contains(':')
    }) {
        return Err(CommandError::new(
            "optimization_invalid",
            "图片宽高比格式无效",
        ));
    }
    let target_instruction = match request.target {
        PromptOptimizationTarget::General => {
            "生成平台无关、可直接用于主流图像模型的自然语言提示词，不加入平台参数。"
        }
        PromptOptimizationTarget::Midjourney => {
            "针对 Midjourney 优化语义顺序与视觉权重；如提供宽高比，在正文末尾加入对应 --ar 参数，不虚构其他参数。"
        }
        PromptOptimizationTarget::Flux => {
            "针对 Flux 使用清晰连贯的自然语言，强调主体、空间、光线、材质与摄影成像关系，不堆砌参数标签。"
        }
        PromptOptimizationTarget::Sdxl => {
            "针对 SDXL 输出正向提示词和独立负面提示词；负面提示词应具体、克制且避免与正向要求冲突。"
        }
    };
    let system = format!(
        "你是专业的 AI 图像提示词编辑师。基于已有提示词和摄影测定进行二次优化，不分析图片，也不声称看到了图片。{target_instruction}\
只返回一个合法 JSON 对象，不使用 Markdown，不补充解释。结构严格为：\
{{\"prompts\":{{\"zh\":\"完整中文正向提示词\",\"en\":\"Complete English positive prompt\"}},\"negativePrompts\":{{\"zh\":\"中文负面提示词\",\"en\":\"English negative prompt\"}}}}。\
除 SDXL 外 negativePrompts 的 zh 和 en 必须为空字符串。中英文表达应语义一致，但符合各自语言习惯。"
    );
    let payload = json!({
        "target": request.target,
        "aspectRatio": request.aspect_ratio,
        "customRequirements": request.requirements.trim(),
        "analysis": request.analysis,
        "sourcePrompts": request.source_prompts,
        "sourceNegativePrompts": request.source_negative_prompts,
    });
    let payload_text = serde_json::to_string(&payload)
        .map_err(|error| CommandError::new("optimization_invalid", error.to_string()))?;
    if payload_text.len() > MAX_OPTIMIZATION_CONTEXT_BYTES {
        return Err(CommandError::new(
            "optimization_too_large",
            "待优化内容超过安全限制",
        ));
    }
    Ok(vec![
        json!({ "role": "system", "content": system }),
        json!({ "role": "user", "content": payload_text }),
    ])
}

pub async fn optimize_prompt_stream<F>(
    client: &reqwest::Client,
    settings: &SettingsFile,
    api_key: &str,
    request: &PromptOptimizationRequest,
    cancellation: &CancellationToken,
    mut on_event: F,
) -> Result<OptimizationStreamOutcome, CommandError>
where
    F: FnMut(ApiStreamEvent) + Send,
{
    validate_service_settings(settings, api_key)?;
    let started = Instant::now();
    let messages = build_optimization_messages(request)?;
    let endpoint = endpoint_from_base_url(&settings.base_url)?;
    let outcome = match content_stream_attempt(
        client,
        &endpoint,
        settings,
        api_key,
        &messages,
        true,
        started,
        cancellation,
        &mut on_event,
    )
    .await
    {
        Ok(outcome) => outcome,
        Err(StreamAttemptError::Fatal(error)) => return Err(error),
        Err(StreamAttemptError::Unsupported) => match content_stream_attempt(
            client,
            &endpoint,
            settings,
            api_key,
            &messages,
            false,
            started,
            cancellation,
            &mut on_event,
        )
        .await
        {
            Ok(outcome) => outcome,
            Err(StreamAttemptError::Fatal(error)) => return Err(error),
            Err(StreamAttemptError::Unsupported) => {
                on_event(ApiStreamEvent::Fallback);
                let response = send_chat_with_client(
                    client,
                    &endpoint,
                    settings,
                    api_key,
                    &messages,
                    Some(cancellation),
                )
                .await?;
                content_outcome_from_chat_response(response, settings, started)?
            }
        },
    };
    let mut result: PromptOptimizationOutput = parse_json_object(&outcome.content)?;
    if request.target != PromptOptimizationTarget::Sdxl {
        result.negative_prompts = Default::default();
    }
    result.metadata = outcome.metadata;
    Ok(OptimizationStreamOutcome {
        result,
        first_token_ms: outcome.first_token_ms,
        used_fallback: outcome.used_fallback,
    })
}

pub async fn test_connection(
    client: &reqwest::Client,
    settings: &SettingsFile,
    api_key: &str,
) -> Result<ConnectionStatus, CommandError> {
    validate_service_settings(settings, api_key)?;
    let messages = vec![
        json!({ "role": "system", "content": "只回复 OK" }),
        json!({ "role": "user", "content": "测试连接" }),
    ];
    let endpoint = endpoint_from_base_url(&settings.base_url)?;
    match send_streaming_connection_probe(client, &endpoint, settings, api_key, &messages).await {
        Ok(status) => Ok(status),
        Err(StreamAttemptError::Fatal(error)) => Err(error),
        Err(StreamAttemptError::Unsupported) => {
            let response =
                send_chat_with_client(client, &endpoint, settings, api_key, &messages, None)
                    .await?;
            Ok(connection_status_from_response(response, settings))
        }
    }
}

async fn send_streaming_connection_probe(
    client: &reqwest::Client,
    endpoint: &str,
    settings: &SettingsFile,
    api_key: &str,
    messages: &[Value],
) -> Result<ConnectionStatus, StreamAttemptError> {
    let response = client
        .post(endpoint)
        .timeout(request_timeout(settings))
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&ChatRequest {
            model: &settings.model,
            messages,
            stream: Some(true),
            stream_options: None,
        })
        .send()
        .await
        .map_err(map_network_error)
        .map_err(StreamAttemptError::Fatal)?;
    let status = response.status();
    let request_id = provider_request_id(&response);
    if !status.is_success() {
        let body = read_response_text_without_cancel(response, MAX_ERROR_BODY_BYTES)
            .await
            .map_err(|error| {
                StreamAttemptError::Fatal(error.with_provider_request_id(request_id.clone()))
            })?;
        return if is_stream_compatibility_status(status) {
            Err(StreamAttemptError::Unsupported)
        } else {
            Err(StreamAttemptError::Fatal(
                map_http_error(status, &body).with_provider_request_id(request_id),
            ))
        };
    }

    let is_event_stream = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if !is_event_stream {
        let body = read_response_text_without_cancel(response, MAX_RESPONSE_BYTES)
            .await
            .map_err(|error| {
                StreamAttemptError::Fatal(error.with_provider_request_id(request_id.clone()))
            })?;
        let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
            StreamAttemptError::Fatal(
                CommandError::new("invalid_response", "服务返回了无法识别的响应格式")
                    .with_provider_request_id(request_id.clone())
                    .with_diagnostic_payload(body.clone()),
            )
        })?;
        parsed.provider_request_id = request_id;
        return Ok(connection_status_from_response(parsed, settings));
    }

    let mut body_stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut response_model = String::new();
    let mut received_valid_event = false;
    let mut done = false;
    let mut streamed_bytes = 0usize;
    while let Some(chunk) = body_stream.next().await {
        let chunk = chunk
            .map_err(map_network_error)
            .map_err(StreamAttemptError::Fatal)?;
        streamed_bytes = streamed_bytes.saturating_add(chunk.len());
        if streamed_bytes > MAX_STREAM_BYTES {
            return Err(StreamAttemptError::Fatal(response_too_large_error()));
        }
        for data in decoder.push(&chunk).map_err(StreamAttemptError::Fatal)? {
            if data.trim() == "[DONE]" {
                done = true;
                break;
            }
            let value: Value = serde_json::from_str(&data).map_err(|_| {
                StreamAttemptError::Fatal(CommandError::new(
                    "invalid_stream",
                    "模型返回了无法解析的流式数据",
                ))
            })?;
            if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
                return Err(StreamAttemptError::Fatal(
                    CommandError::new("stream_error", "模型服务返回流式错误")
                        .with_diagnostic_payload(message),
                ));
            }
            let chunk: StreamChunk = serde_json::from_value(value).map_err(|_| {
                StreamAttemptError::Fatal(CommandError::new(
                    "invalid_stream",
                    "模型返回了不兼容的流式数据",
                ))
            })?;
            received_valid_event = true;
            if !chunk.model.is_empty() {
                response_model = chunk.model;
            }
        }
        if done {
            break;
        }
    }
    if !done || !received_valid_event {
        return Err(StreamAttemptError::Fatal(
            CommandError::new("stream_interrupted", "模型流式响应意外中断，请重试")
                .with_provider_request_id(request_id),
        ));
    }
    Ok(ConnectionStatus {
        model: if response_model.is_empty() {
            settings.model.clone()
        } else {
            response_model
        },
        message: "连接成功".into(),
        provider_request_id: request_id,
    })
}

fn connection_status_from_response(
    response: ChatResponse,
    settings: &SettingsFile,
) -> ConnectionStatus {
    ConnectionStatus {
        model: if response.model.is_empty() {
            settings.model.clone()
        } else {
            response.model
        },
        message: "连接成功".into(),
        provider_request_id: response.provider_request_id,
    }
}

#[allow(clippy::too_many_arguments)]
async fn stream_attempt<F>(
    client: &reqwest::Client,
    endpoint: &str,
    settings: &SettingsFile,
    api_key: &str,
    messages: &[Value],
    include_usage: bool,
    started: Instant,
    cancellation: &CancellationToken,
    on_event: &mut F,
) -> Result<StreamOutcome, StreamAttemptError>
where
    F: FnMut(ApiStreamEvent) + Send,
{
    let request = client
        .post(endpoint)
        .timeout(request_timeout(settings))
        .bearer_auth(api_key)
        .header(reqwest::header::ACCEPT, "text/event-stream")
        .json(&ChatRequest {
            model: &settings.model,
            messages,
            stream: Some(true),
            stream_options: include_usage.then_some(StreamOptions {
                include_usage: true,
            }),
        });
    let response = select_response(request.send(), cancellation)
        .await
        .map_err(StreamAttemptError::Fatal)?;
    let status = response.status();
    let provider_request_id = provider_request_id(&response);
    if !status.is_success() {
        let body = read_response_text(response, cancellation, MAX_ERROR_BODY_BYTES)
            .await
            .map_err(StreamAttemptError::Fatal)?;
        let error = map_http_error(status, &body).with_provider_request_id(provider_request_id);
        return if is_stream_compatibility_status(status) {
            Err(StreamAttemptError::Unsupported)
        } else {
            Err(StreamAttemptError::Fatal(error))
        };
    }

    let is_event_stream = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if !is_event_stream {
        let body = read_response_text(response, cancellation, MAX_RESPONSE_BYTES)
            .await
            .map_err(StreamAttemptError::Fatal)?;
        let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
            StreamAttemptError::Fatal(
                CommandError::new("invalid_response", "服务返回了无法识别的响应格式")
                    .with_diagnostic_payload(body.clone()),
            )
        })?;
        parsed.provider_request_id = provider_request_id;
        on_event(ApiStreamEvent::Fallback);
        return Ok(StreamOutcome {
            result: result_from_chat_response(parsed, settings, started)
                .map_err(StreamAttemptError::Fatal)?,
            first_token_ms: None,
            used_fallback: true,
        });
    }

    let mut body_stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut content = String::new();
    let mut response_model = String::new();
    let mut usage = None;
    let mut first_token_ms = None;
    let mut done = false;
    let mut streamed_bytes = 0usize;

    while !done {
        let next = tokio::select! {
            _ = cancellation.cancelled() => return Err(StreamAttemptError::Fatal(cancelled_error())),
            value = body_stream.next() => value,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk
            .map_err(map_network_error)
            .map_err(StreamAttemptError::Fatal)?;
        streamed_bytes = streamed_bytes.saturating_add(chunk.len());
        if streamed_bytes > MAX_STREAM_BYTES {
            return Err(StreamAttemptError::Fatal(response_too_large_error()));
        }
        for data in decoder.push(&chunk).map_err(StreamAttemptError::Fatal)? {
            if data.trim() == "[DONE]" {
                done = true;
                break;
            }
            consume_stream_data(
                &data,
                started,
                &mut content,
                &mut response_model,
                &mut usage,
                &mut first_token_ms,
                on_event,
            )
            .map_err(StreamAttemptError::Fatal)?;
        }
    }
    for data in decoder.finish().map_err(StreamAttemptError::Fatal)? {
        if data.trim() != "[DONE]" {
            consume_stream_data(
                &data,
                started,
                &mut content,
                &mut response_model,
                &mut usage,
                &mut first_token_ms,
                on_event,
            )
            .map_err(StreamAttemptError::Fatal)?;
        }
    }
    if !done {
        return Err(StreamAttemptError::Fatal(
            CommandError::new("stream_interrupted", "模型流式响应意外中断，请重试")
                .with_provider_request_id(provider_request_id),
        ));
    }
    if content.trim().is_empty() {
        return Err(StreamAttemptError::Fatal(CommandError::new(
            "empty_response",
            "模型没有返回可用内容",
        )));
    }

    let mut result = parse_result(&content).map_err(|error| {
        StreamAttemptError::Fatal(error.with_diagnostic_payload(content.clone()))
    })?;
    result.metadata = ResultMetadata {
        model: if response_model.is_empty() {
            settings.model.clone()
        } else {
            response_model
        },
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_tokens: usage.and_then(total_tokens),
        created_at: Utc::now().to_rfc3339(),
        provider_request_id,
    };
    Ok(StreamOutcome {
        result,
        first_token_ms,
        used_fallback: false,
    })
}

fn consume_stream_data<F>(
    data: &str,
    started: Instant,
    content: &mut String,
    response_model: &mut String,
    usage: &mut Option<Usage>,
    first_token_ms: &mut Option<u64>,
    on_event: &mut F,
) -> Result<(), CommandError>
where
    F: FnMut(ApiStreamEvent),
{
    let value: Value = serde_json::from_str(data)
        .map_err(|_| CommandError::new("invalid_stream", "模型返回了无法解析的流式数据"))?;
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return Err(CommandError::new("stream_error", "模型服务返回流式错误")
            .with_diagnostic_payload(message));
    }
    let chunk: StreamChunk = serde_json::from_value(value)
        .map_err(|_| CommandError::new("invalid_stream", "模型返回了不兼容的流式数据"))?;
    if !chunk.model.is_empty() {
        *response_model = chunk.model;
    }
    if chunk.usage.is_some() {
        *usage = chunk.usage;
    }
    for choice in chunk.choices {
        if let Some(delta) = choice.delta.content.filter(|value| !value.is_empty()) {
            if content.len().saturating_add(delta.len()) > MAX_STREAM_CONTENT_BYTES {
                return Err(response_too_large_error());
            }
            if first_token_ms.is_none() {
                *first_token_ms = Some(started.elapsed().as_millis() as u64);
            }
            content.push_str(&delta);
            on_event(ApiStreamEvent::Delta(delta));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn content_stream_attempt<F>(
    client: &reqwest::Client,
    endpoint: &str,
    settings: &SettingsFile,
    api_key: &str,
    messages: &[Value],
    include_usage: bool,
    started: Instant,
    cancellation: &CancellationToken,
    on_event: &mut F,
) -> Result<ContentStreamOutcome, StreamAttemptError>
where
    F: FnMut(ApiStreamEvent) + Send,
{
    let response = select_response(
        client
            .post(endpoint)
            .timeout(request_timeout(settings))
            .bearer_auth(api_key)
            .header(reqwest::header::ACCEPT, "text/event-stream")
            .json(&ChatRequest {
                model: &settings.model,
                messages,
                stream: Some(true),
                stream_options: include_usage.then_some(StreamOptions {
                    include_usage: true,
                }),
            })
            .send(),
        cancellation,
    )
    .await
    .map_err(StreamAttemptError::Fatal)?;
    let status = response.status();
    let request_id = provider_request_id(&response);
    if !status.is_success() {
        let body = read_response_text(response, cancellation, MAX_ERROR_BODY_BYTES)
            .await
            .map_err(StreamAttemptError::Fatal)?;
        let error = map_http_error(status, &body).with_provider_request_id(request_id);
        return if is_stream_compatibility_status(status) {
            Err(StreamAttemptError::Unsupported)
        } else {
            Err(StreamAttemptError::Fatal(error))
        };
    }
    let is_event_stream = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if !is_event_stream {
        let body = read_response_text(response, cancellation, MAX_RESPONSE_BYTES)
            .await
            .map_err(StreamAttemptError::Fatal)?;
        let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
            StreamAttemptError::Fatal(
                CommandError::new("invalid_response", "服务返回了无法识别的响应格式")
                    .with_provider_request_id(request_id.clone())
                    .with_diagnostic_payload(body),
            )
        })?;
        parsed.provider_request_id = request_id;
        on_event(ApiStreamEvent::Fallback);
        return content_outcome_from_chat_response(parsed, settings, started)
            .map_err(StreamAttemptError::Fatal);
    }

    let mut body_stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut content = String::new();
    let mut response_model = String::new();
    let mut usage = None;
    let mut first_token_ms = None;
    let mut done = false;
    let mut streamed_bytes = 0usize;
    while !done {
        let next = tokio::select! {
            _ = cancellation.cancelled() => return Err(StreamAttemptError::Fatal(cancelled_error())),
            value = body_stream.next() => value,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk
            .map_err(map_network_error)
            .map_err(StreamAttemptError::Fatal)?;
        streamed_bytes = streamed_bytes.saturating_add(chunk.len());
        if streamed_bytes > MAX_STREAM_BYTES {
            return Err(StreamAttemptError::Fatal(response_too_large_error()));
        }
        for data in decoder.push(&chunk).map_err(StreamAttemptError::Fatal)? {
            if data.trim() == "[DONE]" {
                done = true;
                break;
            }
            consume_stream_data(
                &data,
                started,
                &mut content,
                &mut response_model,
                &mut usage,
                &mut first_token_ms,
                on_event,
            )
            .map_err(StreamAttemptError::Fatal)?;
        }
    }
    for data in decoder.finish().map_err(StreamAttemptError::Fatal)? {
        if data.trim() != "[DONE]" {
            consume_stream_data(
                &data,
                started,
                &mut content,
                &mut response_model,
                &mut usage,
                &mut first_token_ms,
                on_event,
            )
            .map_err(StreamAttemptError::Fatal)?;
        }
    }
    if !done {
        return Err(StreamAttemptError::Fatal(
            CommandError::new("stream_interrupted", "模型流式响应意外中断，请重试")
                .with_provider_request_id(request_id),
        ));
    }
    if content.trim().is_empty() {
        return Err(StreamAttemptError::Fatal(CommandError::new(
            "empty_response",
            "模型没有返回可用内容",
        )));
    }
    Ok(ContentStreamOutcome {
        content,
        metadata: ResultMetadata {
            model: if response_model.is_empty() {
                settings.model.clone()
            } else {
                response_model
            },
            elapsed_ms: started.elapsed().as_millis() as u64,
            total_tokens: usage.and_then(total_tokens),
            created_at: Utc::now().to_rfc3339(),
            provider_request_id: request_id,
        },
        first_token_ms,
        used_fallback: false,
    })
}

fn content_outcome_from_chat_response(
    response: ChatResponse,
    settings: &SettingsFile,
    started: Instant,
) -> Result<ContentStreamOutcome, CommandError> {
    let content = response
        .choices
        .first()
        .map(|choice| choice.message.content.clone())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CommandError::new("empty_response", "模型没有返回可用内容"))?;
    Ok(ContentStreamOutcome {
        content,
        metadata: ResultMetadata {
            model: if response.model.is_empty() {
                settings.model.clone()
            } else {
                response.model
            },
            elapsed_ms: started.elapsed().as_millis() as u64,
            total_tokens: response.usage.and_then(total_tokens),
            created_at: Utc::now().to_rfc3339(),
            provider_request_id: response.provider_request_id,
        },
        first_token_ms: None,
        used_fallback: true,
    })
}

async fn send_chat_with_client(
    client: &reqwest::Client,
    endpoint: &str,
    settings: &SettingsFile,
    api_key: &str,
    messages: &[Value],
    cancellation: Option<&CancellationToken>,
) -> Result<ChatResponse, CommandError> {
    let request = client
        .post(endpoint)
        .timeout(request_timeout(settings))
        .bearer_auth(api_key)
        .json(&ChatRequest {
            model: &settings.model,
            messages,
            stream: None,
            stream_options: None,
        });
    let response = match cancellation {
        Some(token) => select_response(request.send(), token).await?,
        None => request.send().await.map_err(map_network_error)?,
    };
    let status = response.status();
    let request_id = provider_request_id(&response);
    let body = match cancellation {
        Some(token) => {
            read_response_text(
                response,
                token,
                if status.is_success() {
                    MAX_RESPONSE_BYTES
                } else {
                    MAX_ERROR_BODY_BYTES
                },
            )
            .await?
        }
        None => {
            read_response_text_without_cancel(
                response,
                if status.is_success() {
                    MAX_RESPONSE_BYTES
                } else {
                    MAX_ERROR_BODY_BYTES
                },
            )
            .await?
        }
    };
    if !status.is_success() {
        return Err(map_http_error(status, &body).with_provider_request_id(request_id));
    }
    let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
        CommandError::new("invalid_response", "服务返回了无法识别的响应格式")
            .with_diagnostic_payload(body.clone())
    })?;
    parsed.provider_request_id = request_id;
    Ok(parsed)
}

async fn select_response(
    future: impl std::future::Future<Output = Result<Response, reqwest::Error>>,
    cancellation: &CancellationToken,
) -> Result<Response, CommandError> {
    tokio::select! {
        _ = cancellation.cancelled() => Err(cancelled_error()),
        response = future => response.map_err(map_network_error),
    }
}

async fn read_response_text(
    response: Response,
    cancellation: &CancellationToken,
    limit: usize,
) -> Result<String, CommandError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    loop {
        let next = tokio::select! {
            _ = cancellation.cancelled() => return Err(cancelled_error()),
            value = stream.next() => value,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(map_response_read_error)?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(response_too_large_error());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body)
        .map_err(|_| CommandError::new("invalid_response", "服务返回了无效 UTF-8 数据"))
}

async fn read_response_text_without_cancel(
    response: Response,
    limit: usize,
) -> Result<String, CommandError> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(map_response_read_error)?;
        if body.len().saturating_add(chunk.len()) > limit {
            return Err(response_too_large_error());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body)
        .map_err(|_| CommandError::new("invalid_response", "服务返回了无效 UTF-8 数据"))
}

fn result_from_chat_response(
    response: ChatResponse,
    settings: &SettingsFile,
    started: Instant,
) -> Result<ReverseResult, CommandError> {
    let content = response
        .choices
        .first()
        .map(|choice| choice.message.content.as_str())
        .ok_or_else(|| CommandError::new("empty_response", "模型没有返回可用内容"))?;
    let mut result =
        parse_result(content).map_err(|error| error.with_diagnostic_payload(content))?;
    result.metadata = ResultMetadata {
        model: if response.model.is_empty() {
            settings.model.clone()
        } else {
            response.model
        },
        elapsed_ms: started.elapsed().as_millis() as u64,
        total_tokens: response.usage.and_then(total_tokens),
        created_at: Utc::now().to_rfc3339(),
        provider_request_id: response.provider_request_id,
    };
    Ok(result)
}

pub fn build_client() -> Result<reqwest::Client, CommandError> {
    reqwest::Client::builder()
        .redirect(Policy::none())
        .pool_idle_timeout(Duration::from_secs(90))
        .pool_max_idle_per_host(4)
        .build()
        .map_err(|error| CommandError::new("client_error", error.to_string()))
}

fn request_timeout(settings: &SettingsFile) -> Duration {
    Duration::from_secs(settings.timeout_seconds.clamp(10, 300))
}

fn validate_service_settings(settings: &SettingsFile, api_key: &str) -> Result<(), CommandError> {
    if api_key.trim().is_empty() {
        return Err(CommandError::new(
            "missing_api_key",
            "请先在设置中填写 API Key",
        ));
    }
    if settings.model.trim().is_empty() {
        return Err(CommandError::new("missing_model", "请填写模型名称"));
    }
    if settings.model.chars().count() > MAX_MODEL_CHARS {
        return Err(CommandError::new("invalid_model", "模型名称长度超过限制"));
    }
    validate_base_url_security(&settings.base_url, settings.insecure_http_origin.as_deref())?;
    Ok(())
}

fn validate_reverse_request(request: &ReverseRequest) -> Result<(), CommandError> {
    if request.requirements.chars().count() > MAX_REQUIREMENTS_CHARS {
        return Err(CommandError::new(
            "requirements_too_long",
            "补充要求不能超过 500 个字符",
        ));
    }
    let data_url = request.image_data_url.trim();
    if data_url.is_empty() {
        return Err(CommandError::new("missing_image", "请先选择图片"));
    }
    if data_url.len() > MAX_IMAGE_DATA_URL_BYTES {
        return Err(CommandError::new("image_too_large", "图片数据超过安全限制"));
    }
    let (header, payload) = data_url
        .split_once(',')
        .ok_or_else(|| CommandError::new("invalid_image", "图片数据格式无效"))?;
    if !matches!(
        header,
        "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
    ) {
        return Err(CommandError::new(
            "invalid_image",
            "仅支持 PNG、JPEG 和 WebP 图片",
        ));
    }
    let bytes = BASE64
        .decode(payload)
        .map_err(|_| CommandError::new("invalid_image", "图片 Base64 数据无效"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(CommandError::new("image_too_large", "图片不能超过 20 MB"));
    }
    let size = imagesize::blob_size(&bytes)
        .map_err(|_| CommandError::new("invalid_image", "无法识别图片尺寸"))?;
    if size.width > MAX_IMAGE_EDGE
        || size.height > MAX_IMAGE_EDGE
        || size.width.saturating_mul(size.height) > MAX_IMAGE_PIXELS
    {
        return Err(CommandError::new(
            "image_dimensions_too_large",
            "图片尺寸过大，请缩小后重试",
        ));
    }
    Ok(())
}

fn provider_request_id(response: &Response) -> Option<String> {
    ["x-request-id", "request-id", "openai-request-id"]
        .iter()
        .find_map(|name| response.headers().get(*name))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(256).collect())
}

fn total_tokens(usage: Usage) -> Option<u64> {
    usage
        .total_tokens
        .or_else(|| Some(usage.prompt_tokens? + usage.completion_tokens?))
}

fn is_stream_compatibility_status(status: StatusCode) -> bool {
    matches!(status.as_u16(), 400 | 415 | 422 | 501)
}

fn cancelled_error() -> CommandError {
    CommandError::new("cancelled", "已停止生成")
}

fn parse_result(content: &str) -> Result<ReverseResult, CommandError> {
    parse_json_object(content)
}

fn parse_json_object<T: serde::de::DeserializeOwned>(content: &str) -> Result<T, CommandError> {
    let trimmed = content.trim();
    let without_prefix = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .unwrap_or(trimmed);
    let without_fence = without_prefix
        .strip_suffix("```")
        .unwrap_or(without_prefix)
        .trim();
    let json_slice = match (without_fence.find('{'), without_fence.rfind('}')) {
        (Some(start), Some(end)) if start <= end => &without_fence[start..=end],
        _ => {
            return Err(CommandError::new(
                "invalid_model_json",
                "模型未返回结构化结果，请重试或更换兼容模型",
            ))
        }
    };
    serde_json::from_str(json_slice).map_err(|_| {
        CommandError::new(
            "invalid_model_json",
            "模型返回的 JSON 不完整，请重试或降低详细程度",
        )
    })
}

fn empty_as_none(value: &str) -> &str {
    if value.trim().is_empty() {
        "无"
    } else {
        value.trim()
    }
}

fn map_network_error(error: reqwest::Error) -> CommandError {
    if error.is_timeout() {
        CommandError::new("timeout", "请求超时，请检查网络或提高超时时间")
    } else if error.is_connect() {
        CommandError::new("network", "无法连接到模型服务，请检查 Base URL 和网络")
    } else {
        CommandError::new("network", error.to_string())
    }
}

fn map_response_read_error(_error: reqwest::Error) -> CommandError {
    CommandError::new(
        "response_read",
        "模型服务在返回响应时中断，请重试；如反复出现，请检查服务商网关",
    )
}

fn response_too_large_error() -> CommandError {
    CommandError::new(
        "response_too_large",
        "模型响应超过安全限制，请降低详细程度或更换模型",
    )
}

fn map_http_error(status: StatusCode, body: &str) -> CommandError {
    let fallback = match status.as_u16() {
        300..=399 => "模型服务返回重定向；为保护 API Key，请直接填写最终 Base URL",
        401 | 403 => "API Key 无效或没有访问该模型的权限",
        404 => "接口或模型不存在，请检查 Base URL 和模型名称",
        413 => "图片过大，请缩小输入后重试",
        429 => "请求过于频繁或额度不足，请稍后重试",
        500..=599 => "模型服务暂时不可用，请稍后重试",
        _ => "模型服务返回错误",
    };
    CommandError::new(
        if status.is_redirection() {
            "redirect_blocked".into()
        } else {
            format!("http_{}", status.as_u16())
        },
        fallback,
    )
    .with_diagnostic_payload(body)
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, CommandError> {
        if self.buffer.len().saturating_add(bytes.len()) > MAX_SSE_BUFFER_BYTES {
            return Err(response_too_large_error());
        }
        self.buffer.extend_from_slice(bytes);
        let mut events = Vec::new();
        while let Some((index, separator_len)) = find_event_separator(&self.buffer) {
            let event = self.buffer.drain(..index).collect::<Vec<_>>();
            self.buffer.drain(..separator_len);
            if let Some(data) = decode_sse_event(&event)? {
                events.push(data);
            }
        }
        Ok(events)
    }

    fn finish(&mut self) -> Result<Vec<String>, CommandError> {
        if self.buffer.is_empty() {
            return Ok(Vec::new());
        }
        let remaining = std::mem::take(&mut self.buffer);
        Ok(decode_sse_event(&remaining)?.into_iter().collect())
    }
}

fn find_event_separator(bytes: &[u8]) -> Option<(usize, usize)> {
    let crlf = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4));
    let lf = bytes
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2));
    match (crlf, lf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn decode_sse_event(bytes: &[u8]) -> Result<Option<String>, CommandError> {
    let event = std::str::from_utf8(bytes)
        .map_err(|_| CommandError::new("invalid_stream", "流式响应包含无效 UTF-8 数据"))?;
    let data = event
        .lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| line.strip_prefix(' ').unwrap_or(line))
        .collect::<Vec<_>>()
        .join("\n");
    Ok((!data.is_empty()).then_some(data))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Analysis, DetailLevel, OutputLanguage, Prompts, ThemeMode};
    use httpmock::prelude::*;

    fn settings(base_url: String) -> SettingsFile {
        SettingsFile {
            base_url,
            model: "vision-test".into(),
            timeout_seconds: 10,
            theme: ThemeMode::System,
            auto_save_history: true,
            insecure_http_origin: None,
            workspace: Default::default(),
        }
    }

    fn image_request() -> ReverseRequest {
        ReverseRequest {
            image_data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=".into(),
            requirements: String::new(),
            output_language: OutputLanguage::Bilingual,
            detail_level: DetailLevel::Standard,
        }
    }

    fn optimization_request(target: PromptOptimizationTarget) -> PromptOptimizationRequest {
        PromptOptimizationRequest {
            analysis: Analysis {
                subject: "产品静物".into(),
                lighting: "左侧柔光".into(),
                ..Default::default()
            },
            source_prompts: Prompts {
                zh: "产品摄影".into(),
                en: "product photography".into(),
            },
            source_negative_prompts: None,
            target,
            requirements: "保持真实材质".into(),
            aspect_ratio: Some("3:2".into()),
        }
    }

    #[test]
    fn endpoint_normalizes_base_url() {
        assert_eq!(
            endpoint_from_base_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert!(endpoint_from_base_url("api.example.com").is_err());
        assert!(endpoint_from_base_url("https://user:pass@example.com/v1").is_err());
        assert!(endpoint_from_base_url("https://example.com/v1#fragment").is_err());
    }

    #[test]
    fn insecure_http_requires_exact_origin_confirmation() {
        let base_url = "http://api.example.com:8080/v1";
        assert_eq!(
            validate_base_url_security(base_url, None).unwrap_err().code,
            "insecure_http_confirmation_required"
        );
        assert!(validate_base_url_security(base_url, Some("http://api.example.com:8080")).is_ok());
        assert!(validate_base_url_security("http://127.0.0.1:8080/v1", None).is_ok());
    }

    #[test]
    fn invalid_image_payload_is_rejected_before_request() {
        let mut request = image_request();
        request.image_data_url = "data:image/png;base64,aGVsbG8=".into();
        assert_eq!(build_messages(&request).unwrap_err().code, "invalid_image");
    }

    #[test]
    fn parses_fenced_model_json() {
        let content = r#"```json
        {"analysis":{"subject":"watch","scene":"studio","tonality":"low key","postProcessing":"cool grade"},"prompts":{"zh":"中文","en":"English"}}
        ```"#;
        let result = parse_result(content).unwrap();
        assert_eq!(result.analysis.subject, "watch");
        assert_eq!(result.analysis.scene, "studio");
        assert_eq!(result.analysis.tonality, "low key");
        assert_eq!(result.analysis.post_processing, "cool grade");
        assert_eq!(result.prompts.en, "English");
    }

    #[test]
    fn photography_analysis_prompt_covers_reproducible_visual_dimensions() {
        for field in ["scene", "tonality", "postProcessing"] {
            assert!(SYSTEM_PROMPT.contains(&format!("\"{field}\"")));
        }
        assert!(SYSTEM_PROMPT.contains("无法确认的摄影特征"));
        assert!(SYSTEM_PROMPT.contains("相机型号"));
    }

    #[test]
    fn image_mode_rejects_empty_input() {
        let mut request = image_request();
        request.image_data_url.clear();
        assert_eq!(build_messages(&request).unwrap_err().code, "missing_image");
    }

    #[test]
    fn optimization_messages_are_text_only_and_target_specific() {
        let messages = build_optimization_messages(&optimization_request(
            PromptOptimizationTarget::Midjourney,
        ))
        .unwrap();
        let body = serde_json::to_string(&messages).unwrap();
        assert!(!body.contains("image_url"));
        assert!(body.contains("Midjourney"));
        assert!(body.contains("3:2"));

        let sdxl =
            build_optimization_messages(&optimization_request(PromptOptimizationTarget::Sdxl))
                .unwrap();
        assert!(serde_json::to_string(&sdxl).unwrap().contains("负面提示词"));
    }

    #[tokio::test]
    async fn streams_bilingual_optimization_without_resending_an_image() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("image_url")
                .body_includes("midjourney")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body(concat!(
                    "data: {\"model\":\"vision-test\",\"choices\":[{\"delta\":{\"content\":\"{\\\"prompts\\\":{\\\"zh\\\":\\\"优化中文\\\",\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"\\\"en\\\":\\\"optimized English\\\"},\\\"negativePrompts\\\":{\\\"zh\\\":\\\"\\\",\\\"en\\\":\\\"\\\"}}\"}}]}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"total_tokens\":23}}\n\n",
                    "data: [DONE]\n\n"
                ));
        });
        let mut deltas = Vec::new();
        let outcome = optimize_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &optimization_request(PromptOptimizationTarget::Midjourney),
            &CancellationToken::new(),
            |event| {
                if let ApiStreamEvent::Delta(value) = event {
                    deltas.push(value);
                }
            },
        )
        .await
        .unwrap();

        completion.assert();
        assert_eq!(outcome.result.prompts.zh, "优化中文");
        assert_eq!(outcome.result.prompts.en, "optimized English");
        assert_eq!(outcome.result.metadata.total_tokens, Some(23));
        assert_eq!(deltas.len(), 2);
    }

    #[test]
    fn sse_decoder_handles_chunk_boundaries_crlf_and_utf8() {
        let payload =
            "data: {\"choices\":[{\"delta\":{\"content\":\"中文\"}}]}\r\n\r\ndata: [DONE]\n\n";
        let bytes = payload.as_bytes();
        let split = payload.find('文').unwrap() + 1;
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(&bytes[..split]).unwrap().is_empty());
        let events = decoder.push(&bytes[split..]).unwrap();
        assert_eq!(events.len(), 2);
        assert!(events[0].contains("中文"));
        assert_eq!(events[1], "[DONE]");
    }

    #[tokio::test]
    async fn streams_authorized_completion_and_usage() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .header("authorization", "Bearer test-secret")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .header("x-request-id", "provider-stream-42")
                .body(concat!(
                    "data: {\"model\":\"vision-test\",\"choices\":[{\"delta\":{\"content\":\"{\\\"analysis\\\":{\\\"subject\\\":\\\"sample\\\"},\"}}]}\n\n",
                    "data: {\"choices\":[{\"delta\":{\"content\":\"\\\"prompts\\\":{\\\"zh\\\":\\\"中文\\\",\\\"en\\\":\\\"English\\\"}}\"}}]}\n\n",
                    "data: {\"choices\":[],\"usage\":{\"total_tokens\":42}}\n\n",
                    "data: [DONE]\n\n"
                ));
        });
        let mut deltas = Vec::new();
        let outcome = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |event| {
                if let ApiStreamEvent::Delta(value) = event {
                    deltas.push(value);
                }
            },
        )
        .await
        .unwrap();

        completion.assert();
        assert_eq!(outcome.result.analysis.subject, "sample");
        assert_eq!(outcome.result.metadata.total_tokens, Some(42));
        assert_eq!(
            outcome.result.metadata.provider_request_id.as_deref(),
            Some("provider-stream-42")
        );
        assert_eq!(deltas.len(), 2);
        assert!(!outcome.used_fallback);
    }

    #[tokio::test]
    async fn retries_stream_without_options_then_falls_back_to_json() {
        let server = MockServer::start();
        let with_options = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream_options\"");
            then.status(400);
        });
        let plain_stream = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true")
                .body_excludes("\"stream_options\"");
            then.status(415);
        });
        let ordinary = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("\"stream\"");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(json!({
                    "model": "vision-fallback",
                    "choices": [{ "message": { "content": "{\"analysis\":{\"subject\":\"fallback\"},\"prompts\":{\"zh\":\"中文\",\"en\":\"English\"}}" } }],
                    "usage": { "total_tokens": 17 }
                }));
        });
        let mut fallback_events = 0;
        let outcome = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |event| {
                if matches!(event, ApiStreamEvent::Fallback) {
                    fallback_events += 1;
                }
            },
        )
        .await
        .unwrap();

        with_options.assert_calls(1);
        plain_stream.assert_calls(1);
        ordinary.assert_calls(1);
        assert_eq!(fallback_events, 1);
        assert!(outcome.used_fallback);
        assert_eq!(outcome.result.analysis.subject, "fallback");
        assert_eq!(outcome.result.metadata.total_tokens, Some(17));
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_request() {
        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let pending = async { std::future::pending::<Result<Response, reqwest::Error>>().await };

        let error = select_response(pending, &cancellation).await.unwrap_err();

        assert_eq!(error.code, "cancelled");
    }

    #[tokio::test]
    async fn reports_stream_ending_without_done_as_interrupted() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .body("data: {\"choices\":[{\"delta\":{\"content\":\"{}\"}}]}\n\n");
        });

        let error = reverse_prompt_stream(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
            &image_request(),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .err()
        .expect("stream without DONE must fail");

        assert_eq!(error.code, "stream_interrupted");
    }

    #[test]
    fn sse_decoder_uses_the_earliest_mixed_line_separator() {
        let mut decoder = SseDecoder::default();
        let events = decoder
            .push(b"data: first\n\ndata: second\r\n\r\n")
            .unwrap();

        assert_eq!(events, vec!["first", "second"]);
    }

    #[tokio::test]
    async fn maps_unauthorized_response_without_fallback() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(401)
                .json_body(json!({ "error": { "message": "invalid key" } }));
        });
        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "bad-key",
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "http_401");
        assert_eq!(error.message, "API Key 无效或没有访问该模型的权限");
        assert!(error
            .diagnostic_payload
            .as_deref()
            .is_some_and(|value| value.contains("invalid key")));
    }

    #[tokio::test]
    async fn maps_rate_limit_response_without_fallback() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(429)
                .json_body(json!({ "error": { "message": "quota exceeded" } }));
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "http_429");
        assert_eq!(error.message, "请求过于频繁或额度不足，请稍后重试");
        request.assert_calls(1);
    }

    #[test]
    fn rejects_stream_content_over_the_limit() {
        let data = json!({
            "choices": [{ "delta": { "content": "x".repeat(MAX_STREAM_CONTENT_BYTES + 1) } }]
        })
        .to_string();
        let mut content = String::new();
        let mut response_model = String::new();
        let mut usage = None;
        let mut first_token_ms = None;

        let error = consume_stream_data(
            &data,
            Instant::now(),
            &mut content,
            &mut response_model,
            &mut usage,
            &mut first_token_ms,
            &mut |_| {},
        )
        .unwrap_err();

        assert_eq!(error.code, "response_too_large");
        assert!(content.is_empty());
    }

    #[tokio::test]
    async fn blocks_cross_origin_redirects_without_forwarding_credentials() {
        let server = MockServer::start();
        let redirect = server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(307)
                .header("location", "https://unexpected.example/v1/chat/completions");
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "secret-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "redirect_blocked");
        assert_eq!(redirect.calls(), 1);
    }

    #[tokio::test]
    async fn rejects_an_oversized_non_streaming_response() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/v1/chat/completions");
            then.status(200)
                .header("content-type", "application/json")
                .body("x".repeat(MAX_RESPONSE_BYTES + 1));
        });

        let error = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "secret-key",
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, "response_too_large");
    }

    #[tokio::test]
    async fn connection_test_uses_the_streaming_transport() {
        let server = MockServer::start();
        let completion = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .header("authorization", "Bearer test-secret")
                .body_includes("\"stream\":true");
            then.status(200)
                .header("content-type", "text/event-stream")
                .header("x-request-id", "provider-probe-42")
                .body(concat!(
                    "data: {\"model\":\"vision-stream\",\"choices\":[{\"delta\":{\"content\":\"OK\"}}]}\n\n",
                    "data: [DONE]\n\n"
                ));
        });

        let status = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
        )
        .await
        .unwrap();

        completion.assert_calls(1);
        assert_eq!(status.model, "vision-stream");
        assert_eq!(
            status.provider_request_id.as_deref(),
            Some("provider-probe-42")
        );
    }

    #[tokio::test]
    async fn connection_test_falls_back_when_streaming_is_unsupported() {
        let server = MockServer::start();
        let streaming = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_includes("\"stream\":true");
            then.status(422);
        });
        let ordinary = server.mock(|when, then| {
            when.method(POST)
                .path("/v1/chat/completions")
                .body_excludes("\"stream\"");
            then.status(200)
                .header("content-type", "application/json")
                .json_body(json!({
                    "model": "vision-fallback",
                    "choices": [{ "message": { "content": "OK" } }]
                }));
        });

        let status = test_connection(
            &build_client().unwrap(),
            &settings(server.url("/v1")),
            "test-secret",
        )
        .await
        .unwrap();

        streaming.assert_calls(1);
        ordinary.assert_calls(1);
        assert_eq!(status.model, "vision-fallback");
    }

    #[test]
    fn stream_fallback_statuses_are_explicit() {
        assert!(is_stream_compatibility_status(StatusCode::BAD_REQUEST));
        assert!(is_stream_compatibility_status(
            StatusCode::UNPROCESSABLE_ENTITY
        ));
        assert!(!is_stream_compatibility_status(StatusCode::UNAUTHORIZED));
        assert!(!is_stream_compatibility_status(
            StatusCode::TOO_MANY_REQUESTS
        ));
    }

    #[test]
    fn parse_error_preserves_raw_model_response() {
        let raw = "not json";
        let error = parse_result(raw)
            .map_err(|error| error.with_diagnostic_payload(raw))
            .unwrap_err();
        assert_eq!(error.diagnostic_payload.as_deref(), Some(raw));
    }
}
