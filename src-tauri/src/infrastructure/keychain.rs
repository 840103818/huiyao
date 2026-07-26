use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use keyring::Entry;

use crate::{models::CommandError, original_image, state::AppState};

const KEYRING_SERVICE: &str = "com.huiyao.studio";
const LEGACY_KEYRING_SERVICE: &str = "com.reverseprompt.studio";
const KEYRING_USER: &str = "openai-compatible-api-key";
const ORIGINAL_KEYRING_USER: &str = "original-image-encryption-key-v1";
pub(crate) const LEGACY_IDENTIFIER: &str = "com.reverseprompt.studio";

fn entry_for_user(service: &str, user: &str) -> Result<Entry, CommandError> {
    Entry::new(service, user)
        .map_err(|error| CommandError::new("keychain_access", error.to_string()))
}

fn api_entry(service: &str) -> Result<Entry, CommandError> {
    entry_for_user(service, KEYRING_USER)
}

fn read_original_key() -> Result<Option<[u8; 32]>, CommandError> {
    let encoded = match entry_for_user(KEYRING_SERVICE, ORIGINAL_KEYRING_USER)?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(CommandError::new("original_key_read", error.to_string())),
    };
    let decoded = BASE64
        .decode(encoded)
        .map_err(|_| CommandError::new("original_key_invalid", "原图加密密钥格式无效"))?;
    decoded
        .try_into()
        .map(Some)
        .map_err(|_| CommandError::new("original_key_invalid", "原图加密密钥长度无效"))
}

pub(crate) fn original_key_for_staging(state: &AppState) -> Result<[u8; 32], CommandError> {
    if let Some(key) = read_original_key()? {
        return Ok(key);
    }
    if original_image::has_originals(&state.originals_path())
        || original_image::has_originals(&state.original_staging_path())
    {
        return Err(CommandError::new(
            "original_key_missing",
            "检测到已加密原图但钥匙串密钥缺失，无法继续保存原图",
        ));
    }
    let key = original_image::generate_key();
    entry_for_user(KEYRING_SERVICE, ORIGINAL_KEYRING_USER)?
        .set_password(&BASE64.encode(key))
        .map_err(|error| CommandError::new("original_key_write", error.to_string()))?;
    Ok(key)
}

pub(crate) fn original_key_for_reading() -> Result<[u8; 32], CommandError> {
    read_original_key()?.ok_or_else(|| {
        CommandError::new(
            "original_key_missing",
            "原图加密密钥已丢失，无法解密；历史分析结果仍可继续使用",
        )
    })
}

pub(crate) fn read_api_key() -> Result<String, CommandError> {
    match api_entry(KEYRING_SERVICE)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(CommandError::new("keychain_read", error.to_string())),
    }
}

pub(crate) fn write_api_key(value: Option<&str>) -> Result<(), CommandError> {
    let entry = api_entry(KEYRING_SERVICE)?;
    match value {
        Some(value) => entry
            .set_password(value)
            .map_err(|error| CommandError::new("keychain_write", error.to_string())),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(CommandError::new("keychain_delete", error.to_string())),
        },
    }
}

pub(crate) fn migrate_legacy_keychain() -> Result<bool, CommandError> {
    let current = api_entry(KEYRING_SERVICE)?;
    match current.get_password() {
        Ok(_) => return Ok(false),
        Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(CommandError::new("keychain_read", error.to_string())),
    }
    let legacy = api_entry(LEGACY_KEYRING_SERVICE)?;
    match legacy.get_password() {
        Ok(value) if !value.is_empty() => {
            current
                .set_password(&value)
                .map_err(|error| CommandError::new("keychain_write", error.to_string()))?;
            Ok(true)
        }
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(CommandError::new("keychain_read", error.to_string())),
    }
}
