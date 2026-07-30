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
- 课程块使用浅色底色，跨节块会覆盖内部横线。

当前不声称支持暗色截图、无网格课表、长截图、严重透视、多个课表拼接或所有学校格式。

## 模块职责

- `preprocess.py`：EXIF 方向修正、缩放、灰度/CLAHE、二值化、小角度校正及坐标变换。
- `grid.py`：OpenCV 形态学提取水平线/垂直线，投影聚类并确定表格外框、星期列、节次行和单元格。
- `blocks.py`：结合网格、浅色块占用率、内部边界强度和颜色连续性定位跨节课程块。
- `ocr.py`：`OcrEngine` 抽象、可测试的 fixture 适配器和本地 CPU `PaddleOcrEngine`。
- `parse_fields.py`：解析课程名、教师、地点、周次和单双周；星期与节次来自网格结构。
- `draft.py`：映射到现有 `ImportDraft V2`，最终值与识别证据分离。
- `rust_validate.py`：调用 `src-tauri/examples/validate_import_draft.rs`，复用现有 Rust 类型、`issues()` 和 `validate()`。
- `synthetic.py`：运行时生成可复现测试图片和 mock OCR token，不提交字体或图片。
- `overlay.py`：单独生成调试图，不修改输入图片。

## 环境与依赖

开发实测基础环境：

- Python `3.13.5`
- OpenCV `4.13.0`
- NumPy `2.3.5`
- Pillow `12.2.0`
- pytest `9.0.2`

OCR 目标依赖：

- PaddlePaddle CPU `3.3.1`
- PaddleOCR `3.7.0`

创建虚拟环境：

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

PaddleOCR 3.x 首次实例化会在本机下载所需模型，后续复用本地缓存。本实验不调用云端 OCR API，也不上传输入图片。需要完全离线运行时，应提前下载模型并在适配器中显式指定本地模型目录；确认不再使用后，可删除 PaddleOCR/PaddleX 在用户目录创建的模型缓存。PaddleOCR 3.x 底层使用 PaddleX，实际缓存位置应以本机日志中的模型目录为准，常见位置为 `%USERPROFILE%\.paddlex` 或 `%USERPROFILE%\.paddleocr`。

## 生成合成样本

```powershell
python -m experiments.screenshot_import generate-synthetic `
  --output output\synthetic
```

会生成：

- `standard_10.png`：7 列、10 节、普通两节连排、单双周、教师/地点、缺失地点和相邻课程块；
- `tilted_12.png`：7 列、12 节、跨三节课程、缩放和约 1.8° 倾斜；
- 对应 `.ocr.json`：仅供 mock OCR 测试使用。

图片由系统字体生成；仓库不包含字体文件。

## 运行识别

实际 PaddleOCR：

```powershell
python -m experiments.screenshot_import recognize `
  --input path\to\timetable.png `
  --output output\recognition `
  --engine paddle `
  --repo-root .
```

可重复 mock 端到端：

```powershell
python -m experiments.screenshot_import recognize `
  --input output\synthetic\standard_10.png `
  --output output\standard_10 `
  --engine fixture `
  --fixture output\synthetic\standard_10.ocr.json `
  --repo-root .
```

实验默认阈值可通过参数调整：

- `>= 0.90`：文本和结构均明确时可 `confirmed`；
- `0.55～0.90`：`review`；
- `< 0.55` 或无法使用：保留候选并进入 `review`/`missing`；
- 结构冲突、裸教师姓名、跨格警告等即使 OCR 分数高也进入 `review`。

这些是实验阈值，不是最终产品规则。

## 输出

输出目录包含：

- `draft.json`：严格复用现有 `ImportDraft V2` 字段；
- `grid.json`：外框、星期列、节次行、单元格、课程块、置信度和警告；
- `ocr.json`：原始 OCR token、原图坐标和置信度；
- `overlay.png`：网格、课程块和字段状态调试图；
- `report.json`：统计、版本、阈值、耗时和 Rust 校验结果。

退出码：

- `0`：图片、网格、课程块、输出结构和 Rust 结构校验成功；草稿可以仍含人工确认项；
- 非 `0`：图片读取、网格、课程块、OCR、JSON 或 Rust 结构校验失败。

## Rust 校验语义

正式 `ImportDraft::validate()` 会把 `review` 和必填 `missing` 视为尚未完成，因此实验工具同时报告：

- `strictValid`：原始识别草稿是否已无需人工确认；
- `reviewOnly`：失败是否只来自人工确认状态；
- `structuralValid`：在仅确认识别状态、完全不改扁平最终值后，现有 Rust 校验是否通过。

这不会放宽或复制生产校验，也不会静默确认输出文件中的字段。

## Overlay 图例

- 紫色：表格外框；
- 蓝色：星期列；
- 灰色：节次行；
- 橙色：课程块；
- 绿色：`confirmed`；
- 黄色：`review`；
- 红色：`missing`。

## 当前执行环境的 OCR 阻塞

本轮环境无法完成真实 PaddleOCR 推理：内部 Python 镜像没有 `paddlepaddle`/`paddleocr` wheel，Paddle 官方 CPU 源又因 DNS 解析失败不可访问。没有伪造 OCR 成功率或 CPU 推理耗时。网格检测、课程块定位、OCR 接口、mock OCR、字段解析、ImportDraft 输出和 Rust 校验入口均可独立运行。

## 下一步边界

下一轮正式接入前需要：

1. 在可安装 PaddlePaddle 的 Windows CPU 环境完成两张及更多合成图实测；
2. 评估模型体积、首次下载、离线策略、许可证和启动耗时；
3. 决定是否采用独立 Tauri sidecar，并定义超时、取消、日志和模型目录；
4. 使用真实但不入库的学校样本校准网格与字段阈值；
5. 通过现有审阅页进行用户可见确认后，才考虑设置页入口。
