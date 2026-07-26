use std::{
    path::Path,
    time::{Duration, Instant},
};

#[cfg(test)]
use crate::application::result_export::format_created_at;
use crate::{
    api,
    application::result_export::{result_json, result_markdown, result_text},
    keychain::{
        migrate_legacy_keychain, original_key_for_reading, original_key_for_staging, read_api_key,
        write_api_key, LEGACY_IDENTIFIER,
    },
    models::{
        self, CaptureMetadata, CommandError, ConnectionStatus, HistoryItem, OriginalImageCommit,
        OriginalImageStage, OriginalStorageStats, PromptOptimizationOutput,
        PromptOptimizationRequest, PromptOptimizationTarget, PublicSettings, ResultExportFormat,
        ReverseRequest, ReverseResult, ReverseStreamEvent, SettingsFile, SettingsInput, ThemeMode,
        WorkspacePreferences,
    },
    native_dialog, original_image,
    runtime_log::{self, LogLevel, RuntimeLogEntry},
    state::AppState,
    store,
};
use serde::Deserialize;
use serde_json::json;
#[cfg(test)]
use serde_json::Value;
use tauri::{
    ipc::{Channel, InvokeBody, Request as IpcRequest, Response as IpcResponse},
    AppHandle, Manager, State,
};
use tokio_util::sync::CancellationToken;

const ORIGINAL_UPLOAD_MAGIC: &[u8; 4] = b"HYUP";
const MAX_ORIGINAL_UPLOAD_BODY_BYTES: usize = 20 * 1024 * 1024 + 2_056;

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

include!("settings.rs");
include!("generation.rs");
include!("storage.rs");
include!("exports.rs");
include!("runtime.rs");
include!("tests.rs");
