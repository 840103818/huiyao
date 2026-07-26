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
    native_dialog::export_file(&app, &state, filename, filter, &extensions, body, "result").await
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
    native_dialog::export_file(
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
    native_dialog::export_file(
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
