# 标准网格课表截图识别实验

这是 Issue #52 的独立技术实验。它验证本地课表图片能否经过网格检测、课程块定位、OCR、可解释字段解析和人工确认状态映射，生成现有 `ImportDraft V2`，再交给仓库内的 Rust 类型和校验逻辑。

本目录不接入设置页，不提供图片选择或剪贴板入口，不参与正式应用构建，也不会把 Python、PaddleOCR 或模型打包进安装程序。

## 当前结论

真实 Windows x86-64 CPU 基准已经完成：

- Python `3.13.14`
- PaddlePaddle CPU `3.3.1`
- PaddleOCR `3.7.0`
- 官方 PyPI `cp313-cp313-win_amd64` wheel
- 官方 `PP-OCRv6_medium_det` / `PP-OCRv6_medium_rec` 模型
- `standard_10`、`tilted_12`
- block / full 两种 OCR 模式
- 每组一次冷运行和三次热运行
- 不可访问代理和离线标记下的缓存复用测试
- 逐字段 ground truth、值准确性、审阅状态、额外课程、匹配歧义和错误自动确认率

完整结果见 [`REAL_OCR_BENCHMARK.md`](./REAL_OCR_BENCHMARK.md)。该结果只覆盖两张合成图，不代表多学校真实课表准确率。

## 支持范围

当前实验仅面向：

- PNG、JPG、JPEG；
- 清晰浅色背景和可见网格线；
- 单张完整课表；
- 左侧节次或时间列；
- 7 个星期列；
- 10～14 个节次行；
- 无严重透视畸变；
- 浅色课程块，允许跨节块内部横线缺失或部分可见。

不声称支持暗色截图、无网格课表、长截图、严重透视、多个课表拼接或所有学校格式。

## 模块职责

- `preprocess.py`：EXIF、缩放、灰度/CLAHE、二值化、小角度校正和坐标变换。
- `grid.py`：提取网格线、比较候选、确定星期列、节次行和单元格，并输出候选诊断。
- `blocks.py`：结合浅色块占用率、边界强度和颜色连续性定位课程块。
- `ocr.py`：OCR 抽象、fixture 适配器、Paddle 返回结构兼容和运行时诊断。
- `paddle_cpu.py`：真实 Windows CPU 适配层；基于实际 Paddle 3.3.1 oneDNN/PIR 故障关闭 MKLDNN。
- `benchmark.py`：阈值校验、全图 token 分配和评估入口。
- `course_evaluation.py`：全局课程匹配、匹配歧义、值准确性、审阅状态、unexpected course 和错误自动确认统计。
- `benchmark_report.py`：生成包含可追溯信息和明确指标语义的人类可读基准报告。
- `ground_truth.py`：合成样本机器真值。
- `parse_fields.py`：课程名、教师、地点、周次和单双周解析。
- `pipeline.py`：block / full 管道、报告输出和 Rust 校验。
- `model_bootstrap.py`、`real_benchmark.py`：真实模型下载、缓存、内存、冷/热推理和汇总。
- `draft.py`：映射到现有 `ImportDraft V2`。
- `rust_validate.py`：复用 `src-tauri/examples/validate_import_draft.rs`。
- `synthetic.py`：运行时生成样本和 fixture token，不提交字体或图片。

## 依赖与安装

真实 OCR 锁定版本：

```text
Python 3.13
PaddlePaddle CPU 3.3.1
PaddleOCR 3.7.0
```

Windows 隔离环境：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r experiments\screenshot_import\requirements.txt
```

真实验证中 Python 3.13 官方 Windows wheel 可用，无需降级 3.12。PaddleOCR 首次运行会下载模型到用户缓存；本实验不调用云端 OCR API，也不上传输入图片。

PaddlePaddle 3.3.1 在 Windows CPU 默认 oneDNN/PIR 路径上真实触发属性转换异常，因此实验使用 `WindowsCpuPaddleOcrEngine` 显式设置 `enable_mkldnn=False`。该结论有真实错误日志和成功重跑支撑，不是无证据的版本规避。

## 生成合成样本

```powershell
python -m experiments.screenshot_import generate-synthetic `
  --output output\synthetic
```

基础样本：

- `standard_10`：10 节、五个课程块、单双周、教师/地点和缺失地点；
- `tilted_12`：12 节、跨三节课程、缩放和约 1.8° 倾斜。

复杂课程块与网格样本还覆盖弱内部线、同色相邻块、缺失边界、双边框、标题装饰线和额外竖线。

对应 `.ocr.json` 只用于 fixture 测试，不是真实 PaddleOCR 输出。

## 运行识别

逐课程块 OCR：

