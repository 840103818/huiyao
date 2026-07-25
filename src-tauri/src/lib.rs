mod api;
#[path = "diagnostic.rs"]
mod diagnostics;
mod models;
mod original_image;
mod runtime_log;
mod store;

use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Local;
use keyring::Entry;
use models::{
    CaptureMetadata, CommandError, ConnectionStatus, HistoryItem, OriginalImageCommit,
    OriginalImageStage, OriginalStorageStats, PromptOptimizationOutput, PromptOptimizationRequest,
    PromptOptimizationTarget, PublicSettings, ResultExportFormat, ReverseRequest, ReverseResult,
    ReverseStreamEvent, SettingsFile, SettingsInput, ThemeMode, WorkspacePreferences,
};
use runtime_log::{LogLevel, RuntimeLogEntry};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{
    ipc::{Channel, InvokeBody, Request as IpcRequest, Response as IpcResponse},
    AppHandle, Manager, State,
};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

const KEYRING_SERVICE: &str = "com.huiyao.studio";
const LEGACY_KEYRING_SERVICE: &str = "com.reverseprompt.studio";
const KEYRING_USER: &str = "openai-compatible-api-key";
const ORIGINAL_KEYRING_USER: &str = "original-image-encryption-key-v1";
const LEGACY_IDENTIFIER: &str = "com.reverseprompt.studio";
const ORIGINAL_UPLOAD_MAGIC: &[u8; 4] = b"HYUP";
const MAX_ORIGINAL_UPLOAD_BODY_BYTES: usize = 20 * 1024 * 1024 + 2_056;

struct AppState {
    app_data_dir: PathBuf,
    log_lock: Mutex<()>,
    settings_lock: Mutex<()>,
    storage_lock: Arc<Mutex<()>>,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
    diagnostics: Mutex<diagnostics::DiagnosticCache>,
    http_client: reqwest::Client,
    request_slots: Semaphore,
}

fn public_settings(settings: SettingsFile, has_api_key: bool) -> PublicSettings {
    PublicSettings {
        base_url: settings.base_url,
        model: settings.model,
        timeout_seconds: settings.timeout_seconds,
        theme: settings.theme,
        has_api_key,
        auto_save_history: settings.auto_save_history,
        insecure_http_origin: settings.insecure_http_origin,
        workspace: settings.workspace,
    }
}

impl AppState {
    fn settings_path(&self) -> PathBuf {
        self.app_data_dir.join("settings.json")
    }

    fn history_path(&self) -> PathBuf {
        self.app_data_dir.join("history.json")
    }

    fn log_path(&self) -> PathBuf {
        self.app_data_dir.join("runtime.jsonl")
    }

    fn originals_path(&self) -> PathBuf {
        self.app_data_dir.join("originals")
    }

    fn original_staging_path(&self) -> PathBuf {
        self.app_data_dir.join("original-staging")
    }

    fn log(&self, level: LogLevel, category: &str, event: &str, message: &str, details: Value) {
        if let Ok(_guard) = self.log_lock.lock() {
            let _ = runtime_log::append(&self.log_path(), level, category, event, message, details);
        }
    }

    fn attach_diagnostic(&self, interaction_id: &str, mut error: CommandError) -> CommandError {
        error.interaction_id = Some(interaction_id.to_owned());
        if let Ok(mut cache) = self.diagnostics.lock() {
            error.diagnostic_id = cache.insert(interaction_id, &error);
        }
        error.diagnostic_payload = None;
        error
    }

    fn cancel_all_requests(&self) -> usize {
        let Ok(mut requests) = self.cancellations.lock() else {
            return 0;
        };
        let count = requests.len();
        for cancellation in requests.values() {
            cancellation.cancel();
        }
        requests.clear();
        count
    }
}

fn keyring_entry_for_user(service: &str, user: &str) -> Result<Entry, CommandError> {
    Entry::new(service, user)
        .map_err(|error| CommandError::new("keychain_access", error.to_string()))
}

fn keyring_entry(service: &str) -> Result<Entry, CommandError> {
    keyring_entry_for_user(service, KEYRING_USER)
}

fn read_original_key() -> Result<Option<[u8; 32]>, CommandError> {
    let entry = keyring_entry_for_user(KEYRING_SERVICE, ORIGINAL_KEYRING_USER)?;
    let encoded = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(CommandError::new("original_key_read", error.to_string())),
    };
    let decoded = BASE64
        .decode(encoded)
        .map_err(|_| CommandError::new("original_key_invalid", "原图加密密钥格式无效"))?;
    decoded
        .try_into()
        .map(Some)
        .map_err(|_| CommandError::new("original_key_invalid", "原图加密密钥长度无效"))
}

