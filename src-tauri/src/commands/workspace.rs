fn workspace_lock(state: &AppState) -> Result<std::sync::MutexGuard<'_, ()>, CommandError> {
    state.storage_lock.lock().map_err(|_| CommandError::new("storage_lock", "工作区存储暂时不可用"))
}

fn validate_task_selection(task_ids: &[String]) -> Result<(), CommandError> {
    if task_ids.len() > 100 {
        return Err(CommandError::new("task_selection_invalid", "单次最多操作 100 个任务"));
    }
    if task_ids.iter().any(|id| id.is_empty() || id.len() > 128 || id.chars().any(char::is_control)) {
        return Err(CommandError::new("task_selection_invalid", "任务标识无效"));
    }
    Ok(())
}

fn validate_session_id(value: Option<String>, label: &str) -> Result<Option<String>, CommandError> {
    value
        .map(|value| {
            if value.is_empty()
                || value.len() > 128
                || !value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            {
                return Err(CommandError::new(
                    "workspace_session_invalid",
                    format!("{label}无效"),
                ));
            }
            Ok(value)
        })
        .transpose()
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> Result<Vec<Project>, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::list_projects(&state.workspace_path())
}

#[tauri::command]
fn create_project(state: State<'_, AppState>, title: String) -> Result<Project, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::create_project(&state.workspace_path(), &title)
}

#[tauri::command]
fn rename_project(state: State<'_, AppState>, project_id: String, title: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::rename_project(&state.workspace_path(), &project_id, &title)
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, project_id: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::soft_delete_project(&state.workspace_path(), &project_id)
}

#[tauri::command]
fn list_project_tasks(state: State<'_, AppState>, project_id: String, filter: TaskFilter, query: String, offset: u64, limit: u64) -> Result<ProjectTaskPage, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::list_tasks(&state.workspace_path(), &project_id, filter, &query, offset, limit)
}

#[tauri::command]
fn get_project_task(state: State<'_, AppState>, task_id: String) -> Result<ProjectTask, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::get_task(&state.workspace_path(), &task_id)
}

#[tauri::command]
fn rename_project_task(state: State<'_, AppState>, task_id: String, title: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::rename_task(&state.workspace_path(), &task_id, &title)
}

