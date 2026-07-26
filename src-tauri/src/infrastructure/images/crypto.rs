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

