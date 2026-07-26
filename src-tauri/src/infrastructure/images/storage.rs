pub fn commit(
    staging_directory: &Path,
    originals_directory: &Path,
    staging_id: &str,
    history_id: &str,
) -> Result<(), CommandError> {
    ensure_private_dir(originals_directory, "original_commit")?;
    let source = stage_path(staging_directory, staging_id)?;
    let destination = original_path(originals_directory, history_id)?;
    if !source.exists() {
        return Err(CommandError::new(
            "original_stage_missing",
            "原图暂存文件不存在，请重新选择图片",
        ));
    }
    if destination.exists() {
        return Err(CommandError::new(
            "original_exists",
            "该历史任务已关联原图，不能覆盖",
        ));
    }
    fs::rename(source, &destination)
        .map_err(|error| CommandError::new("original_commit", error.to_string()))?;
    set_private_file_permissions(&destination, "original_commit")
}

pub fn rollback_commit(
    staging_directory: &Path,
    originals_directory: &Path,
    staging_id: &str,
    history_id: &str,
) {
    let Ok(source) = original_path(originals_directory, history_id) else {
        return;
    };
    let Ok(destination) = stage_path(staging_directory, staging_id) else {
        return;
    };
    if source.exists() {
        let _ = fs::rename(source, destination);
    }
}

pub fn load(
    originals_directory: &Path,
    history_id: &str,
    key: &[u8; 32],
) -> Result<Vec<u8>, CommandError> {
    decrypt_file(&original_path(originals_directory, history_id)?, key)
}

pub fn load_stage(
    staging_directory: &Path,
    staging_id: &str,
    key: &[u8; 32],
) -> Result<Vec<u8>, CommandError> {
    decrypt_file(&stage_path(staging_directory, staging_id)?, key)
}

#[cfg(test)]
pub fn remove_original(directory: &Path, history_id: &str) -> Result<(), CommandError> {
    let path = original_path(directory, history_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::new("original_delete", error.to_string())),
    }
}

pub fn quarantine_original(directory: &Path, history_id: &str) -> Result<PathBuf, CommandError> {
    let source = original_path(directory, history_id)?;
    if !source.exists() {
        return Err(CommandError::new("original_missing", "原图文件不存在"));
    }
    let quarantine = directory.join(format!(".{history_id}.delete"));
    if quarantine.exists() {
        return Err(CommandError::new("original_delete", "原图删除事务尚未完成"));
    }
    fs::rename(&source, &quarantine)
        .map_err(|error| CommandError::new("original_delete", error.to_string()))?;
    Ok(quarantine)
}

pub fn rollback_quarantined_original(
    directory: &Path,
    history_id: &str,
    quarantine: &Path,
) -> Result<(), CommandError> {
    fs::rename(quarantine, original_path(directory, history_id)?)
        .map_err(|error| CommandError::new("original_delete_rollback", error.to_string()))
}

pub fn finalize_quarantined_original(quarantine: &Path) -> Result<(), CommandError> {
    fs::remove_file(quarantine)
        .map_err(|error| CommandError::new("original_delete", error.to_string()))
}

pub fn quarantine_all(directory: &Path) -> Result<Vec<(PathBuf, PathBuf)>, CommandError> {
    ensure_private_dir(directory, "original_clear")?;
    let mut quarantined = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_clear", error.to_string()))?
    {
        let entry =
            entry.map_err(|error| CommandError::new("original_clear", error.to_string()))?;
        let source = entry.path();
        if source.extension().and_then(|value| value.to_str()) != Some("hyi") {
            continue;
        }
        let destination = directory.join(format!(".clear-{}.delete", random_id()));
        if let Err(error) = fs::rename(&source, &destination) {
            let _ = rollback_quarantined(&quarantined);
            return Err(CommandError::new("original_clear", error.to_string()));
        }
        quarantined.push((source, destination));
    }
    Ok(quarantined)
}

pub fn rollback_quarantined(entries: &[(PathBuf, PathBuf)]) -> Result<(), CommandError> {
    for (source, quarantine) in entries.iter().rev() {
        if quarantine.exists() {
            fs::rename(quarantine, source)
                .map_err(|error| CommandError::new("original_clear_rollback", error.to_string()))?;
        }
    }
    Ok(())
}

pub fn finalize_quarantined(entries: &[(PathBuf, PathBuf)]) -> Result<(), CommandError> {
    let mut first_error = None;
    for (_, quarantine) in entries {
        if let Err(error) = fs::remove_file(quarantine) {
            if error.kind() != std::io::ErrorKind::NotFound && first_error.is_none() {
                first_error = Some(CommandError::new("original_clear", error.to_string()));
            }
        }
    }
    first_error.map_or(Ok(()), Err)
}

pub fn cleanup_quarantined(directory: &Path) -> Result<usize, CommandError> {
    ensure_private_dir(directory, "original_quarantine_cleanup")?;
    let mut removed = 0;
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_quarantine_cleanup", error.to_string()))?
    {
        let entry = entry
            .map_err(|error| CommandError::new("original_quarantine_cleanup", error.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) == Some("delete")
            && fs::remove_file(path).is_ok()
        {
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn discard_stage(directory: &Path, staging_id: &str) -> Result<(), CommandError> {
    let path = stage_path(directory, staging_id)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::new(
            "original_stage_delete",
            error.to_string(),
        )),
    }
}

pub fn cleanup_staging(directory: &Path, max_age: Duration) -> Result<usize, CommandError> {
    ensure_private_dir(directory, "original_stage_cleanup")?;
    let now = SystemTime::now();
    let mut removed = 0;
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_stage_cleanup", error.to_string()))?
    {
        let entry = entry
            .map_err(|error| CommandError::new("original_stage_cleanup", error.to_string()))?;
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if now.duration_since(modified).unwrap_or_default() > max_age
            && fs::remove_file(entry.path()).is_ok()
        {
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn stats(directory: &Path) -> Result<OriginalStorageStats, CommandError> {
    ensure_private_dir(directory, "original_stats")?;
    let mut result = OriginalStorageStats::default();
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_stats", error.to_string()))?
    {
        let entry =
            entry.map_err(|error| CommandError::new("original_stats", error.to_string()))?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("hyi") {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| CommandError::new("original_stats", error.to_string()))?;
        if metadata.is_file() {
            result.count += 1;
            result.total_bytes = result.total_bytes.saturating_add(metadata.len());
        }
    }
    Ok(result)
}

pub fn remove_unreferenced(
    directory: &Path,
    referenced_ids: &[String],
) -> Result<usize, CommandError> {
    ensure_private_dir(directory, "original_cleanup")?;
    let mut removed = 0;
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_cleanup", error.to_string()))?
    {
        let entry =
            entry.map_err(|error| CommandError::new("original_cleanup", error.to_string()))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("hyi") {
            continue;
        }
        let Some(stem) = path
            .file_stem()
            .and_then(|value| value.to_str())
            .map(str::to_owned)
        else {
            continue;
        };
        if !referenced_ids.iter().any(|id| id == &stem) && fs::remove_file(path).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