#[tauri::command]
fn import_project_task(state: State<'_, AppState>, input: ImportProjectTaskInput) -> Result<ProjectTask, CommandError> {
    let _guard = workspace_lock(&state)?;
    let settings = store::read_settings(&state.settings_path())?;
    let key = original_key_for_reading()?;
    let trusted_stage = original_image::inspect_stage(
        &state.original_staging_path(),
        &input.original_stage.staging_id,
        &input.file_name,
        &key,
    )?;
    let stats = original_image::stats(&state.originals_path())?;
    if stats.total_bytes.saturating_add(trusted_stage.info.size) > settings.storage_quota_bytes {
        return Err(CommandError::new("storage_quota_exceeded", "原图存储已达到配额，请管理存储或仅保留缩略图"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let image_info = models::ImageInfo {
        name: trusted_stage.info.file_name.clone(),
        width: trusted_stage.source_width,
        height: trusted_stage.source_height,
        size: trusted_stage.info.size,
        mime_type: trusted_stage.info.mime_type.clone(),
    };
    let task = ProjectTask {
        id: id.clone(), project_id: input.project_id.clone(), title: input.title.trim().chars().take(64).collect(), file_name: trusted_stage.info.file_name.clone(),
        thumbnail: Some(input.thumbnail), image_info: Some(image_info), original_image: Some(trusted_stage.info.clone()),
        capture_metadata: trusted_stage.capture_metadata, status: TaskStatus::Ready, favorite: false, tags: Vec::new(),
        preset_snapshot: Some(input.preset_snapshot), result: None, error_code: None, error_message: None, parent_task_id: None,
        queue_position: workspace_store::next_queue_position(&state.workspace_path(), &input.project_id)?, created_at: now.clone(), updated_at: now,
    };
    original_image::commit(&state.original_staging_path(), &state.originals_path(), &trusted_stage.staging_id, &id)?;
    if let Err(error) = workspace_store::insert_task(&state.workspace_path(), &task, Some(&id)) {
        original_image::rollback_commit(&state.original_staging_path(), &state.originals_path(), &trusted_stage.staging_id, &id);
        return Err(error);
    }
    state.log(LogLevel::Info, "workspace", "task_imported", "图片已导入项目", json!({"taskId": id, "projectId": input.project_id, "bytes": task.original_image.as_ref().map(|value| value.size)}));
    Ok(task)
}

#[tauri::command]
fn update_project_task_status(state: State<'_, AppState>, task_ids: Vec<String>, status: TaskStatus) -> Result<usize, CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::update_task_status(&state.workspace_path(), &task_ids, status)
}

#[tauri::command]
fn complete_project_task(state: State<'_, AppState>, input: TaskResultInput) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::complete_task(&state.workspace_path(), &input.task_id, &input.result)
}

#[tauri::command]
fn update_project_task_result(state: State<'_, AppState>, input: TaskResultInput) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::update_task_result(&state.workspace_path(), &input.task_id, &input.result)
}

#[tauri::command]
fn fail_project_task(state: State<'_, AppState>, input: TaskFailureInput) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::fail_task(&state.workspace_path(), &input.task_id, &input.code, &input.message)
}

#[tauri::command]
fn set_project_task_favorite(state: State<'_, AppState>, task_id: String, favorite: bool) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::set_favorite(&state.workspace_path(), &task_id, favorite)
}

#[tauri::command]
fn set_project_task_tags(state: State<'_, AppState>, task_id: String, tags: Vec<String>) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::set_tags(&state.workspace_path(), &task_id, &tags)
}

#[tauri::command]
fn set_project_tasks_favorite(state: State<'_, AppState>, task_ids: Vec<String>, favorite: bool) -> Result<usize, CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::set_favorite_many(&state.workspace_path(), &task_ids, favorite)
}

#[tauri::command]
fn update_project_tasks_tags(state: State<'_, AppState>, task_ids: Vec<String>, tags: Vec<String>, remove: bool) -> Result<usize, CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::update_tags_many(&state.workspace_path(), &task_ids, &tags, remove)
}

#[tauri::command]
fn move_project_tasks(state: State<'_, AppState>, task_ids: Vec<String>, project_id: String) -> Result<usize, CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::move_tasks(&state.workspace_path(), &task_ids, &project_id)
}

#[tauri::command]
fn reorder_project_tasks(state: State<'_, AppState>, task_ids: Vec<String>) -> Result<(), CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::reorder_tasks(&state.workspace_path(), &task_ids)
}

#[tauri::command]
fn duplicate_project_task(state: State<'_, AppState>, task_id: String) -> Result<ProjectTask, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::duplicate_task(&state.workspace_path(), &task_id)
}

#[tauri::command]
fn delete_project_tasks(state: State<'_, AppState>, task_ids: Vec<String>) -> Result<usize, CommandError> {
    validate_task_selection(&task_ids)?;
    let _guard = workspace_lock(&state)?;
    workspace_store::soft_delete_tasks(&state.workspace_path(), &task_ids)
}

#[tauri::command]
fn get_batch_progress(state: State<'_, AppState>, project_id: String) -> Result<BatchProgress, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::batch_progress(&state.workspace_path(), &project_id)
}

#[tauri::command]
fn list_reverse_presets(state: State<'_, AppState>) -> Result<Vec<ReversePreset>, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::list_presets(&state.workspace_path())
}

#[tauri::command]
fn save_reverse_preset(state: State<'_, AppState>, preset_id: Option<String>, title: String, snapshot: ReversePresetSnapshot) -> Result<ReversePreset, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::save_preset(&state.workspace_path(), preset_id.as_deref(), &title, &snapshot)
}

#[tauri::command]
fn delete_reverse_preset(state: State<'_, AppState>, preset_id: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::delete_preset(&state.workspace_path(), &preset_id)
}

#[tauri::command]
fn list_trash(state: State<'_, AppState>) -> Result<Vec<TrashEntry>, CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::list_trash(&state.workspace_path())
}

#[tauri::command]
fn restore_trash_entry(state: State<'_, AppState>, entry_id: String, kind: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    workspace_store::restore_trash(&state.workspace_path(), &entry_id, &kind)
}

#[tauri::command]
fn permanently_delete_trash_entry(state: State<'_, AppState>, entry_id: String, kind: String) -> Result<(), CommandError> {
    let _guard = workspace_lock(&state)?;
    let assets = workspace_store::permanent_delete(&state.workspace_path(), &entry_id, &kind)?;
    for asset in assets {
        if let Ok(quarantine) = original_image::quarantine_original(&state.originals_path(), &asset) {
            let _ = original_image::finalize_quarantined_original(&quarantine);
        }
    }
    Ok(())
}

#[tauri::command]
fn empty_trash(state: State<'_, AppState>) -> Result<usize, CommandError> {
    let _guard = workspace_lock(&state)?;
    let entries = workspace_store::list_trash(&state.workspace_path())?;
    for entry in &entries {
        let assets = workspace_store::permanent_delete(&state.workspace_path(), &entry.id, &entry.kind)?;
        for asset in assets {
            if let Ok(quarantine) = original_image::quarantine_original(&state.originals_path(), &asset) {
                let _ = original_image::finalize_quarantined_original(&quarantine);
            }
        }
    }
    Ok(entries.len())
}

#[tauri::command]
async fn load_workspace_original_image(state: State<'_, AppState>, task_id: String) -> Result<IpcResponse, CommandError> {
    let storage_lock=state.storage_lock.clone(); let database=state.workspace_path(); let originals=state.originals_path();
    let bytes=tauri::async_runtime::spawn_blocking(move||{let _guard=storage_lock.lock().map_err(|_|CommandError::new("storage_lock","原图存储暂时不可用"))?;let(asset,_)=workspace_store::task_original(&database,&task_id)?;let key=original_key_for_reading()?;original_image::load(&originals,&asset,&key)}).await.map_err(|error|CommandError::new("original_read",error.to_string()))??;
    Ok(IpcResponse::new(bytes))
}

#[tauri::command]
async fn export_workspace_original_image(app: AppHandle, state: State<'_, AppState>, task_id: String) -> Result<bool, CommandError> {
    let storage_lock=state.storage_lock.clone();let database=state.workspace_path();let originals=state.originals_path();
    let(info,bytes)=tauri::async_runtime::spawn_blocking(move||{let _guard=storage_lock.lock().map_err(|_|CommandError::new("storage_lock","原图存储暂时不可用"))?;let(asset,info)=workspace_store::task_original(&database,&task_id)?;let key=original_key_for_reading()?;let bytes=original_image::load(&originals,&asset,&key)?;Ok::<_,CommandError>((info,bytes))}).await.map_err(|error|CommandError::new("original_read",error.to_string()))??;
    let extension=match info.mime_type.as_str(){"image/png"=>"png","image/jpeg"=>"jpg","image/webp"=>"webp",_=>return Err(CommandError::new("original_invalid","原图格式无效"))};
    native_dialog::export_file(&app,&state,&info.file_name,"原始图片",&[extension],bytes,"workspace_original").await
}

#[tauri::command]
async fn export_project_tasks(app: AppHandle, state: State<'_, AppState>, request: BatchExportRequest) -> Result<bool, CommandError> {
    let Some(destination)=native_dialog::choose_save_path(&app,"绘钥批量导出.zip","ZIP",&["zip"]).await? else{return Ok(false)};
    let parent=destination.parent().ok_or_else(||CommandError::new("batch_export_write","导出目录无效"))?;
    let temp=parent.join(format!(".huiyao-{}.zip.part",uuid::Uuid::new_v4()));
    let cleanup=temp.clone();let database=state.workspace_path();let originals=state.originals_path();
    let outcome=tauri::async_runtime::spawn_blocking(move||{
        let result: Result<(),CommandError>=(||{workspace_export::write_batch_zip(&database,&originals,&temp,&request)?;std::fs::rename(&temp,&destination).map_err(|_|CommandError::new("batch_export_write","无法写入批量导出文件"))})();
        if result.is_err(){let _=std::fs::remove_file(&temp);}
        result
    }).await.map_err(|_|{let _=std::fs::remove_file(&cleanup);CommandError::new("batch_export_write","批量导出任务异常终止")})?;
    outcome.map(|_|true)
}

#[tauri::command]
fn save_workspace_session(state: State<'_, AppState>, session: WorkspaceSessionInput) -> Result<(), CommandError> {
    let _guard=state.settings_lock.lock().map_err(|_|CommandError::new("settings_lock","设置暂时不可用"))?;
    let mut settings=store::read_settings(&state.settings_path())?;
    settings.last_project_id=validate_session_id(session.last_project_id,"项目标识")?;
    settings.last_task_id=validate_session_id(session.last_task_id,"任务标识")?;
    store::write_settings(&state.settings_path(),&settings)
}
