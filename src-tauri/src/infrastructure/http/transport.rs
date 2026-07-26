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