```powershell
python -m experiments.screenshot_import recognize `
  --input path\to\timetable.png `
  --output output\block `
  --engine paddle `
  --ocr-mode block `
  --repo-root .
```

全图 OCR：

```powershell
python -m experiments.screenshot_import recognize `
  --input path\to\timetable.png `
  --output output\full `
  --engine paddle `
  --ocr-mode full `
  --assignment-overlap-threshold 0.35 `
  --repo-root .
```

fixture 管道：

```powershell
python -m experiments.screenshot_import recognize `
  --input output\synthetic\standard_10.png `
  --output output\standard_10 `
  --engine fixture `
  --fixture output\synthetic\standard_10.ocr.json `
  --ground-truth output\synthetic\standard_10.ground-truth.json `
  --repo-root .
```

阈值必须满足：

```text
0 <= review-confidence <= high-confidence <= 1
```

无效阈值在 OCR 和输出目录创建前失败。默认值仍为 `review=0.55`、`high=0.90`，只是实验基线，不是最终产品策略。

## 两种 OCR 模式

### block

每个课程块单独裁剪并调用一次 `predict`。真实合成图基准中调用次数为 5 和 4，但推理和内存均显著优于 full，因此继续作为实验默认值。

### full

对完整表格调用一次 `predict`，再按中心点和重叠比例分配 token：

1. 中心点只命中一个课程块时分配；
2. 未命中时按重叠阈值分配；
3. 同时命中多个块时标记歧义；
4. 表头、节次等未归属 token 只保留在调试输出。

full 模式保留用于架构比较和未来真实布局验证，不作为当前默认结论。

## 评估语义

评估结果明确拆为两套维度：

- `valueAccuracy`：字段值是完全正确、标准化后正确、错误或值缺失；
- `reviewStatus`：字段证据状态是 `confirmed`、`review` 或 `missing`。

可选字段真值为空、预测为空时，值可以是标准化后正确，同时审阅状态仍为 `missing`。旧 `counts.missing` 仅是 `valueAccuracy.valueMissing` 的兼容别名，审阅状态缺失使用 `counts.statusMissing`。

没有匹配任何 ground truth 的预测课程会进入 `unexpectedCourses` / `falsePositiveCourseCount`。其中所有非 missing 字段都算错误；`confirmed` 字段会进入 `autoConfirmationErrors` 并影响 `wrongConfirmedRate`。

课程匹配使用连通分量内的全局最大匹配，不依赖预测课程顺序。存在多个同分全局最优方案时，会输出 `ambiguousCourseMatches`，不会静默宣布唯一正确。

## 单双周安全规则

- 明确识别“单/双”且解析成功时，按置信度和 warning 判断；
- 图片来源没有明确单双周标记时，`parity=all` 强制进入 `review`；
- 周次解析失败时，weeks 与 parity 均进入 `review`；
- 结构 warning 始终覆盖 OCR 高分。

这避免 `1-15周(单)` 被 OCR 漏掉“单”后静默确认成每周。

## 输出

每次运行独立输出目录，包含：

- `draft.json`：现有 `ImportDraft V2`；
- `grid.json`：网格、课程块、warning 和候选诊断；
- `ocr.json`：token、坐标、置信度、全图分配歧义和未归属 token；
- `overlay.png`：调试图；
- `report.json`：模式、调用次数、初始化/推理/管道耗时、峰值内存、缓存、字段评估和 Rust 校验。

真实批量基准另生成：

- `benchmark.json`；
- `REAL_OCR_BENCHMARK.md`。

无法获得的指标使用 `null`，不使用 0 冒充未测量结果。

## 测试

不依赖模型的完整实验测试：

```powershell
python -m pip install -r experiments\screenshot_import\requirements-test.txt
python -m pytest experiments\screenshot_import\tests
```

常规 Validate 还执行：

- 版本、time-flow、import-review、Edge DOM、presentation clock；
- web build；
- Rust library tests；
- ImportDraft 校验示例预编译；
- 两张基础样本的 block / full fixture 管道和 Rust 校验；
- Windows Tauri Release / NSIS。

真实 PaddleOCR 大模型基准不进入每次 Validate，只通过手动 `Real PaddleOCR Benchmark` workflow 执行。

## 下一阶段真实样本边界

完成最终权威基准并通过外部审计后，下一阶段仅邀请 2～3 张受控标准网格课表在用户本机测试：

- 用户在本机保存，不提交 Git、不进入 Artifact、不加入 fixture；
- 报告只使用匿名编号；
- 提供前检查姓名、学号、班级和其他个人信息；
- 所有识别结果仍需人工审阅。

具体命令和汇总格式见 [`REAL_SCREENSHOT_TESTING.md`](./REAL_SCREENSHOT_TESTING.md)。
