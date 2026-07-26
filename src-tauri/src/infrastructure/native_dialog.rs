use std::fs;

use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::{models::CommandError, runtime_log::LogLevel, state::AppState};

pub(crate) async fn export_file(
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
