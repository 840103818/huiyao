use std::{
    fs::OpenOptions,
    io::{Seek, Write},
    path::Path,
};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{
    application::result_export::{result_json, result_markdown, result_text},
    keychain::original_key_for_reading,
    models::{BatchExportRequest, CommandError},
    original_image, workspace_store,
};

pub(crate) fn write_batch_zip(
    database_path: &Path,
    originals_path: &Path,
    destination: &Path,
    request: &BatchExportRequest,
) -> Result<(), CommandError> {
    if request.task_ids.is_empty() || request.task_ids.len() > 100 {
        return Err(CommandError::new(
            "batch_export_invalid",
            "请选择 1 至 100 个任务",
        ));
    }
    if !request.markdown && !request.json && !request.text && !request.include_originals {
        return Err(CommandError::new(
            "batch_export_invalid",
            "至少选择一种导出内容",
        ));
    }
    let mut file_options = OpenOptions::new();
    file_options.write(true).create_new(true);
    #[cfg(unix)]
    file_options.mode(0o600);
    let file = file_options
        .open(destination)
        .map_err(|_| CommandError::new("batch_export_write", "无法创建批量导出文件"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let original_key = if request.include_originals {
        Some(original_key_for_reading()?)
    } else {
        None
    };
    for (index, task_id) in request.task_ids.iter().enumerate() {
        let task = workspace_store::get_task(database_path, task_id)?;
        let directory = format!("{:03}-{}", index + 1, safe_name(&task.title));
        if let Some(result) = task.result.as_ref() {
            if request.markdown {
                write_entry(
                    &mut zip,
                    &format!("{directory}/result.md"),
                    result_markdown(result, task.capture_metadata.as_ref()).as_bytes(),
                    options,
                )?;
            }
            if request.json {
                write_entry(
                    &mut zip,
                    &format!("{directory}/result.json"),
                    &result_json(result, task.capture_metadata.as_ref())?,
                    options,
                )?;
            }
            if request.text {
                write_entry(
                    &mut zip,
                    &format!("{directory}/prompt.txt"),
                    result_text(result).as_bytes(),
                    options,
                )?;
            }
        }
        if let (true, Some(key)) = (request.include_originals, original_key.as_ref()) {
            if let Ok((asset_id, info)) = workspace_store::task_original(database_path, task_id) {
                let bytes = original_image::load(originals_path, &asset_id, key)?;
                write_entry(
                    &mut zip,
                    &format!("{directory}/original.{}", extension(&info.mime_type)?),
                    &bytes,
                    options,
                )?;
            }
        }
    }
    zip.finish()
        .map_err(|error| CommandError::new("batch_export_write", error.to_string()))?;
    Ok(())
}

fn write_entry<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    body: &[u8],
    options: SimpleFileOptions,
) -> Result<(), CommandError> {
    zip.start_file(name, options)
        .map_err(|error| CommandError::new("batch_export_write", error.to_string()))?;
    zip.write_all(body)
        .map_err(|error| CommandError::new("batch_export_write", error.to_string()))
}

fn safe_name(value: &str) -> String {
    let name = value
        .chars()
        .map(|value| {
            if value.is_control()
                || matches!(value, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            {
                '_'
            } else {
                value
            }
        })
        .take(64)
        .collect::<String>();
    if name.trim().is_empty() {
        "task".into()
    } else {
        name
    }
}

fn extension(mime: &str) -> Result<&'static str, CommandError> {
    match mime {
        "image/png" => Ok("png"),
        "image/jpeg" => Ok("jpg"),
        "image/webp" => Ok("webp"),
        _ => Err(CommandError::new("original_invalid", "原图格式无效")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn batch_export_never_truncates_an_existing_temporary_file() {
        let directory = tempdir().unwrap();
        let destination = directory.path().join("existing.zip.part");
        std::fs::write(&destination, b"keep").unwrap();
        let request = BatchExportRequest {
            task_ids: vec!["task-1".into()],
            markdown: true,
            json: false,
            text: false,
            include_originals: false,
        };

        let error = write_batch_zip(
            &directory.path().join("workspace.sqlite3"),
            &directory.path().join("originals"),
            &destination,
            &request,
        )
        .unwrap_err();

        assert_eq!(error.code, "batch_export_write");
        assert_eq!(std::fs::read(&destination).unwrap(), b"keep");
    }
}
