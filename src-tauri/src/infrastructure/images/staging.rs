pub fn generate_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

pub fn has_originals(directory: &Path) -> bool {
    fs::read_dir(directory).ok().is_some_and(|mut entries| {
        entries.any(|entry| {
            entry.ok().is_some_and(|entry| {
                entry.path().extension().and_then(|value| value.to_str()) == Some("hyi")
            })
        })
    })
}

pub fn stage(
    directory: &Path,
    bytes: &[u8],
    file_name: &str,
    mime_type: &str,
    key: &[u8; 32],
) -> Result<OriginalImageStage, CommandError> {
    validate_source(bytes, file_name, mime_type)?;
    validate_staging_capacity(directory, bytes.len() as u64)?;
    let source_size = imagesize::blob_size(bytes)
        .map_err(|_| CommandError::new("original_invalid", "无法识别原图尺寸"))?;
    ensure_private_dir(directory, "original_stage")?;
    let staging_id = random_id();
    let path = stage_path(directory, &staging_id)?;
    encrypt_to_file(&path, bytes, key)?;
    Ok(OriginalImageStage {
        staging_id,
        info: OriginalImageInfo {
            file_name: file_name.to_owned(),
            mime_type: mime_type.to_owned(),
            size: bytes.len() as u64,
            stored_at: Utc::now().to_rfc3339(),
            encryption_version: VERSION,
        },
        capture_metadata: extract_capture_metadata(bytes),
        source_width: source_size.width as u32,
        source_height: source_size.height as u32,
    })
}

fn validate_staging_capacity(directory: &Path, incoming_bytes: u64) -> Result<(), CommandError> {
    ensure_private_dir(directory, "original_stage")?;
    let mut count = 0usize;
    let mut bytes = 0u64;
    for entry in fs::read_dir(directory)
        .map_err(|error| CommandError::new("original_stage", error.to_string()))?
    {
        let entry =
            entry.map_err(|error| CommandError::new("original_stage", error.to_string()))?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("hyi") {
            continue;
        }
        count += 1;
        bytes = bytes.saturating_add(entry.metadata().map(|value| value.len()).unwrap_or(0));
    }
    if count >= MAX_STAGING_FILES || bytes.saturating_add(incoming_bytes) > MAX_STAGING_BYTES {
        return Err(CommandError::new(
            "original_staging_quota",
            "原图暂存空间已满，请完成或取消当前任务后重试",
        ));
    }
    Ok(())
}

