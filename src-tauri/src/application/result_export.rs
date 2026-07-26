use chrono::Local;
use serde_json::json;

use crate::models::{CaptureMetadata, CommandError, PromptOptimizationTarget, ReverseResult};

pub(crate) fn result_markdown(
    result: &ReverseResult,
    capture_metadata: Option<&CaptureMetadata>,
) -> String {
    let active = active_version(result);
    let prompts = active
        .map(|version| &version.prompts)
        .unwrap_or(&result.prompts);
    let metadata = active
        .map(|version| &version.metadata)
        .unwrap_or(&result.metadata);
    let negative = active
        .filter(|version| version.target == PromptOptimizationTarget::Sdxl)
        .map(|version| {
            format!(
                "\n## 中文负面提示词\n\n{}\n\n## 英文负面提示词\n\n{}\n",
                version.negative_prompts.zh, version.negative_prompts.en
            )
        })
        .unwrap_or_default();
    let capture = capture_metadata
        .map(capture_metadata_markdown)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\n## 文件实拍信息\n\n{value}\n"))
        .unwrap_or_default();
    format!(
        "# 绘钥图片反推结果\n{capture}\n## 摄影测定\n\n- **主体**：{}\n- **场景背景**：{}\n- **构图**：{}\n- **光线**：{}\n- **影调曝光**：{}\n- **色彩**：{}\n- **材质**：{}\n- **风格**：{}\n- **镜头成像**：{}\n- **后期处理**：{}\n\n## 中文提示词\n\n{}\n\n## 英文提示词\n\n{}\n{}\n---\n\n- 模型：{}\n- 令牌数：{}\n- 耗时：{:.2} 秒\n- 生成时间：{}\n",
        result.analysis.subject,
        result.analysis.scene,
        result.analysis.composition,
        result.analysis.lighting,
        result.analysis.tonality,
        result.analysis.colors,
        result.analysis.materials,
        result.analysis.style,
        result.analysis.camera,
        result.analysis.post_processing,
        prompts.zh,
        prompts.en,
        negative,
        metadata.model,
        metadata.total_tokens.map(|value| value.to_string()).unwrap_or_else(|| "--".into()),
        metadata.elapsed_ms as f64 / 1000.0,
        format_created_at(&metadata.created_at),
    )
}

pub(crate) fn result_text(result: &ReverseResult) -> String {
    let active = active_version(result);
    let prompts = active
        .map(|version| &version.prompts)
        .unwrap_or(&result.prompts);
    let negative = active.map(|version| &version.negative_prompts);
    let mut sections = Vec::new();
    if !prompts.zh.trim().is_empty() {
        sections.push(format!("中文提示词\n{}", prompts.zh));
    }
    if !prompts.en.trim().is_empty() {
        sections.push(format!("英文提示词\n{}", prompts.en));
    }
    if let Some(negative) = negative {
        if !negative.zh.trim().is_empty() {
            sections.push(format!("中文负面提示词\n{}", negative.zh));
        }
        if !negative.en.trim().is_empty() {
            sections.push(format!("英文负面提示词\n{}", negative.en));
        }
    }
    format!("{}\n", sections.join("\n\n"))
}

pub(crate) fn result_json(
    result: &ReverseResult,
    capture_metadata: Option<&CaptureMetadata>,
) -> Result<Vec<u8>, CommandError> {
    let active = active_version(result);
    let value = json!({
        "schemaVersion": 1,
        "kind": "huiyao.reverse-prompt",
        "captureMetadata": capture_metadata,
        "analysis": result.analysis,
        "activePrompt": {
            "id": active.map(|value| value.id.as_str()).unwrap_or("base"),
            "origin": active.map(|value| json!(value.origin)).unwrap_or_else(|| json!("base")),
            "target": active.map(|value| value.target).unwrap_or(PromptOptimizationTarget::General),
            "title": active.and_then(|value| value.title.as_deref()).unwrap_or("原始反推版本"),
            "prompts": active.map(|value| &value.prompts).unwrap_or(&result.prompts),
            "negativePrompts": active.map(|value| &value.negative_prompts),
            "metadata": active.map(|value| &value.metadata).unwrap_or(&result.metadata),
        },
        "baseMetadata": result.metadata,
    });
    serde_json::to_vec_pretty(&value)
        .map_err(|error| CommandError::new("export_serialize", error.to_string()))
}

pub(crate) fn format_created_at(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|date| {
            date.with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string()
        })
        .unwrap_or_else(|_| "--".into())
}

fn active_version(result: &ReverseResult) -> Option<&crate::models::PromptVersion> {
    result.active_prompt_version_id.as_ref().and_then(|id| {
        result
            .prompt_versions
            .iter()
            .find(|version| &version.id == id)
    })
}

fn capture_metadata_markdown(metadata: &CaptureMetadata) -> String {
    let rows = [
        ("相机品牌", metadata.camera_make.as_deref()),
        ("相机型号", metadata.camera_model.as_deref()),
        ("镜头品牌", metadata.lens_make.as_deref()),
        ("镜头型号", metadata.lens_model.as_deref()),
        ("焦距", metadata.focal_length.as_deref()),
        ("等效焦距", metadata.focal_length_35mm.as_deref()),
        ("光圈", metadata.aperture.as_deref()),
        ("快门", metadata.exposure_time.as_deref()),
        ("ISO", metadata.iso.as_deref()),
        ("曝光补偿", metadata.exposure_bias.as_deref()),
        ("闪光灯", metadata.flash.as_deref()),
        ("白平衡", metadata.white_balance.as_deref()),
        ("拍摄时间", metadata.captured_at.as_deref()),
        ("色彩空间", metadata.color_space.as_deref()),
    ];
    rows.into_iter()
        .filter_map(|(label, value)| value.map(|value| format!("- **{label}**：{value}")))
        .collect::<Vec<_>>()
        .join("\n")
}
