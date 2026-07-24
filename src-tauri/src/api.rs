use std::time::{Duration, Instant};

use chrono::Utc;
use futures_util::StreamExt;
use reqwest::{Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::models::{
    CommandError, ConnectionStatus, DetailLevel, OutputLanguage, ResultMetadata, ReverseRequest,
    ReverseResult, SettingsFile,
};

const SYSTEM_PROMPT: &str = r##"你是专业的 AI 图片提示词逆向分析师。根据用户提供的图片，提炼可复用的生成指令。
只返回一个合法 JSON 对象，不要使用 Markdown，不要补充解释。结构必须严格为：
{
  "analysis": {
    "subject": "主体与关键视觉元素",
    "composition": "构图、视角与空间关系",
    "lighting": "光源方向、软硬与氛围",
    "colors": "主色、辅色与色彩关系",
    "palette": ["#000000", "#FFFFFF"],
    "materials": "材质、纹理与表面特征",
    "style": "媒介、审美与整体风格",
    "camera": "景别、焦段、景深与可推断的镜头语言"
  },
  "prompts": { "zh": "完整中文提示词", "en": "Complete English prompt" }
}
准确描述图片中可见事实，不虚构品牌、精确拍摄参数或不可见信息。提示词应可直接用于图像生成。"##;

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

enum StreamAttemptError {
    Unsupported,
    Fatal(CommandError),
}

pub fn endpoint_from_base_url(base_url: &str) -> Result<String, CommandError> {
    let normalized = base_url.trim().trim_end_matches('/');
    if normalized.is_empty()
        || !(normalized.starts_with("https://") || normalized.starts_with("http://"))
    {
        return Err(CommandError::new(
            "invalid_base_url",
            "Base URL 必须以 http:// 或 https:// 开头",
        ));
    }
    if normalized.ends_with("/chat/completions") {
        Ok(normalized.to_owned())
    } else {
        Ok(format!("{normalized}/chat/completions"))
    }
}

pub fn build_messages(request: &ReverseRequest) -> Result<Vec<Value>, CommandError> {
    let image = request
        .image_data_url
        .trim()
        .strip_prefix("data:image/")
        .map(|_| request.image_data_url.trim())
        .ok_or_else(|| CommandError::new("missing_image", "请选择需要分析的图片"))?;
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
    let client = build_client(settings.timeout_seconds)?;

    match stream_attempt(
        &client,
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
        &client,
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
        &client,
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

pub async fn test_connection(
    settings: &SettingsFile,
    api_key: &str,
) -> Result<ConnectionStatus, CommandError> {
    validate_service_settings(settings, api_key)?;
    let messages = vec![
        json!({ "role": "system", "content": "只回复 OK" }),
        json!({ "role": "user", "content": "测试连接" }),
    ];
    let endpoint = endpoint_from_base_url(&settings.base_url)?;
    let client = build_client(settings.timeout_seconds)?;
    match send_streaming_connection_probe(&client, &endpoint, settings, api_key, &messages).await {
        Ok(status) => Ok(status),
        Err(StreamAttemptError::Fatal(error)) => Err(error),
        Err(StreamAttemptError::Unsupported) => {
            let response =
                send_chat_with_client(&client, &endpoint, settings, api_key, &messages, None)
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
        let body = response
            .text()
            .await
            .map_err(map_response_read_error)
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
        let body = response
            .text()
            .await
            .map_err(map_response_read_error)
            .map_err(|error| {
                StreamAttemptError::Fatal(error.with_provider_request_id(request_id.clone()))
            })?;
        let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
            StreamAttemptError::Fatal(
                CommandError::new("invalid_response", "服务返回了无法识别的响应格式")
                    .with_provider_request_id(request_id.clone()),
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
    while let Some(chunk) = body_stream.next().await {
        let chunk = chunk
            .map_err(map_network_error)
            .map_err(StreamAttemptError::Fatal)?;
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
                return Err(StreamAttemptError::Fatal(CommandError::new(
                    "stream_error",
                    message,
                )));
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
        let body = read_response_text(response, cancellation)
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
        let body = read_response_text(response, cancellation)
            .await
            .map_err(StreamAttemptError::Fatal)?;
        let mut parsed: ChatResponse = serde_json::from_str(&body).map_err(|_| {
            StreamAttemptError::Fatal(CommandError::new(
                "invalid_response",
                "服务返回了无法识别的响应格式",
            ))
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

    while !done {
        let next = tokio::select! {
            _ = cancellation.cancelled() => return Err(StreamAttemptError::Fatal(cancelled_error())),
            value = body_stream.next() => value,
        };
        let Some(chunk) = next else { break };
        let chunk = chunk
            .map_err(map_network_error)
            .map_err(StreamAttemptError::Fatal)?;
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

    let mut result = parse_result(&content)
        .map_err(|error| StreamAttemptError::Fatal(error.with_raw_response(content.clone())))?;
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
        return Err(CommandError::new("stream_error", message));
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
            if first_token_ms.is_none() {
                *first_token_ms = Some(started.elapsed().as_millis() as u64);
            }
            content.push_str(&delta);
            on_event(ApiStreamEvent::Delta(delta));
        }
    }
    Ok(())
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
        Some(token) => read_response_text(response, token).await?,
        None => response.text().await.map_err(map_response_read_error)?,
    };
    if !status.is_success() {
        return Err(map_http_error(status, &body).with_provider_request_id(request_id));
    }
    let mut parsed: ChatResponse = serde_json::from_str(&body)
        .map_err(|_| CommandError::new("invalid_response", "服务返回了无法识别的响应格式"))?;
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
) -> Result<String, CommandError> {
    tokio::select! {
        _ = cancellation.cancelled() => Err(cancelled_error()),
        body = response.text() => body.map_err(map_response_read_error),
    }
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
    let mut result = parse_result(content).map_err(|error| error.with_raw_response(content))?;
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

fn build_client(timeout_seconds: u64) -> Result<reqwest::Client, CommandError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_seconds.clamp(10, 300)))
        .build()
        .map_err(|error| CommandError::new("client_error", error.to_string()))
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
    Ok(())
}

fn provider_request_id(response: &Response) -> Option<String> {
    ["x-request-id", "request-id", "openai-request-id"]
        .iter()
        .find_map(|name| response.headers().get(*name))
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
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

fn map_http_error(status: StatusCode, body: &str) -> CommandError {
    let provider_message = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.pointer("/error/message")?.as_str().map(str::to_owned));
    let fallback = match status.as_u16() {
        401 | 403 => "API Key 无效或没有访问该模型的权限",
        404 => "接口或模型不存在，请检查 Base URL 和模型名称",
        413 => "图片过大，请缩小输入后重试",
        429 => "请求过于频繁或额度不足，请稍后重试",
        500..=599 => "模型服务暂时不可用，请稍后重试",
        _ => "模型服务返回错误",
    };
    CommandError::new(
        format!("http_{}", status.as_u16()),
        provider_message.unwrap_or_else(|| fallback.into()),
    )
}

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, CommandError> {
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
    use crate::models::{DetailLevel, OutputLanguage, ThemeMode};
    use httpmock::prelude::*;

    fn settings(base_url: String) -> SettingsFile {
        SettingsFile {
            base_url,
            model: "vision-test".into(),
            timeout_seconds: 10,
            theme: ThemeMode::System,
        }
    }

    fn image_request() -> ReverseRequest {
        ReverseRequest {
            image_data_url: "data:image/png;base64,aGVsbG8=".into(),
            requirements: String::new(),
            output_language: OutputLanguage::Bilingual,
            detail_level: DetailLevel::Standard,
        }
    }

    #[test]
    fn endpoint_normalizes_base_url() {
        assert_eq!(
            endpoint_from_base_url("https://api.example.com/v1/").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
        assert!(endpoint_from_base_url("api.example.com").is_err());
    }

    #[test]
    fn parses_fenced_model_json() {
        let content = r#"```json
        {"analysis":{"subject":"watch"},"prompts":{"zh":"中文","en":"English"}}
        ```"#;
        let result = parse_result(content).unwrap();
        assert_eq!(result.analysis.subject, "watch");
        assert_eq!(result.prompts.en, "English");
    }

    #[test]
    fn image_mode_rejects_empty_input() {
        let mut request = image_request();
        request.image_data_url.clear();
        assert_eq!(build_messages(&request).unwrap_err().code, "missing_image");
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
        let error = test_connection(&settings(server.url("/v1")), "bad-key")
            .await
            .unwrap_err();
        assert_eq!(error.code, "http_401");
        assert_eq!(error.message, "invalid key");
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

        let status = test_connection(&settings(server.url("/v1")), "test-secret")
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

        let status = test_connection(&settings(server.url("/v1")), "test-secret")
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
            .map_err(|error| error.with_raw_response(raw))
            .unwrap_err();
        assert_eq!(error.raw_response.as_deref(), Some(raw));
    }
}