fn original_key_for_staging(state: &AppState) -> Result<[u8; 32], CommandError> {
    if let Some(key) = read_original_key()? {
        return Ok(key);
    }
    if original_image::has_originals(&state.originals_path())
        || original_image::has_originals(&state.original_staging_path())
    {
        return Err(CommandError::new(
            "original_key_missing",
            "检测到已加密原图但钥匙串密钥缺失，无法继续保存原图",
        ));
    }
    let key = original_image::generate_key();
    keyring_entry_for_user(KEYRING_SERVICE, ORIGINAL_KEYRING_USER)?
        .set_password(&BASE64.encode(key))
        .map_err(|error| CommandError::new("original_key_write", error.to_string()))?;
    Ok(key)
}

fn original_key_for_reading() -> Result<[u8; 32], CommandError> {
    read_original_key()?.ok_or_else(|| {
        CommandError::new(
            "original_key_missing",
            "原图加密密钥已丢失，无法解密；历史分析结果仍可继续使用",
        )
    })
}

fn read_api_key() -> Result<String, CommandError> {
    match keyring_entry(KEYRING_SERVICE)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(CommandError::new("keychain_read", error.to_string())),
    }
}

fn write_api_key(value: Option<&str>) -> Result<(), CommandError> {
    let entry = keyring_entry(KEYRING_SERVICE)?;
    match value {
        Some(value) => entry
            .set_password(value)
            .map_err(|error| CommandError::new("keychain_write", error.to_string())),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(CommandError::new("keychain_delete", error.to_string())),
        },
    }
}

fn migrate_legacy_keychain() -> Result<bool, CommandError> {
    let current = keyring_entry(KEYRING_SERVICE)?;
    match current.get_password() {
        Ok(_) => return Ok(false),
        Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(CommandError::new("keychain_read", error.to_string())),
    }
    let legacy = keyring_entry(LEGACY_KEYRING_SERVICE)?;
    match legacy.get_password() {
        Ok(value) if !value.is_empty() => {
            current
                .set_password(&value)
                .map_err(|error| CommandError::new("keychain_write", error.to_string()))?;
            Ok(true)
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(CommandError::new("keychain_read", error.to_string())),
    }
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<PublicSettings, CommandError> {
    let settings = store::read_settings(&state.settings_path())?;
    let has_api_key = !read_api_key()?.is_empty();
    Ok(public_settings(settings, has_api_key))
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    input: SettingsInput,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let previous_settings = store::read_settings(&state.settings_path())?;
    let mut settings = previous_settings.clone();
    settings.apply_input(&input);
    api::endpoint_from_base_url(&settings.base_url)?;
    let required_insecure_origin = api::insecure_http_origin(&settings.base_url)?;
    api::validate_base_url_security(&settings.base_url, input.insecure_http_origin.as_deref())?;
    settings.insecure_http_origin = required_insecure_origin;
    if settings.model.is_empty() || settings.model.chars().count() > 200 {
        return Err(CommandError::new("missing_model", "请填写模型名称"));
    }
    let previous_key = read_api_key()?;
    if input
        .api_key
        .as_deref()
        .is_some_and(|value| value.chars().count() > 4_096)
    {
        return Err(CommandError::new(
            "api_key_too_long",
            "API Key 长度超过限制",
        ));
    }
    let key_update = if input.clear_api_key {
        Some(None)
    } else {
        input
            .api_key
            .as_deref()
            .filter(|key| !key.trim().is_empty())
            .map(|key| Some(key.trim().to_owned()))
    };
    if let Some(value) = key_update.as_ref() {
        write_api_key(value.as_deref())?;
    }
    if let Err(error) = store::write_settings(&state.settings_path(), &settings) {
        if key_update.is_some() {
            let rollback = (!previous_key.is_empty()).then_some(previous_key.as_str());
            if write_api_key(rollback).is_err() {
                return Err(CommandError::new(
                    "settings_transaction_failed",
                    "设置保存失败，且钥匙串回滚未完成，请重新检查配置",
                ));
            }
        }
        return Err(error);
    }
    let has_api_key = key_update
        .as_ref()
        .map(|value| value.is_some())
        .unwrap_or(!previous_key.is_empty());
    let public = public_settings(settings, has_api_key);
    state.log(
        LogLevel::Info,
        "system",
        "settings_saved",
        "模型服务设置已保存",
        json!({
            "baseUrl": sanitize_base_url(&public.base_url),
            "model": public.model,
            "timeoutSeconds": public.timeout_seconds,
            "theme": public.theme,
            "hasApiKey": public.has_api_key,
        }),
    );
    Ok(public)
}

#[tauri::command]
fn save_theme(
    state: State<'_, AppState>,
    theme: ThemeMode,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.theme = theme;
    store::write_settings(&state.settings_path(), &settings)?;
    let public = public_settings(settings, !read_api_key()?.is_empty());
    state.log(
        LogLevel::Info,
        "system",
        "theme_saved",
        "外观主题已切换",
        json!({ "theme": public.theme }),
    );
    Ok(public)
}

#[tauri::command]
fn save_workspace_preferences(
    state: State<'_, AppState>,
    preferences: WorkspacePreferences,
) -> Result<PublicSettings, CommandError> {
    let _guard = state
        .settings_lock
        .lock()
        .map_err(|_| CommandError::new("settings_lock", "设置暂时不可用"))?;
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.workspace = preferences.normalized();
    store::write_settings(&state.settings_path(), &settings)?;
    Ok(public_settings(settings, !read_api_key()?.is_empty()))
}

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

#[tauri::command]
fn discard_original_stage(
    state: State<'_, AppState>,
    staging_id: String,
) -> Result<(), CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
    original_image::discard_stage(&state.original_staging_path(), &staging_id)
}

#[tauri::command]
fn load_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "历史记录暂时不可用"))?;
    store::read_history(&state.history_path())
}

