mod api;
mod models;
mod runtime_log;
mod store;

use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex, time::Instant};

use keyring::Entry;
use models::{
    CommandError, ConnectionStatus, HistoryItem, PublicSettings, ReverseRequest, ReverseResult,
    ReverseStreamEvent, SettingsFile, SettingsInput, ThemeMode,
};
use runtime_log::{LogLevel, RuntimeLogEntry};
use serde_json::{json, Value};
use tauri::{ipc::Channel, Manager, State};
use tokio_util::sync::CancellationToken;

const KEYRING_SERVICE: &str = "com.huiyao.studio";
const LEGACY_KEYRING_SERVICE: &str = "com.reverseprompt.studio";
const KEYRING_USER: &str = "openai-compatible-api-key";
const LEGACY_IDENTIFIER: &str = "com.reverseprompt.studio";

struct AppState {
    app_data_dir: PathBuf,
    log_lock: Mutex<()>,
    cancellations: Mutex<HashMap<String, CancellationToken>>,
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

    fn log(&self, level: LogLevel, category: &str, event: &str, message: &str, details: Value) {
        if let Ok(_guard) = self.log_lock.lock() {
            let _ = runtime_log::append(&self.log_path(), level, category, event, message, details);
        }
    }
}

fn keyring_entry(service: &str) -> Result<Entry, CommandError> {
    Entry::new(service, KEYRING_USER)
        .map_err(|error| CommandError::new("keychain_access", error.to_string()))
}

fn read_api_key() -> Result<String, CommandError> {
    match keyring_entry(KEYRING_SERVICE)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(CommandError::new("keychain_read", error.to_string())),
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
    Ok(PublicSettings {
        base_url: settings.base_url,
        model: settings.model,
        timeout_seconds: settings.timeout_seconds,
        theme: settings.theme,
        has_api_key,
    })
}

#[tauri::command]
fn save_settings(
    state: State<'_, AppState>,
    input: SettingsInput,
) -> Result<PublicSettings, CommandError> {
    let settings = SettingsFile::from(&input);
    api::endpoint_from_base_url(&settings.base_url)?;
    if settings.model.is_empty() {
        return Err(CommandError::new("missing_model", "请填写模型名称"));
    }
    store::write_settings(&state.settings_path(), &settings)?;
    let entry = keyring_entry(KEYRING_SERVICE)?;
    if input.clear_api_key {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(CommandError::new("keychain_delete", error.to_string())),
        }
    } else if let Some(api_key) = input
        .api_key
        .as_deref()
        .filter(|key| !key.trim().is_empty())
    {
        entry
            .set_password(api_key.trim())
            .map_err(|error| CommandError::new("keychain_write", error.to_string()))?;
    }
    let public = PublicSettings {
        base_url: settings.base_url,
        model: settings.model,
        timeout_seconds: settings.timeout_seconds,
        theme: settings.theme,
        has_api_key: !read_api_key()?.is_empty(),
    };
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
    let mut settings = store::read_settings(&state.settings_path())?;
    settings.theme = theme;
    store::write_settings(&state.settings_path(), &settings)?;
    let public = PublicSettings {
        base_url: settings.base_url,
        model: settings.model,
        timeout_seconds: settings.timeout_seconds,
        theme: settings.theme,
        has_api_key: !read_api_key()?.is_empty(),
    };
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
async fn test_connection(
    state: State<'_, AppState>,
    input: SettingsInput,
) -> Result<ConnectionStatus, CommandError> {
    let settings = SettingsFile::from(&input);
    let key = input
        .api_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or(read_api_key()?);
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
    match api::test_connection(&settings, &key).await {
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
    let _ = on_event.send(ReverseStreamEvent::Started {
        interaction_id: interaction_id.clone(),
    });
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
    let response =
        api::reverse_prompt_stream(&settings, &api_key, &request, &cancellation, move |event| {
            match event {
                api::ApiStreamEvent::Delta(content) => {
                    let _ = stream_channel.send(ReverseStreamEvent::Delta { content });
                }
                api::ApiStreamEvent::Fallback => {
                    let _ = stream_channel.send(ReverseStreamEvent::Fallback {
                        reason: "provider_unsupported".into(),
                    });
                }
            }
        })
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
                    "hasRawResponse": error.raw_response.is_some(),
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

#[tauri::command]
fn load_history(state: State<'_, AppState>) -> Result<Vec<HistoryItem>, CommandError> {
    store::read_history(&state.history_path())
}

#[tauri::command]
fn save_history(state: State<'_, AppState>, items: Vec<HistoryItem>) -> Result<(), CommandError> {
    let count = items.len().min(50);
    match store::write_history(&state.history_path(), &items) {
        Ok(()) => {
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

#[tauri::command]
fn export_markdown(
    state: State<'_, AppState>,
    path: String,
    content: String,
) -> Result<(), CommandError> {
    let bytes = content.len();
    match fs::write(path, content) {
        Ok(()) => {
            state.log(
                LogLevel::Info,
                "storage",
                "file_exported",
                "文件已导出",
                json!({ "bytes": bytes }),
            );
            Ok(())
        }
        Err(error) => {
            let command_error = CommandError::new("export_failed", error.to_string());
            state.log(
                LogLevel::Error,
                "storage",
                "file_export_failed",
                "文件导出失败",
                json!({ "errorCode": command_error.code, "errorMessage": command_error.message }),
            );
            Err(command_error)
        }
    }
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
            fs::create_dir_all(&app_data_dir)?;
            let migration_result = app_data_dir
                .parent()
                .map(|parent| parent.join(LEGACY_IDENTIFIER))
                .filter(|legacy| legacy != &app_data_dir)
                .map(|legacy| store::migrate_legacy_data(&legacy, &app_data_dir));
            let keychain_migration = migrate_legacy_keychain();
            let state = AppState {
                app_data_dir,
                log_lock: Mutex::new(()),
                cancellations: Mutex::new(HashMap::new()),
            };
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
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            save_theme,
            test_connection,
            reverse_prompt_stream,
            cancel_reverse_prompt,
            load_history,
            save_history,
            export_markdown,
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
        "missing_image" => "图片输入缺失",
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
