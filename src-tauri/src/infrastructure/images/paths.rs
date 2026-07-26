fn stage_path(directory: &Path, id: &str) -> Result<PathBuf, CommandError> {
    safe_path(directory, id)
}

fn original_path(directory: &Path, id: &str) -> Result<PathBuf, CommandError> {
    safe_path(directory, id)
}

fn safe_path(directory: &Path, id: &str) -> Result<PathBuf, CommandError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err(CommandError::new("original_id_invalid", "原图标识无效"));
    }
    Ok(directory.join(format!("{id}.hyi")))
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