#[tauri::command]
fn save_history(
    state: State<'_, AppState>,
    items: Vec<HistoryItem>,
    original_commit: Option<OriginalImageCommit>,
) -> Result<(), CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "历史记录暂时不可用"))?;
    let count = items.len().min(50);
    let committed = if let Some(commit) = original_commit.as_ref() {
        let item = items
            .iter()
            .find(|item| item.id == commit.history_id)
            .ok_or_else(|| {
                CommandError::new("original_commit_invalid", "未找到原图对应的历史任务")
            })?;
        let info = item.original_image.as_ref().ok_or_else(|| {
            CommandError::new("original_commit_invalid", "历史任务缺少原图元数据")
        })?;
        let key = original_key_for_reading()?;
        let bytes =
            original_image::load_stage(&state.original_staging_path(), &commit.staging_id, &key)?;
        original_image::validate_staged_source(
            &bytes,
            &info.file_name,
            &info.mime_type,
            info.size,
        )?;
        original_image::commit(
            &state.original_staging_path(),
            &state.originals_path(),
            &commit.staging_id,
            &commit.history_id,
        )?;
        Some(commit)
    } else {
        None
    };
    match store::write_history(&state.history_path(), &items) {
        Ok(()) => {
            let referenced = items
                .iter()
                .filter(|item| item.original_image.is_some())
                .map(|item| item.id.clone())
                .collect::<Vec<_>>();
            if let Err(error) =
                original_image::remove_unreferenced(&state.originals_path(), &referenced)
            {
                state.log(
                    LogLevel::Warn,
                    "storage",
                    "original_cleanup_failed",
                    "未引用原图清理失败",
                    json!({ "errorCode": error.code }),
                );
            }
            state.log(
                LogLevel::Info,
                "storage",
                "history_saved",
                "历史记录已写入本地",
                json!({ "count": count }),
            );
            Ok(())
        }
        Err(error) => {
            if let Some(commit) = committed {
                original_image::rollback_commit(
                    &state.original_staging_path(),
                    &state.originals_path(),
                    &commit.staging_id,
                    &commit.history_id,
                );
            }
            state.log(
                LogLevel::Error,
                "storage",
                "history_save_failed",
                "历史记录写入失败",
                json!({ "errorCode": error.code, "errorMessage": error.message }),
            );
            Err(error)
        }
    }
}

fn history_original_info(
    history_path: &Path,
    history_id: &str,
) -> Result<models::OriginalImageInfo, CommandError> {
    store::read_history(history_path)?
        .into_iter()
        .find(|item| item.id == history_id)
        .and_then(|item| item.original_image)
        .ok_or_else(|| CommandError::new("original_missing", "该历史任务未保留原图"))
}

