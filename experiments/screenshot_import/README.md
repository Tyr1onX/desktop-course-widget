# 标准网格课表截图识别实验

这是 Issue #52 的独立技术实验。它验证本地课表图片能否经过网格检测、课程块定位、OCR 和可解释规则解析，生成仓库现有的 `ImportDraft V2` JSON，再交给现有 Rust `ImportDraft` 反序列化与校验。

本目录不接入设置页，不提供图片选择按钮，不参与正式应用构建，也不会把 Python、PaddleOCR 或模型打包进安装程序。

## 支持范围

第一版只面向：

- PNG、JPG、JPEG；
- 清晰浅色背景和可见网格线；
- 单张完整课表；
- 左侧节次或时间列；
- 7 个星期列；
- 10～14 个节次行；
- 无严重透视畸变；
- 浅色课程块，允许跨节块内部横线完全缺失或部分可见。

当前不声称支持暗色截图、无网格课表、长截图、严重透视、多个课表拼接或所有学校格式。

## 模块职责

- `preprocess.py`：EXIF 方向修正、缩放、灰度/CLAHE、二值化、小角度校正及坐标变换。
- `grid.py`：OpenCV 形态学提取水平线/垂直线，保留原始候选，比较候选方案并确定外框、星期列、节次行和单元格。
- `blocks.py`：结合浅色块占用率、内部边界强度和颜色连续性定位跨节课程块；模糊边界会产生 warning。
- `ocr.py`：`OcrEngine` 抽象、fixture 适配器和本地 CPU `PaddleOcrEngine`；安全处理 list、tuple、NumPy 数组及 PaddleOCR 多种结果对象。
- `parse_fields.py`：解析课程名、教师、地点、周次和单双周；星期与节次来自网格结构。
- `draft.py`：映射到现有 `ImportDraft V2`，扁平最终值与识别证据分离。
- `rust_validate.py`：调用 `src-tauri/examples/validate_import_draft.rs`，复用现有 Rust 类型、`issues()` 和 `validate()`。
- `synthetic.py`：运行时生成可复现测试图片和 fixture OCR token，不提交字体或图片。
- `overlay.py`：单独生成调试图，不修改输入图片。

## 环境与依赖

已运行基础代码和测试的环境：

- Python `3.13.5`
- OpenCV `4.13.0`
- NumPy `2.3.5`
- Pillow `12.2.0`
- pytest `9.0.2`

真实 OCR 目标依赖：

- PaddlePaddle CPU `3.3.1`
- PaddleOCR `3.7.0`

Windows 隔离环境安装示例：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r experiments\screenshot_import\requirements.txt
```

只运行不依赖模型的测试：

```powershell
python -m pip install -r experiments\screenshot_import\requirements-test.txt
python -m pytest experiments\screenshot_import\tests
```

PaddleOCR 3.x 首次实例化通常会在本机下载模型，后续复用本地缓存。本实验不调用云端 OCR API，也不上传输入图片。完全离线运行时应提前准备模型并显式指定本地模型目录。缓存位置以本机 PaddleOCR/PaddleX 日志为准，常见目录为 `%USERPROFILE%\.paddlex` 或 `%USERPROFILE%\.paddleocr`；清理前应确认没有其他 PaddleX 项目复用该缓存。

## 合成样本

```powershell
python -m experiments.screenshot_import generate-synthetic `
  --output output\synthetic
```

基础 fixture 管道样本：

- `standard_10`：7 列、10 节、五个课程块、单双周、教师/地点、缺失地点和相邻课程块；
- `tilted_12`：7 列、12 节、跨三节课程、缩放和约 1.8° 倾斜。

复杂课程块样本：

- `weak_internal_line_10`：跨三节课程保留部分内部横线，同色连续时合并并进入结构复核；
- `similar_adjacent_10`：两个同色相邻独立课程，中间横线清晰，必须保持分离；
- `distinct_missing_boundary_10`：两个异色相邻课程缺少中间横线，保持分离并对两侧产生 warning。

复杂网格样本：

- `double_border_10`：表格外围双边框；
- `title_decoration_10`：表格上方长装饰横线；
- `extra_vertical_10`：左侧节次列附近额外竖线。

对应 `.ocr.json` 仅供 fixture 测试使用，不是 PaddleOCR 输出。图片由系统字体生成，仓库不包含字体文件。

## 运行识别

真实本地 PaddleOCR：

