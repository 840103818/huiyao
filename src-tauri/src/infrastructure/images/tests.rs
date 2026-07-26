#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    const PNG: &[u8] = include_bytes!("../../../../src/assets/huiyao-mark.png");

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