#[tauri::command]
async fn load_original_image(
    state: State<'_, AppState>,
    history_id: String,
) -> Result<IpcResponse, CommandError> {
    let storage_lock = state.storage_lock.clone();
    let history_path = state.history_path();
    let originals_path = state.originals_path();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let _guard = storage_lock
            .lock()
            .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
        history_original_info(&history_path, &history_id)?;
        let key = original_key_for_reading()?;
        original_image::load(&originals_path, &history_id, &key)
    })
    .await
    .map_err(|error| CommandError::new("original_read", error.to_string()))?;
    match loaded {
        Ok(bytes) => Ok(IpcResponse::new(bytes)),
        Err(error) => {
            let interaction_id = runtime_log::correlation_id();
            let error = state.attach_diagnostic(&interaction_id, error);
            state.log(
                LogLevel::Error,
                "storage",
                "original_load_failed",
                "历史原图读取失败",
                json!({
                    "interactionId": interaction_id,
                    "errorCode": error.code,
                    "diagnosticId": error.diagnostic_id,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
async fn export_original_image(
    app: AppHandle,
    state: State<'_, AppState>,
    history_id: String,
) -> Result<bool, CommandError> {
    let storage_lock = state.storage_lock.clone();
    let history_path = state.history_path();
    let originals_path = state.originals_path();
    let (info, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let _guard = storage_lock
            .lock()
            .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
        let info = history_original_info(&history_path, &history_id)?;
        let key = original_key_for_reading()?;
        let bytes = original_image::load(&originals_path, &history_id, &key)?;
        Ok::<_, CommandError>((info, bytes))
    })
    .await
    .map_err(|error| CommandError::new("original_read", error.to_string()))??;
    let extension = match info.mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => return Err(CommandError::new("original_invalid", "原图格式无效")),
    };
    export_with_native_dialog(
        &app,
        &state,
        &info.file_name,
        "原始图片",
        &[extension],
        bytes,
        "original_image",
    )
    .await
}

#[tauri::command]
fn get_original_storage_stats(
    state: State<'_, AppState>,
) -> Result<OriginalStorageStats, CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
    original_image::stats(&state.originals_path())
}

#[tauri::command]
fn remove_history_original(
    state: State<'_, AppState>,
    history_id: String,
) -> Result<(), CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
    let mut items = store::read_history(&state.history_path())?;
    let item = items
        .iter_mut()
        .find(|item| item.id == history_id)
        .ok_or_else(|| CommandError::new("history_missing", "历史任务不存在"))?;
    item.original_image = None;
    let quarantine = original_image::quarantine_original(&state.originals_path(), &history_id)?;
    if let Err(error) = store::write_history(&state.history_path(), &items) {
        original_image::rollback_quarantined_original(
            &state.originals_path(),
            &history_id,
            &quarantine,
        )?;
        return Err(error);
    }
    if let Err(error) = original_image::finalize_quarantined_original(&quarantine) {
        state.log(
            LogLevel::Warn,
            "storage",
            "original_delete_finalize_failed",
            "原图索引已清理，但隔离文件删除失败",
            json!({ "errorCode": error.code }),
        );
    }
    Ok(())
}

#[tauri::command]
fn clear_original_images(state: State<'_, AppState>) -> Result<usize, CommandError> {
    let _guard = state
        .storage_lock
        .lock()
        .map_err(|_| CommandError::new("storage_lock", "原图存储暂时不可用"))?;
    let mut items = store::read_history(&state.history_path())?;
    let quarantined = original_image::quarantine_all(&state.originals_path())?;
    let count = quarantined.len();
    for item in &mut items {
        item.original_image = None;
    }
    if let Err(error) = store::write_history(&state.history_path(), &items) {
        original_image::rollback_quarantined(&quarantined)?;
        return Err(error);
    }
    if let Err(error) = original_image::finalize_quarantined(&quarantined) {
        state.log(
            LogLevel::Warn,
            "storage",
            "original_clear_finalize_failed",
            "原图索引已清理，但部分隔离文件删除失败",
            json!({ "errorCode": error.code }),
        );
    }
    Ok(count)
}

#[tauri::command]
async fn export_result(
    app: AppHandle,
    state: State<'_, AppState>,
    result: ReverseResult,
    #[allow(unused_variables)] format: ResultExportFormat,
    capture_metadata: Option<CaptureMetadata>,
) -> Result<bool, CommandError> {
    let (filename, filter, extensions, body) = match format {
        ResultExportFormat::Markdown => (
            "绘钥反推结果.md",
            "Markdown",
            vec!["md"],
            result_markdown(&result, capture_metadata.as_ref()).into_bytes(),
        ),
        ResultExportFormat::Json => (
            "绘钥反推结果.json",
            "JSON",
            vec!["json"],
            result_json(&result, capture_metadata.as_ref())?,
        ),
        ResultExportFormat::Text => (
            "绘钥提示词.txt",
            "纯文本",
            vec!["txt"],
            result_text(&result).into_bytes(),
        ),
    };
    export_with_native_dialog(&app, &state, filename, filter, &extensions, body, "result").await
}

#[tauri::command]
async fn export_runtime_logs(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, CommandError> {
    let entries = {
        let _guard = state
            .log_lock
            .lock()
            .map_err(|_| CommandError::new("log_lock", "运行日志暂时不可用"))?;
        runtime_log::read(&state.log_path())?
    };
    let mut body = Vec::new();
    for entry in entries.iter().rev() {
        serde_json::to_writer(&mut body, entry)
            .map_err(|error| CommandError::new("export_serialize", error.to_string()))?;
        body.push(b'\n');
    }
    export_with_native_dialog(
        &app,
        &state,
        "绘钥运行日志.jsonl",
        "JSON Lines",
        &["jsonl"],
        body,
        "runtime_logs",
    )
    .await
}

#[tauri::command]
async fn export_diagnostic(
    app: AppHandle,
    state: State<'_, AppState>,
    diagnostic_id: String,
) -> Result<bool, CommandError> {
    let entry = state
        .diagnostics
        .lock()
        .map_err(|_| CommandError::new("diagnostic_lock", "诊断信息暂时不可用"))?
        .get(&diagnostic_id)
        .ok_or_else(|| CommandError::new("diagnostic_expired", "诊断信息已过期，请重试请求"))?;
    let body = serde_json::to_vec_pretty(&entry)
        .map_err(|error| CommandError::new("export_serialize", error.to_string()))?;
    export_with_native_dialog(
        &app,
        &state,
        "绘钥诊断.json",
        "JSON",
        &["json"],
        body,
        "diagnostic",
    )
    .await
}

async fn export_with_native_dialog(
    app: &AppHandle,
    state: &AppState,
    filename: &str,
    filter_name: &str,
    extensions: &[&str],
    body: Vec<u8>,
    kind: &str,
) -> Result<bool, CommandError> {
    const MAX_EXPORT_BYTES: usize = 24 * 1024 * 1024;
    if body.len() > MAX_EXPORT_BYTES {
        return Err(CommandError::new(
            "export_too_large",
            "导出内容超过安全限制",
        ));
    }
    let app = app.clone();
    let filename = filename.to_owned();
    let filter_name = filter_name.to_owned();
    let extensions = extensions
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    let path = tauri::async_runtime::spawn_blocking(move || {
        let extension_refs = extensions.iter().map(String::as_str).collect::<Vec<_>>();
        app.dialog()
            .file()
            .add_filter(filter_name, &extension_refs)
            .set_file_name(filename)
            .blocking_save_file()
    })
    .await
    .map_err(|error| CommandError::new("dialog_failed", error.to_string()))?;
    let Some(path) = path else {
        return Ok(false);
    };
    let path = path
        .into_path()
        .map_err(|error| CommandError::new("export_path_invalid", error.to_string()))?;
    let body_len = body.len();
    tauri::async_runtime::spawn_blocking(move || fs::write(&path, &body))
        .await
        .map_err(|error| CommandError::new("export_failed", error.to_string()))?
        .map_err(|error| CommandError::new("export_failed", error.to_string()))?;
    state.log(
        LogLevel::Info,
        "storage",
        "file_exported",
        "文件已导出",
        json!({ "bytes": body_len, "kind": kind }),
    );
    Ok(true)
}

fn result_markdown(result: &ReverseResult, capture_metadata: Option<&CaptureMetadata>) -> String {
    let active = result.active_prompt_version_id.as_ref().and_then(|id| {
        result
            .prompt_versions
            .iter()
            .find(|version| &version.id == id)
    });
    let prompts = active
        .map(|version| &version.prompts)
        .unwrap_or(&result.prompts);
    let metadata = active
        .map(|version| &version.metadata)
        .unwrap_or(&result.metadata);
    let negative = active
        .filter(|version| version.target == PromptOptimizationTarget::Sdxl)
        .map(|version| {
            format!(
                "\n## 中文负面提示词\n\n{}\n\n## 英文负面提示词\n\n{}\n",
                version.negative_prompts.zh, version.negative_prompts.en
            )
        })
        .unwrap_or_default();
    let capture = capture_metadata
        .map(capture_metadata_markdown)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\n## 文件实拍信息\n\n{value}\n"))
        .unwrap_or_default();
    format!(
        "# 绘钥图片反推结果\n{capture}\n## 摄影测定\n\n- **主体**：{}\n- **场景背景**：{}\n- **构图**：{}\n- **光线**：{}\n- **影调曝光**：{}\n- **色彩**：{}\n- **材质**：{}\n- **风格**：{}\n- **镜头成像**：{}\n- **后期处理**：{}\n\n## 中文提示词\n\n{}\n\n## 英文提示词\n\n{}\n{}\n---\n\n- 模型：{}\n- 令牌数：{}\n- 耗时：{:.2} 秒\n- 生成时间：{}\n",
        result.analysis.subject,
        result.analysis.scene,
        result.analysis.composition,
        result.analysis.lighting,
        result.analysis.tonality,
        result.analysis.colors,
        result.analysis.materials,
        result.analysis.style,
        result.analysis.camera,
        result.analysis.post_processing,
        prompts.zh,
        prompts.en,
        negative,
        metadata.model,
        metadata.total_tokens.map(|value| value.to_string()).unwrap_or_else(|| "--".into()),
        metadata.elapsed_ms as f64 / 1000.0,
        format_created_at(&metadata.created_at),
    )
}

fn result_text(result: &ReverseResult) -> String {
    let active = result.active_prompt_version_id.as_ref().and_then(|id| {
        result
            .prompt_versions
            .iter()
            .find(|version| &version.id == id)
    });
    let prompts = active
        .map(|version| &version.prompts)
        .unwrap_or(&result.prompts);
    let negative = active.map(|version| &version.negative_prompts);
    let mut sections = Vec::new();
    if !prompts.zh.trim().is_empty() {
        sections.push(format!("中文提示词\n{}", prompts.zh));
    }
    if !prompts.en.trim().is_empty() {
        sections.push(format!("英文提示词\n{}", prompts.en));
    }
    if let Some(negative) = negative {
        if !negative.zh.trim().is_empty() {
            sections.push(format!("中文负面提示词\n{}", negative.zh));
        }
        if !negative.en.trim().is_empty() {
            sections.push(format!("英文负面提示词\n{}", negative.en));
        }
    }
    format!("{}\n", sections.join("\n\n"))
}

fn result_json(
    result: &ReverseResult,
    capture_metadata: Option<&CaptureMetadata>,
) -> Result<Vec<u8>, CommandError> {
    let active = result.active_prompt_version_id.as_ref().and_then(|id| {
        result
            .prompt_versions
            .iter()
            .find(|version| &version.id == id)
    });
    let value = json!({
        "schemaVersion": 1,
        "kind": "huiyao.reverse-prompt",
        "captureMetadata": capture_metadata,
        "analysis": result.analysis,
        "activePrompt": {
            "id": active.map(|value| value.id.as_str()).unwrap_or("base"),
            "origin": active.map(|value| json!(value.origin)).unwrap_or_else(|| json!("base")),
            "target": active.map(|value| value.target).unwrap_or(PromptOptimizationTarget::General),
            "title": active.and_then(|value| value.title.as_deref()).unwrap_or("原始反推版本"),
            "prompts": active.map(|value| &value.prompts).unwrap_or(&result.prompts),
            "negativePrompts": active.map(|value| &value.negative_prompts),
            "metadata": active.map(|value| &value.metadata).unwrap_or(&result.metadata),
        },
        "baseMetadata": result.metadata,
    });
    serde_json::to_vec_pretty(&value)
        .map_err(|error| CommandError::new("export_serialize", error.to_string()))
}

fn capture_metadata_markdown(metadata: &CaptureMetadata) -> String {
    let rows = [
        ("相机品牌", metadata.camera_make.as_deref()),
        ("相机型号", metadata.camera_model.as_deref()),
        ("镜头品牌", metadata.lens_make.as_deref()),
        ("镜头型号", metadata.lens_model.as_deref()),
        ("焦距", metadata.focal_length.as_deref()),
        ("等效焦距", metadata.focal_length_35mm.as_deref()),
        ("光圈", metadata.aperture.as_deref()),
        ("快门", metadata.exposure_time.as_deref()),
        ("ISO", metadata.iso.as_deref()),
        ("曝光补偿", metadata.exposure_bias.as_deref()),
        ("闪光灯", metadata.flash.as_deref()),
        ("白平衡", metadata.white_balance.as_deref()),
        ("拍摄时间", metadata.captured_at.as_deref()),
        ("色彩空间", metadata.color_space.as_deref()),
    ];
    rows.into_iter()
        .filter_map(|(label, value)| value.map(|value| format!("- **{label}**：{value}")))
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_created_at(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| {
            date.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| "--".into())
}

#[tauri::command]
fn load_runtime_logs(state: State<'_, AppState>) -> Result<Vec<RuntimeLogEntry>, CommandError> {
    let _guard = state
        .log_lock
        .lock()
        .map_err(|_| CommandError::new("log_lock", "运行日志暂时不可用"))?;
    runtime_log::read(&state.log_path())
}

#[tauri::command]
fn clear_runtime_logs(state: State<'_, AppState>) -> Result<(), CommandError> {
    let _guard = state
        .log_lock
        .lock()
        .map_err(|_| CommandError::new("log_lock", "运行日志暂时不可用"))?;
    runtime_log::clear(&state.log_path())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            store::ensure_private_dir(&app_data_dir, "app_data")
                .map_err(|error| std::io::Error::other(error.message))?;
            for filename in ["settings.json", "history.json", "runtime.jsonl"] {
                let path = app_data_dir.join(filename);
                if path.exists() {
                    store::set_private_file_permissions(&path, "app_data")
                        .map_err(|error| std::io::Error::other(error.message))?;
                }
            }
            let migration_result = app_data_dir
                .parent()
                .map(|parent| parent.join(LEGACY_IDENTIFIER))
                .filter(|legacy| legacy != &app_data_dir)
                .map(|legacy| store::migrate_legacy_data(&legacy, &app_data_dir));
            let keychain_migration = migrate_legacy_keychain();
            let state = AppState {
                app_data_dir,
                log_lock: Mutex::new(()),
                settings_lock: Mutex::new(()),
                storage_lock: Arc::new(Mutex::new(())),
                cancellations: Mutex::new(HashMap::new()),
                diagnostics: Mutex::new(diagnostics::DiagnosticCache::default()),
                http_client: api::build_client()
                    .map_err(|error| std::io::Error::other(error.message))?,
                request_slots: Semaphore::new(2),
            };
            store::ensure_private_dir(&state.originals_path(), "originals_setup")
                .map_err(|error| std::io::Error::other(error.message))?;
            store::ensure_private_dir(&state.original_staging_path(), "original_staging_setup")
                .map_err(|error| std::io::Error::other(error.message))?;
            if let Err(error) = original_image::cleanup_staging(
                &state.original_staging_path(),
                Duration::from_secs(24 * 60 * 60),
            ) {
                state.log(
                    LogLevel::Warn,
                    "storage",
                    "original_staging_cleanup_failed",
                    "过期原图暂存清理失败",
                    json!({ "errorCode": error.code }),
                );
            }
            if let Err(error) = original_image::cleanup_quarantined(&state.originals_path()) {
                state.log(
                    LogLevel::Warn,
                    "storage",
                    "original_quarantine_cleanup_failed",
                    "遗留原图隔离文件清理失败",
                    json!({ "errorCode": error.code }),
                );
            }
            match migration_result {
                Some(Ok(count)) if count > 0 => state.log(
                    LogLevel::Info,
                    "storage",
                    "legacy_data_migrated",
                    "旧版应用数据已迁移",
                    json!({ "files": count }),
                ),
                Some(Err(error)) => state.log(
                    LogLevel::Warn,
                    "storage",
                    "legacy_data_migration_failed",
                    "旧版应用数据迁移未完成",
                    json!({ "errorCode": error.code }),
                ),
                _ => {}
            }
            match keychain_migration {
                Ok(true) => state.log(
                    LogLevel::Info,
                    "storage",
                    "legacy_keychain_migrated",
                    "旧版钥匙串凭证已迁移",
                    json!({}),
                ),
                Err(error) => state.log(
                    LogLevel::Warn,
                    "storage",
                    "legacy_keychain_migration_failed",
                    "旧版钥匙串凭证迁移未完成",
                    json!({ "errorCode": error.code }),
                ),
                _ => {}
            }
            state.log(
                LogLevel::Info,
                "system",
                "app_started",
                "应用已启动",
                json!({ "version": env!("CARGO_PKG_VERSION"), "platform": "macOS" }),
            );
            app.manage(state);
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed
            ) {
                let state = window.state::<AppState>();
                let cancelled = state.cancel_all_requests();
                if cancelled > 0 {
                    state.log(
                        LogLevel::Warn,
                        "model",
                        "window_requests_cancelled",
                        "窗口关闭，已取消进行中的模型请求",
                        json!({ "count": cancelled }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            save_theme,
            save_workspace_preferences,
            test_connection,
            reverse_prompt_stream,
            optimize_prompt_stream,
            cancel_reverse_prompt,
            stage_original_image,
            discard_original_stage,
            load_history,
            save_history,
            load_original_image,
            export_original_image,
            get_original_storage_stats,
            remove_history_original,
            clear_original_images,
            export_result,
            export_runtime_logs,
            export_diagnostic,
            load_runtime_logs,
            clear_runtime_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running 绘钥");
}

fn sanitize_base_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value) else {
        return "(invalid)".into();
    };
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    url.to_string().trim_end_matches('/').to_owned()
}

fn diagnostic_error_message(error: &CommandError) -> &'static str {
    match error.code.as_str() {
        "missing_api_key" => "未配置 API Key",
        "missing_model" => "未配置模型名称",
        "invalid_base_url" => "Base URL 配置无效",
        "insecure_http_confirmation_required" => "非本机 HTTP 地址尚未确认风险",
        "redirect_blocked" => "模型服务返回重定向，已阻止凭证转发",
        "missing_image" => "图片输入缺失",
        "invalid_image" => "图片数据无效",
        "image_too_large" | "image_dimensions_too_large" => "图片超过安全限制",
        "requirements_too_long" => "补充要求超过安全限制",
        "response_too_large" => "模型响应超过安全限制",
        "timeout" => "模型请求超时",
        "network" | "client_error" | "response_read" => "模型服务网络请求失败",
        "http_401" | "http_403" => "模型服务认证或授权失败",
        "http_404" => "模型接口或模型不存在",
        "http_413" => "模型请求载荷过大",
        "http_429" => "模型服务限流或额度不足",
        code if code.starts_with("http_5") => "模型服务内部错误",
        code if code.starts_with("http_") => "模型服务返回异常状态",
        "empty_response" => "模型未返回可用内容",
        "invalid_response" => "模型服务响应格式无效",
        "invalid_model_json" => "模型输出无法解析为结构化结果",
        "invalid_stream" | "stream_error" | "stream_interrupted" => "模型流式响应异常",
        "cancelled" => "生成已停止",
        _ => "操作失败，请结合错误码排查",
    }
}

fn output_language_name(value: models::OutputLanguage) -> &'static str {
    match value {
        models::OutputLanguage::Chinese => "chinese",
        models::OutputLanguage::English => "english",
        models::OutputLanguage::Bilingual => "bilingual",
    }
}

fn detail_level_name(value: models::DetailLevel) -> &'static str {
    match value {
        models::DetailLevel::Concise => "concise",
        models::DetailLevel::Standard => "standard",
        models::DetailLevel::Detailed => "detailed",
        models::DetailLevel::Expert => "expert",
    }
}

fn optimization_target_name(value: PromptOptimizationTarget) -> &'static str {
    match value {
        PromptOptimizationTarget::General => "general",
        PromptOptimizationTarget::Midjourney => "midjourney",
        PromptOptimizationTarget::Flux => "flux",
        PromptOptimizationTarget::Sdxl => "sdxl",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Offset, TimeZone};

    #[test]
    fn sanitizes_credentials_and_query_from_logged_base_url() {
        assert_eq!(
            sanitize_base_url("https://user:secret@example.com/v1?token=private#fragment"),
            "https://example.com/v1"
        );
    }

    #[test]
    fn provider_error_details_are_not_written_to_logs() {
        let error = CommandError::new(
            "http_401",
            "provider echoed sk-secret-value and private prompt text",
        );
        assert_eq!(diagnostic_error_message(&error), "模型服务认证或授权失败");
    }

    #[test]
    fn formats_result_time_in_local_time_without_milliseconds() {
        let offset = Local::now().offset().fix();
        let source = offset
            .with_ymd_and_hms(2026, 7, 25, 16, 8, 9)
            .single()
            .expect("valid date")
            .to_rfc3339();
        assert_eq!(format_created_at(&source), "2026-07-25 16:08:09");
        assert_eq!(format_created_at("invalid"), "--");
    }

    #[test]
    fn structured_result_export_has_stable_schema_and_allowlisted_capture_metadata() {
        let result = ReverseResult::default();
        let capture = CaptureMetadata {
            camera_model: Some("Camera X".into()),
            iso: Some("100".into()),
            ..Default::default()
        };
        let body = result_json(&result, Some(&capture)).unwrap();
        let value: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["kind"], "huiyao.reverse-prompt");
        assert_eq!(value["captureMetadata"]["cameraModel"], "Camera X");
        let serialized = String::from_utf8(body).unwrap();
        assert!(!serialized.to_ascii_lowercase().contains("gps"));
        assert!(!serialized.to_ascii_lowercase().contains("serial"));
    }
}
