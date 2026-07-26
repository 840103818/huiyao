fn validate_source(bytes: &[u8], file_name: &str, mime_type: &str) -> Result<(), CommandError> {
    if bytes.is_empty()
        || bytes.len() > MAX_IMAGE_BYTES
        || file_name.trim().is_empty()
        || file_name.chars().count() > 255
        || file_name
            .chars()
            .any(|value| value.is_control() || matches!(value, '/' | '\\'))
    {
        return Err(CommandError::new(
            "original_invalid",
            "原图为空或超过 20 MB 限制",
        ));
    }
    let actual = detect_mime(bytes)
        .ok_or_else(|| CommandError::new("original_invalid", "无法识别原图格式"))?;
    if actual != mime_type || !matches!(actual, "image/png" | "image/jpeg" | "image/webp") {
        return Err(CommandError::new(
            "original_invalid",
            "原图格式与文件声明不一致",
        ));
    }
    let size = imagesize::blob_size(bytes)
        .map_err(|_| CommandError::new("original_invalid", "无法识别原图尺寸"))?;
    if size.width > MAX_IMAGE_EDGE
        || size.height > MAX_IMAGE_EDGE
        || size.width.saturating_mul(size.height) > MAX_IMAGE_PIXELS
    {
        return Err(CommandError::new(
            "original_dimensions",
            "原图像素尺寸超过限制",
        ));
    }
    Ok(())
}

pub fn validate_staged_source(
    bytes: &[u8],
    file_name: &str,
    mime_type: &str,
    expected_size: u64,
) -> Result<(), CommandError> {
    validate_source(bytes, file_name, mime_type)?;
    if bytes.len() as u64 != expected_size {
        return Err(CommandError::new(
            "original_stage_mismatch",
            "原图暂存信息与文件内容不一致",
        ));
    }
    Ok(())
}

fn detect_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

