use std::{
    path::Path,
    time::{Duration, Instant},
};

#[cfg(test)]
use crate::application::result_export::format_created_at;
use crate::{
    api,
    application::{
        result_export::{result_json, result_markdown, result_text},
        workspace_export,
    },
    keychain::{
        migrate_legacy_keychain, original_key_for_reading, original_key_for_staging, read_api_key,
        write_api_key, LEGACY_IDENTIFIER,
    },
    models::{
        self, AnalysisRefinementOutput, AnalysisRefinementRequest, BatchExportRequest,
        BatchProgress, CaptureMetadata, CommandError, ConnectionStatus, HistoryItem,
        ImportProjectTaskInput, OriginalImageCommit, OriginalImageStage, OriginalStorageStats,
        Project, ProjectTask, ProjectTaskPage, PromptOptimizationOutput, PromptOptimizationRequest,
        PromptOptimizationTarget, PublicSettings, ResultExportFormat, ReversePreset,
        ReversePresetSnapshot, ReverseRequest, ReverseResult, ReverseStreamEvent, SettingsFile,
        SettingsInput, TaskFailureInput, TaskFilter, TaskResultInput, TaskStatus, ThemeMode,
        TrashEntry, WorkspacePreferences, WorkspaceSessionInput,
    },
    native_dialog, original_image,
    runtime_log::{self, LogLevel, RuntimeLogEntry},
    state::AppState,
    store, workspace_store,
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
        last_project_id: settings.last_project_id,
        last_task_id: settings.last_task_id,
        batch_concurrency: settings.batch_concurrency,
        storage_quota_bytes: settings.storage_quota_bytes,
        progressive_disclosure: settings.progressive_disclosure,
    }
}

include!("settings.rs");
include!("generation.rs");
include!("storage.rs");
include!("exports.rs");
include!("runtime.rs");
include!("workspace.rs");
include!("tests.rs");
