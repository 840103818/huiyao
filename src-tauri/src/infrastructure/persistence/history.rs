pub fn read_history(path: &Path) -> Result<Vec<HistoryItem>, CommandError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let contents = read_bounded(path, MAX_HISTORY_BYTES, "history_read")?;
    let values: Vec<Value> = serde_json::from_str(&contents)
        .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
    let (items, changed) = clean_legacy_history(values)?;
    if changed {
        write_history(path, &items)?;
    }
    Ok(items)
}

pub fn write_history(path: &Path, items: &[HistoryItem]) -> Result<(), CommandError> {
    let limited = items
        .iter()
        .take(HISTORY_LIMIT)
        .cloned()
        .collect::<Vec<_>>();
    validate_history(&limited)?;
    write_json(path, &limited, "history_write")
}

fn validate_history(items: &[HistoryItem]) -> Result<(), CommandError> {
    let mut total = 0usize;
    for item in items {
        if item.id.chars().count() > 128
            || item.title.trim().is_empty()
            || item.title.chars().count() > 32
            || item.input_summary.chars().count() > 255
            || item.created_at.chars().count() > 64
        {
            return Err(CommandError::new("history_invalid", "历史记录包含无效字段"));
        }
        if let Some(thumbnail) = item.thumbnail.as_deref() {
            validate_thumbnail(thumbnail)?;
        }
        if let Some(info) = item.image_info.as_ref() {
            if info.name.chars().count() > 255
                || info.mime_type.chars().count() > 64
                || info.width as usize > 32_768
                || info.height as usize > 32_768
            {
                return Err(CommandError::new(
                    "history_image_info_invalid",
                    "历史图片信息包含无效字段",
                ));
            }
        }
        if let Some(original) = item.original_image.as_ref() {
            if original.file_name.trim().is_empty()
                || original.file_name.chars().count() > 255
                || original
                    .file_name
                    .chars()
                    .any(|value| value.is_control() || matches!(value, '/' | '\\'))
                || !item
                    .id
                    .bytes()
                    .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
                || !matches!(
                    original.mime_type.as_str(),
                    "image/png" | "image/jpeg" | "image/webp"
                )
                || original.size == 0
                || original.size > 20 * 1024 * 1024
                || original.stored_at.chars().count() > 64
                || original.encryption_version != 1
            {
                return Err(CommandError::new(
                    "history_original_invalid",
                    "历史原图信息包含无效字段",
                ));
            }
        }
        if item.capture_metadata.as_ref().is_some_and(|metadata| {
            [
                metadata.camera_make.as_deref(),
                metadata.camera_model.as_deref(),
                metadata.lens_make.as_deref(),
                metadata.lens_model.as_deref(),
                metadata.focal_length.as_deref(),
                metadata.focal_length_35mm.as_deref(),
                metadata.aperture.as_deref(),
                metadata.exposure_time.as_deref(),
                metadata.iso.as_deref(),
                metadata.exposure_bias.as_deref(),
                metadata.flash.as_deref(),
                metadata.white_balance.as_deref(),
                metadata.captured_at.as_deref(),
                metadata.color_space.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|value| value.chars().count() > 160 || value.chars().any(char::is_control))
        }) {
            return Err(CommandError::new(
                "history_capture_metadata_invalid",
                "文件实拍信息包含无效字段",
            ));
        }
        if item.result.prompt_versions.len() > 8 {
            return Err(CommandError::new(
                "history_prompt_versions_invalid",
                "单条历史记录最多保存 8 个提示词优化版本",
            ));
        }
        for version in &item.result.prompt_versions {
            if version.id.is_empty()
                || version.id.chars().count() > 128
                || version.requirements.chars().count() > 500
                || version
                    .title
                    .as_ref()
                    .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 32)
                || version
                    .source_version_id
                    .as_ref()
                    .is_some_and(|value| value.chars().count() > 128)
                || version.prompts.zh.chars().count() > 50_000
                || version.prompts.en.chars().count() > 50_000
                || version.negative_prompts.zh.chars().count() > 50_000
                || version.negative_prompts.en.chars().count() > 50_000
                || version.metadata.created_at.chars().count() > 64
            {
                return Err(CommandError::new(
                    "history_prompt_versions_invalid",
                    "提示词优化版本包含无效字段",
                ));
            }
        }
        if item
            .result
            .active_prompt_version_id
            .as_ref()
            .is_some_and(|active| {
                !item
                    .result
                    .prompt_versions
                    .iter()
                    .any(|version| &version.id == active)
            })
        {
            return Err(CommandError::new(
                "history_prompt_versions_invalid",
                "当前提示词版本不存在",
            ));
        }
        let bytes = serde_json::to_vec(item)
            .map_err(|error| CommandError::new("history_invalid", error.to_string()))?;
        if bytes.len() > MAX_HISTORY_ITEM_BYTES {
            return Err(CommandError::new(
                "history_item_too_large",
                "单条历史记录超过安全限制",
            ));
        }
        total = total.saturating_add(bytes.len());
    }
    if total > MAX_HISTORY_BYTES {
        return Err(CommandError::new(
            "history_too_large",
            "历史记录总大小超过安全限制",
        ));
    }
    Ok(())
}

fn validate_thumbnail(value: &str) -> Result<(), CommandError> {
    if value.len() > MAX_THUMBNAIL_BYTES {
        return Err(CommandError::new(
            "history_thumbnail_invalid",
            "历史缩略图格式或大小无效",
        ));
    }
    let encoded = [
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
    ]
    .iter()
    .find_map(|prefix| value.strip_prefix(prefix))
    .ok_or_else(|| CommandError::new("history_thumbnail_invalid", "历史缩略图格式或大小无效"))?;
    let decoded = BASE64
        .decode(encoded)
        .map_err(|_| CommandError::new("history_thumbnail_invalid", "历史缩略图数据无效"))?;
    let size = imagesize::blob_size(&decoded)
        .map_err(|_| CommandError::new("history_thumbnail_invalid", "历史缩略图数据无效"))?;
    if size.width > 320 || size.height > 320 {
        return Err(CommandError::new(
            "history_thumbnail_invalid",
            "历史缩略图尺寸超过限制",
        ));
    }
    Ok(())
}

