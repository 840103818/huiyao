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
    native_dialog::export_file(
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
