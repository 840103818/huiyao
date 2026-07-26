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

include!("staging.rs");
include!("metadata.rs");
include!("storage.rs");
include!("validation.rs");
include!("crypto.rs");
include!("paths.rs");
include!("tests.rs");
