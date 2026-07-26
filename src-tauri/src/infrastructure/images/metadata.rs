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

