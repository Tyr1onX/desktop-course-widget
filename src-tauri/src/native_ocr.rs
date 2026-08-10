include!("native_ocr/runtime.rs");
include!("native_ocr/courses.rs");
include!("native_ocr/grid.rs");
include!("native_ocr/metadata.rs");
include!("native_ocr/support.rs");
include!("native_ocr/traditional_fields.rs");
include!("native_ocr/structural.rs");
include!("native_ocr/tests.rs");
include!("native_ocr/weekday_header_tests.rs");
include!("native_ocr/table_structure_tests.rs");
include!("native_ocr/location_filter_tests.rs");
include!("native_ocr/generalization_regression_tests.rs");
include!("native_ocr/field_association_regression_tests.rs");

pub fn runtime_status() -> Result<(), String> {
    let model_root = resolve_model_root()?;
    for name in [
        "PP-OCRv5_mobile_det_fp16.mnn",
        "PP-OCRv5_mobile_rec_fp16.mnn",
        "ppocr_keys_v5.txt",
    ] {
        if !model_root.join(name).is_file() {
            return Err(format!("本地文字识别模型缺失：{name}"));
        }
    }
    Ok(())
}
