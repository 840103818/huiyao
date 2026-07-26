fn read_bounded(path: &Path, max_bytes: usize, code: &str) -> Result<String, CommandError> {
    let metadata =
        fs::metadata(path).map_err(|error| CommandError::new(code, error.to_string()))?;
    if metadata.len() > max_bytes as u64 {
        return Err(CommandError::new(code, "本地数据文件超过安全限制"));
    }
    fs::read_to_string(path).map_err(|error| CommandError::new(code, error.to_string()))
}

fn write_json<T: serde::Serialize + ?Sized>(
    path: &Path,
    value: &T,
    code: &str,
) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent, code)?;
    }
    let body = serde_json::to_vec_pretty(value)
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    let temporary = path.with_extension("tmp");
    write_private_file(&temporary, &body, code)?;
    fs::rename(&temporary, path).map_err(|error| CommandError::new(code, error.to_string()))?;
    set_private_file_permissions(path, code)
}

pub fn ensure_private_dir(path: &Path, code: &str) -> Result<(), CommandError> {
    fs::create_dir_all(path).map_err(|error| CommandError::new(code, error.to_string()))?;
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    Ok(())
}

pub fn write_private_file(path: &Path, body: &[u8], code: &str) -> Result<(), CommandError> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent, code)?;
    }
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(path)
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    file.write_all(body)
        .and_then(|_| file.sync_all())
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    set_private_file_permissions(path, code)
}

pub fn set_private_file_permissions(path: &Path, code: &str) -> Result<(), CommandError> {
    #[cfg(unix)]
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| CommandError::new(code, error.to_string()))?;
    Ok(())
}

