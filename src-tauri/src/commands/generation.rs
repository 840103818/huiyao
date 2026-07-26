#[tauri::command]
async fn test_connection(
    state: State<'_, AppState>,
    input: SettingsInput,
) -> Result<ConnectionStatus, CommandError> {
    let _permit = state
        .request_slots
        .try_acquire()
        .map_err(|_| CommandError::new("request_busy", "当前模型请求较多，请稍后重试"))?;
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.apply_input(&input);
    api::validate_base_url_security(&settings.base_url, input.insecure_http_origin.as_deref())?;
    settings.insecure_http_origin = api::insecure_http_origin(&settings.base_url)?;
    let key = input
        .api_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or(read_api_key()?);
    if key.chars().count() > 4_096 {
        return Err(CommandError::new(
            "api_key_too_long",
            "API Key 长度超过限制",
        ));
    }
    let interaction_id = runtime_log::correlation_id();
    let started = Instant::now();
    state.log(
        LogLevel::Info,
        "model",
        "connection_test_started",
        "开始测试模型连接",
        json!({
            "interactionId": interaction_id,
            "baseUrl": sanitize_base_url(&settings.base_url),
            "model": settings.model,
            "timeoutSeconds": settings.timeout_seconds,
            "credentialPresent": !key.is_empty(),
        }),
    );
    match api::test_connection(&state.http_client, &settings, &key).await {
        Ok(status) => {
            state.log(
                LogLevel::Info,
                "model",
                "connection_test_succeeded",
                "模型连接测试成功",
                json!({
                    "interactionId": interaction_id,
                    "model": status.model,
                    "providerRequestId": status.provider_request_id,
                    "elapsedMs": started.elapsed().as_millis() as u64,
                }),
            );
            Ok(status)
        }
        Err(error) => {
            let error = state.attach_diagnostic(&interaction_id, error);
            state.log(
                LogLevel::Error,
                "model",
                "connection_test_failed",
                "模型连接测试失败",
                json!({
                    "interactionId": interaction_id,
                    "errorCode": error.code,
                    "errorMessage": diagnostic_error_message(&error),
                    "providerRequestId": error.provider_request_id,
                    "diagnosticId": error.diagnostic_id,
                    "elapsedMs": started.elapsed().as_millis() as u64,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn reverse_prompt_stream(
    state: State<'_, AppState>,
    request: ReverseRequest,
    on_event: Channel<ReverseStreamEvent>,
) -> Result<ReverseResult, CommandError> {
    let _permit = state
        .request_slots
        .try_acquire()
        .map_err(|_| CommandError::new("request_busy", "当前模型请求较多，请稍后重试"))?;
    let settings = store::read_settings(&state.settings_path())?;
    let api_key = read_api_key()?;
    let interaction_id = runtime_log::correlation_id();
    let cancellation = CancellationToken::new();
    state
        .cancellations
        .lock()
        .map_err(|_| CommandError::new("request_lock", "请求状态暂时不可用"))?
        .insert(interaction_id.clone(), cancellation.clone());
    let started = Instant::now();
    if on_event
        .send(ReverseStreamEvent::Started {
            interaction_id: interaction_id.clone(),
        })
        .is_err()
    {
        cancellation.cancel();
        if let Ok(mut requests) = state.cancellations.lock() {
            requests.remove(&interaction_id);
        }
        return Err(CommandError::new(
            "channel_closed",
            "页面已关闭，模型请求已取消",
        ));
    }
    state.log(
        LogLevel::Info,
        "model",
        "request_started",
        "开始大模型反推请求",
        json!({
            "interactionId": interaction_id,
            "baseUrl": sanitize_base_url(&settings.base_url),
            "model": settings.model,
            "imagePayloadChars": request.image_data_url.len(),
            "requirementsChars": request.requirements.chars().count(),
            "outputLanguage": output_language_name(request.output_language),
            "detailLevel": detail_level_name(request.detail_level),
            "timeoutSeconds": settings.timeout_seconds,
        }),
    );
    let stream_channel = on_event.clone();
    let stream_cancellation = cancellation.clone();
    let response = api::reverse_prompt_stream(
        &state.http_client,
        &settings,
        &api_key,
        &request,
        &cancellation,
        move |event| match event {
            api::ApiStreamEvent::Delta(content) => {
                if stream_channel
                    .send(ReverseStreamEvent::Delta { content })
                    .is_err()
                {
                    stream_cancellation.cancel();
                }
            }
            api::ApiStreamEvent::Fallback => {
                if stream_channel
                    .send(ReverseStreamEvent::Fallback {
                        reason: "provider_unsupported".into(),
                    })
                    .is_err()
                {
                    stream_cancellation.cancel();
                }
            }
        },
    )
    .await;
    if let Ok(mut requests) = state.cancellations.lock() {
        requests.remove(&interaction_id);
    }

    match response {
        Ok(outcome) => {
            if let Some(first_token_ms) = outcome.first_token_ms {
                state.log(
                    LogLevel::Info,
                    "model",
                    "stream_first_chunk",
                    "收到模型首个流式内容",
                    json!({
                        "interactionId": interaction_id,
                        "firstTokenMs": first_token_ms,
                    }),
                );
            }
            if outcome.used_fallback {
                state.log(
                    LogLevel::Warn,
                    "model",
                    "stream_fallback",
                    "模型服务已切换为兼容请求模式",
                    json!({ "interactionId": interaction_id }),
                );
            }
            let result = outcome.result;
            state.log(
                LogLevel::Info,
                "model",
                "request_succeeded",
                "大模型反推请求完成",
                json!({
                    "interactionId": interaction_id,
                    "model": result.metadata.model,
                    "totalTokens": result.metadata.total_tokens,
                    "providerRequestId": result.metadata.provider_request_id,
                    "elapsedMs": result.metadata.elapsed_ms,
                    "wallTimeMs": started.elapsed().as_millis() as u64,
                    "transport": if outcome.used_fallback { "fallback" } else { "stream" },
                }),
            );
            Ok(result)
        }
        Err(error) => {
            let error = state.attach_diagnostic(&interaction_id, error);
            let cancelled = error.code == "cancelled";
            state.log(
                if cancelled {
                    LogLevel::Warn
                } else {
                    LogLevel::Error
                },
                "model",
                if cancelled {
                    "request_cancelled"
                } else {
                    "request_failed"
                },
                if cancelled {
                    "大模型反推请求已停止"
                } else {
                    "大模型反推请求失败"
                },
                json!({
                    "interactionId": interaction_id,
                    "errorCode": error.code,
                    "errorMessage": diagnostic_error_message(&error),
                    "providerRequestId": error.provider_request_id,
                    "diagnosticAvailable": error.diagnostic_id.is_some(),
                    "diagnosticId": error.diagnostic_id,
                    "wallTimeMs": started.elapsed().as_millis() as u64,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn optimize_prompt_stream(
    state: State<'_, AppState>,
    request: PromptOptimizationRequest,
    on_event: Channel<ReverseStreamEvent>,
) -> Result<PromptOptimizationOutput, CommandError> {
    let _permit = state
        .request_slots
        .try_acquire()
        .map_err(|_| CommandError::new("request_busy", "当前模型请求较多，请稍后重试"))?;
    let settings = store::read_settings(&state.settings_path())?;
    let api_key = read_api_key()?;
    let interaction_id = runtime_log::correlation_id();
    let cancellation = CancellationToken::new();
    state
        .cancellations
        .lock()
        .map_err(|_| CommandError::new("request_lock", "请求状态暂时不可用"))?
        .insert(interaction_id.clone(), cancellation.clone());
    let started = Instant::now();
    if on_event
        .send(ReverseStreamEvent::Started {
            interaction_id: interaction_id.clone(),
        })
        .is_err()
    {
        cancellation.cancel();
        if let Ok(mut requests) = state.cancellations.lock() {
            requests.remove(&interaction_id);
        }
        return Err(CommandError::new(
            "channel_closed",
            "页面已关闭，模型请求已取消",
        ));
    }
    state.log(
        LogLevel::Info,
        "model",
        "prompt_optimization_started",
        "开始提示词优化请求",
        json!({
            "interactionId": interaction_id,
            "model": settings.model,
            "target": optimization_target_name(request.target),
            "requirementsChars": request.requirements.chars().count(),
            "sourceZhChars": request.source_prompts.zh.chars().count(),
            "sourceEnChars": request.source_prompts.en.chars().count(),
            "aspectRatioPresent": request.aspect_ratio.is_some(),
        }),
    );
    let stream_channel = on_event.clone();
    let stream_cancellation = cancellation.clone();
    let response = api::optimize_prompt_stream(
        &state.http_client,
        &settings,
        &api_key,
        &request,
        &cancellation,
        move |event| match event {
            api::ApiStreamEvent::Delta(content) => {
                if stream_channel
                    .send(ReverseStreamEvent::Delta { content })
                    .is_err()
                {
                    stream_cancellation.cancel();
                }
            }
            api::ApiStreamEvent::Fallback => {
                if stream_channel
                    .send(ReverseStreamEvent::Fallback {
                        reason: "provider_unsupported".into(),
                    })
                    .is_err()
                {
                    stream_cancellation.cancel();
                }
            }
        },
    )
    .await;
    if let Ok(mut requests) = state.cancellations.lock() {
        requests.remove(&interaction_id);
    }
    match response {
        Ok(outcome) => {
            state.log(
                LogLevel::Info,
                "model",
                "prompt_optimization_succeeded",
                "提示词优化请求完成",
                json!({
                    "interactionId": interaction_id,
                    "target": optimization_target_name(request.target),
                    "model": outcome.result.metadata.model,
                    "totalTokens": outcome.result.metadata.total_tokens,
                    "providerRequestId": outcome.result.metadata.provider_request_id,
                    "firstTokenMs": outcome.first_token_ms,
                    "elapsedMs": outcome.result.metadata.elapsed_ms,
                    "transport": if outcome.used_fallback { "fallback" } else { "stream" },
                }),
            );
            Ok(outcome.result)
        }
        Err(error) => {
            let error = state.attach_diagnostic(&interaction_id, error);
            state.log(
                if error.code == "cancelled" {
                    LogLevel::Warn
                } else {
                    LogLevel::Error
                },
                "model",
                if error.code == "cancelled" {
                    "prompt_optimization_cancelled"
                } else {
                    "prompt_optimization_failed"
                },
                if error.code == "cancelled" {
                    "提示词优化已停止"
                } else {
                    "提示词优化失败"
                },
                json!({
                    "interactionId": interaction_id,
                    "target": optimization_target_name(request.target),
                    "errorCode": error.code,
                    "providerRequestId": error.provider_request_id,
                    "diagnosticId": error.diagnostic_id,
                    "wallTimeMs": started.elapsed().as_millis() as u64,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
fn cancel_reverse_prompt(
    state: State<'_, AppState>,
    interaction_id: String,
) -> Result<bool, CommandError> {
    let requests = state
        .cancellations
        .lock()
        .map_err(|_| CommandError::new("request_lock", "请求状态暂时不可用"))?;
    if let Some(token) = requests.get(&interaction_id) {
        token.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OriginalUploadMetadata {
    file_name: String,
    mime_type: String,
}

#[tauri::command]
async fn stage_original_image(
    state: State<'_, AppState>,
    request: IpcRequest<'_>,
) -> Result<OriginalImageStage, CommandError> {
    let body = match request.body() {
        InvokeBody::Raw(value) => value.as_slice(),
        _ => {
            return Err(CommandError::new(
                "original_upload_invalid",
                "原图必须通过二进制通道上传",
            ))
        }
    };
    if body.len() < 8
        || body.len() > MAX_ORIGINAL_UPLOAD_BODY_BYTES
        || &body[..4] != ORIGINAL_UPLOAD_MAGIC
    {
        return Err(CommandError::new(
            "original_upload_invalid",
            "原图上传数据格式无效",
        ));
    }
    let metadata_len = u32::from_be_bytes(body[4..8].try_into().unwrap()) as usize;
    if metadata_len == 0 || metadata_len > 2_048 || body.len() < 8 + metadata_len {
        return Err(CommandError::new(
            "original_upload_invalid",
            "原图上传元数据无效",
        ));
    }
    let metadata: OriginalUploadMetadata = serde_json::from_slice(&body[8..8 + metadata_len])
        .map_err(|_| CommandError::new("original_upload_invalid", "原图上传元数据无效"))?;
    let bytes = body[8 + metadata_len..].to_vec();
    let key = original_key_for_staging(&state)?;
    let staging_path = state.original_staging_path();
    let storage_lock = state.storage_lock.clone();
    let file_name = metadata.file_name.trim().to_owned();
    let mime_type = metadata.mime_type.trim().to_owned();
    let byte_count = bytes.len();
    let staged = tauri::async_runtime::spawn_blocking(move || {
        let _guard = storage_lock
            .lock()
            .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
        original_image::stage(&staging_path, &bytes, &file_name, &mime_type, &key)
    })
    .await
    .map_err(|error| CommandError::new("original_stage", error.to_string()))??;
    state.log(
        LogLevel::Info,
        "storage",
        "original_staged",
        "原图已加密暂存",
        json!({ "bytes": byte_count, "mimeType": metadata.mime_type }),
    );
    Ok(staged)
}