```powershell
python -m experiments.screenshot_import recognize `
  --input path\to\timetable.png `
  --output output\recognition `
  --engine paddle `
  --repo-root .
```

可重复 fixture 管道：

```powershell
python -m experiments.screenshot_import recognize `
  --input output\synthetic\standard_10.png `
  --output output\standard_10 `
  --engine fixture `
  --fixture output\synthetic\standard_10.ocr.json `
  --repo-root .
```

实验默认字段阈值：

- `>= 0.90`：文本和结构均明确时可 `confirmed`；
- `0.55～0.90`：`review`；
- `< 0.55` 或无法使用：保留候选并进入 `review`/`missing`；
- 结构冲突、弱跨格边界、裸教师姓名等即使 OCR 分数高也进入 `review`。

这些是实验阈值，不是最终产品规则。

## 输出

输出目录包含：

- `draft.json`：严格复用现有 `ImportDraft V2`；
- `grid.json`：外框、星期列、节次行、课程块、warning，以及 `candidateDiagnostics`；
- `ocr.json`：原始 OCR token、原图坐标和置信度；
- `overlay.png`：网格、课程块和字段状态调试图；
- `report.json`：结果类型、版本、状态统计、分阶段耗时和 Rust 校验结果。

`candidateDiagnostics` 分别记录横线和竖线的原始候选数、最终索引、候选方案数、最佳/次佳得分、得分差、是否筛选和是否歧义。该信息只用于实验调试，不进入正式 `ImportDraft`。

退出码：

- `0`：图片、网格、课程块、输出结构和 Rust 结构校验成功；草稿可以仍含人工确认项；
- 非 `0`：图片读取、网格、课程块、OCR、JSON 或 Rust 结构校验失败。

## 结果和耗时口径

必须区分：

- `fixture pipeline result`：图片网格/课程块是真实运行，OCR token 来自 `.ocr.json`；
- `real PaddleOCR result`：真实调用本地 `PaddleOcrEngine.predict()`；
- `grid/block detection result`：只评价网格和课程块，不代表文本准确率；
- `field parsing result`：只评价规则解析；
- `Rust structural validation result`：只证明 JSON 可由现有 Rust 类型反序列化并满足结构约束。

`report.json` 分别记录：

- `preprocessSeconds`；
- `gridSeconds`；
- `blockDetectionSeconds`；
- `ocrInferenceSeconds`；
- `fieldParsingSeconds`；
- `debugOutputSeconds`；
- `rustValidationSeconds`；
- `totalPipelineSeconds`；
- Paddle 适配器可用时另记录初始化和累计推理时间。

Cargo 首次编译、Paddle 模型首次下载、PaddleOCR 初始化、单图热推理和调试文件写入不得合并为一个“单图 OCR 耗时”。

## Rust 校验语义

正式 `ImportDraft::validate()` 会把 `review` 和必填 `missing` 视为尚未完成，因此实验工具同时报告：

- `strictValid`：原始识别草稿是否已无需人工确认；
- `reviewOnly`：失败是否只来自人工确认状态；
- `structuralValid`：在仅确认识别状态、完全不改扁平最终值后，现有 Rust 校验是否通过。

这不会放宽或复制生产校验，也不会静默确认输出文件中的字段。

## 当前真实 OCR 阻塞

本轮已在独立 Python 3.13.5 虚拟环境中执行以下安装尝试：

```text
python -m pip install --index-url https://pypi.org/simple paddlepaddle==3.3.1 paddleocr==3.7.0
python -m pip install --index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ paddlepaddle==3.3.1
```

两个公开源均在连接阶段出现 `Temporary failure in name resolution`，随后 pip 报告没有取得任何可用发行包。因此没有发生模型下载，没有产生 Paddle 缓存，也没有运行真实 `PaddleOcrEngine`。不得将 fixture 结果描述为真实 OCR 准确率或真实 OCR CPU 耗时。

## 下一步边界

进入多学校样本评估前仍需：

1. 在可访问 PyPI/Paddle 官方源的 Windows CPU 环境安装目标版本；
2. 单独预编译 Rust 示例，再测量 Paddle 初始化、模型下载、冷启动和热推理；
3. 对两张基础合成图运行真实 PaddleOCR，并审查是否存在错误自动确认；
4. 使用真实但不入库的学校样本校准网格、颜色和字段阈值；
5. 完成准确率与资源占用评估后，再决定是否研究独立 Tauri sidecar。
