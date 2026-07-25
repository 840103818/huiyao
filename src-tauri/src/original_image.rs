use std::{
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use chacha20poly1305::{
    aead::{
        generic_array::GenericArray,
        rand_core::RngCore,
        stream::{DecryptorBE32, EncryptorBE32},
        KeyInit, OsRng,
    },
    Key, XChaCha20Poly1305,
};
use chrono::Utc;

use crate::{
    models::{
        CaptureMetadata, CommandError, OriginalImageInfo, OriginalImageStage, OriginalStorageStats,
    },
    store::{ensure_private_dir, set_private_file_permissions},
};

const MAGIC: &[u8; 4] = b"HYOR";
const VERSION: u8 = 1;
const STREAM_NONCE_BYTES: usize = 19;
const CHUNK_BYTES: usize = 256 * 1024;
const TAG_BYTES: usize = 16;
const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE: usize = 32_768;
const MAX_IMAGE_PIXELS: usize = 80_000_000;
const MAX_STAGING_FILES: usize = 5;
const MAX_STAGING_BYTES: u64 = 100 * 1024 * 1024;

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

fn extract_capture_metadata(bytes: &[u8]) -> Option<CaptureMetadata> {
    let exif = exif::Reader::new()
        .read_from_container(&mut Cursor::new(bytes))
        .ok()?;
    let metadata = CaptureMetadata {
        camera_make: exif_text(&exif, exif::Tag::Make),
        camera_model: exif_text(&exif, exif::Tag::Model),
        lens_make: exif_text(&exif, exif::Tag::LensMake),
        lens_model: exif_text(&exif, exif::Tag::LensModel),
        focal_length: exif_text(&exif, exif::Tag::FocalLength),
        focal_length_35mm: exif_text(&exif, exif::Tag::FocalLengthIn35mmFilm),
        aperture: exif_text(&exif, exif::Tag::FNumber),
        exposure_time: exif_text(&exif, exif::Tag::ExposureTime),
        iso: exif_text(&exif, exif::Tag::PhotographicSensitivity),
        exposure_bias: exif_text(&exif, exif::Tag::ExposureBiasValue),
        flash: exif_text(&exif, exif::Tag::Flash),
        white_balance: exif_text(&exif, exif::Tag::WhiteBalance),
        captured_at: exif_text(&exif, exif::Tag::DateTimeOriginal),
        color_space: exif_text(&exif, exif::Tag::ColorSpace),
    };
    (!metadata.is_empty()).then_some(metadata)
}

fn exif_text(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    let field = exif.fields().find(|field| field.tag == tag)?;
    let value = field
        .display_value()
        .with_unit(exif)
        .to_string()
        .trim_matches('"')
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(160)
        .collect::<String>();
    (!value.is_empty()).then_some(value)
}

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

fn encrypt_to_file(path: &Path, plaintext: &[u8], key: &[u8; 32]) -> Result<(), CommandError> {
    let mut nonce = [0u8; STREAM_NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut encryptor = EncryptorBE32::from_aead(cipher, GenericArray::from_slice(&nonce));
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary)
        .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    file.write_all(MAGIC)
        .and_then(|_| file.write_all(&[VERSION]))
        .and_then(|_| file.write_all(&nonce))
        .and_then(|_| file.write_all(&(plaintext.len() as u64).to_be_bytes()))
        .and_then(|_| file.write_all(&(CHUNK_BYTES as u32).to_be_bytes()))
        .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    let chunks = plaintext.chunks(CHUNK_BYTES).collect::<Vec<_>>();
    let (last, preceding) = chunks
        .split_last()
        .ok_or_else(|| CommandError::new("original_encrypt", "原图为空"))?;
    for chunk in preceding {
        let encrypted = encryptor
            .encrypt_next(*chunk)
            .map_err(|_| CommandError::new("original_encrypt", "原图加密失败"))?;
        file.write_all(&encrypted)
            .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    }
    let encrypted = encryptor
        .encrypt_last(*last)
        .map_err(|_| CommandError::new("original_encrypt", "原图加密失败"))?;
    file.write_all(&encrypted)
        .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    file.sync_all()
        .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    fs::rename(&temporary, path)
        .map_err(|error| CommandError::new("original_encrypt", error.to_string()))?;
    set_private_file_permissions(path, "original_encrypt")
}

fn decrypt_file(path: &Path, key: &[u8; 32]) -> Result<Vec<u8>, CommandError> {
    let mut file = File::open(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            CommandError::new("original_missing", "历史原图不存在")
        } else {
            CommandError::new("original_read", error.to_string())
        }
    })?;
    let mut header = [0u8; 4 + 1 + STREAM_NONCE_BYTES + 8 + 4];
    file.read_exact(&mut header)
        .map_err(|_| CommandError::new("original_corrupt", "原图加密文件已损坏"))?;
    if &header[..4] != MAGIC || header[4] != VERSION {
        return Err(CommandError::new(
            "original_corrupt",
            "不支持的原图加密格式",
        ));
    }
    let nonce_start = 5;
    let nonce_end = nonce_start + STREAM_NONCE_BYTES;
    let expected_size =
        u64::from_be_bytes(header[nonce_end..nonce_end + 8].try_into().unwrap()) as usize;
    let chunk_size = u32::from_be_bytes(header[nonce_end + 8..].try_into().unwrap()) as usize;
    if expected_size > MAX_IMAGE_BYTES || chunk_size != CHUNK_BYTES {
        return Err(CommandError::new(
            "original_corrupt",
            "原图加密文件参数无效",
        ));
    }
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let mut decryptor = DecryptorBE32::from_aead(
        cipher,
        GenericArray::from_slice(&header[nonce_start..nonce_end]),
    );
    let chunk_count = expected_size.div_ceil(CHUNK_BYTES);
    let mut output = Vec::with_capacity(expected_size);
    for _ in 0..chunk_count.saturating_sub(1) {
        let mut encrypted = vec![0u8; CHUNK_BYTES + TAG_BYTES];
        file.read_exact(&mut encrypted)
            .map_err(|_| CommandError::new("original_corrupt", "原图加密文件不完整"))?;
        let decrypted = decryptor
            .decrypt_next(encrypted.as_slice())
            .map_err(|_| CommandError::new("original_decrypt", "原图校验失败，文件或密钥无效"))?;
        output.extend_from_slice(&decrypted);
    }
    let final_plain_len = expected_size - chunk_count.saturating_sub(1) * CHUNK_BYTES;
    let mut encrypted = vec![0u8; final_plain_len + TAG_BYTES];
    file.read_exact(&mut encrypted)
        .map_err(|_| CommandError::new("original_corrupt", "原图加密文件不完整"))?;
    let decrypted = decryptor
        .decrypt_last(encrypted.as_slice())
        .map_err(|_| CommandError::new("original_decrypt", "原图校验失败，文件或密钥无效"))?;
    output.extend_from_slice(&decrypted);
    let mut trailing = [0u8; 1];
    if file.read(&mut trailing).unwrap_or(1) != 0 || output.len() != expected_size {
        return Err(CommandError::new(
            "original_corrupt",
            "原图加密文件包含异常数据",
        ));
    }
    Ok(output)
}

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

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    const PNG: &[u8] = include_bytes!("../../src/assets/huiyao-mark.png");

    #[test]
    fn encrypted_original_round_trips_and_rejects_tampering() {
        let root = tempdir().unwrap();
        let key = generate_key();
        let staged = stage(root.path(), PNG, "mark.png", "image/png", &key).unwrap();
        let path = stage_path(root.path(), &staged.staging_id).unwrap();
        let encrypted = fs::read(&path).unwrap();
        assert!(!encrypted.windows(8).any(|window| window == &PNG[..8]));
        assert_eq!(decrypt_file(&path, &key).unwrap(), PNG);

        let mut tampered = encrypted;
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        fs::write(&path, tampered).unwrap();
        assert_eq!(
            decrypt_file(&path, &key).unwrap_err().code,
            "original_decrypt"
        );
    }

    #[test]
    fn wrong_key_cannot_decrypt_original() {
        let root = tempdir().unwrap();
        let key = generate_key();
        let staged = stage(root.path(), PNG, "mark.png", "image/png", &key).unwrap();
        let path = stage_path(root.path(), &staged.staging_id).unwrap();
        assert!(decrypt_file(&path, &generate_key()).is_err());
    }

    #[test]
    fn independent_nonce_produces_different_ciphertext_and_commit_is_reversible() {
        let root = tempdir().unwrap();
        let staging = root.path().join("staging");
        let originals = root.path().join("originals");
        let key = generate_key();
        let first = stage(&staging, PNG, "mark.png", "image/png", &key).unwrap();
        let second = stage(&staging, PNG, "mark.png", "image/png", &key).unwrap();
        assert_ne!(
            fs::read(stage_path(&staging, &first.staging_id).unwrap()).unwrap(),
            fs::read(stage_path(&staging, &second.staging_id).unwrap()).unwrap()
        );

        commit(&staging, &originals, &first.staging_id, "history-1").unwrap();
        assert_eq!(load(&originals, "history-1", &key).unwrap(), PNG);
        assert_eq!(stats(&originals).unwrap().count, 1);
        remove_original(&originals, "history-1").unwrap();
        assert_eq!(stats(&originals).unwrap().count, 0);
    }

    #[cfg(unix)]
    #[test]
    fn encrypted_original_uses_private_permissions() {
        let root = tempdir().unwrap();
        let key = generate_key();
        let staged = stage(root.path(), PNG, "mark.png", "image/png", &key).unwrap();
        let path = stage_path(root.path(), &staged.staging_id).unwrap();
        assert_eq!(
            fs::metadata(root.path()).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn rejects_mismatched_declared_format() {
        let root = tempdir().unwrap();
        let error = stage(root.path(), PNG, "mark.jpg", "image/jpeg", &generate_key()).unwrap_err();
        assert_eq!(error.code, "original_invalid");
    }

    #[test]
    fn images_without_exif_do_not_create_fake_capture_metadata() {
        assert!(extract_capture_metadata(PNG).is_none());
    }

    #[test]
    fn capture_metadata_schema_excludes_private_exif_fields() {
        let metadata = CaptureMetadata {
            camera_model: Some("Camera".into()),
            ..Default::default()
        };
        let serialized = serde_json::to_string(&metadata).unwrap();
        assert!(serialized.contains("cameraModel"));
        assert!(!serialized.to_ascii_lowercase().contains("gps"));
        assert!(!serialized.to_ascii_lowercase().contains("serial"));
        assert!(!serialized.to_ascii_lowercase().contains("copyright"));
    }

    #[test]
    fn staging_quota_bounds_orphaned_uploads() {
        let root = tempdir().unwrap();
        let key = generate_key();
        for _ in 0..MAX_STAGING_FILES {
            stage(root.path(), PNG, "mark.png", "image/png", &key).unwrap();
        }
        let error = stage(root.path(), PNG, "mark.png", "image/png", &key).unwrap_err();
        assert_eq!(error.code, "original_staging_quota");
    }

    #[test]
    fn quarantined_original_can_be_rolled_back_before_index_commit() {
        let root = tempdir().unwrap();
        let staging = root.path().join("staging");
        let originals = root.path().join("originals");
        let key = generate_key();
        let staged = stage(&staging, PNG, "mark.png", "image/png", &key).unwrap();
        commit(&staging, &originals, &staged.staging_id, "history-1").unwrap();
        let quarantine = quarantine_original(&originals, "history-1").unwrap();
        assert!(!original_path(&originals, "history-1").unwrap().exists());
        rollback_quarantined_original(&originals, "history-1", &quarantine).unwrap();
        assert_eq!(load(&originals, "history-1", &key).unwrap(), PNG);
    }

    #[test]
    fn clearing_originals_can_roll_back_or_finalize_as_one_transaction() {
        let root = tempdir().unwrap();
        let staging = root.path().join("staging");
        let originals = root.path().join("originals");
        let key = generate_key();
        for id in ["history-1", "history-2"] {
            let staged = stage(&staging, PNG, "mark.png", "image/png", &key).unwrap();
            commit(&staging, &originals, &staged.staging_id, id).unwrap();
        }

        let quarantined = quarantine_all(&originals).unwrap();
        assert_eq!(quarantined.len(), 2);
        assert_eq!(stats(&originals).unwrap().count, 0);
        rollback_quarantined(&quarantined).unwrap();
        assert_eq!(stats(&originals).unwrap().count, 2);

        let quarantined = quarantine_all(&originals).unwrap();
        finalize_quarantined(&quarantined).unwrap();
        assert_eq!(stats(&originals).unwrap().count, 0);
    }

    #[test]
    fn startup_cleanup_removes_only_quarantined_files() {
        let root = tempdir().unwrap();
        fs::write(root.path().join(".clear-test.delete"), b"pending").unwrap();
        fs::write(root.path().join("keep.txt"), b"keep").unwrap();

        assert_eq!(cleanup_quarantined(root.path()).unwrap(), 1);
        assert!(root.path().join("keep.txt").exists());
    }
}
