# 标准网格课表截图识别实验

这是 Issue #52 的独立技术实验。它验证本地课表图片能否经过网格检测、课程块定位、OCR、可解释字段解析和人工确认状态映射，生成现有 `ImportDraft V2`，再交给仓库内的 Rust 类型和校验逻辑。

本目录不接入设置页，不提供图片选择或剪贴板入口，不参与正式应用构建，也不会把 Python、PaddleOCR 或模型打包进安装程序。

## 当前 canonical 结论

唯一 canonical benchmark：

- Run ID：`30518750039`
- 基准源 HEAD：`5a81930eecc78854c3a628233fa1d7bbc8e041b9`
- Artifact ID：`8750145689`
- Artifact：`real-paddleocr-benchmark-5a81930eecc78854c3a628233fa1d7bbc8e041b9`
- GitHub artifact digest：`sha256:fd36deab4509304230665a73c3dba618a7f79f1456a3f607d5a7e6205acdbde0`
- 下载 ZIP SHA-256：`fd36deab4509304230665a73c3dba618a7f79f1456a3f607d5a7e6205acdbde0`
- Artifact 大小：`208,772 bytes`
- 到期时间：`2026-08-06T06:23:34Z`

该 Run 在 Windows Server 2025 x64 上使用 Python 3.13.14、PaddlePaddle 3.3.1、PaddleOCR 3.7.0，完成官方模型 bootstrap、16 次真实 block/full OCR、全局课程匹配、字段评估、canonical 完整性校验和脱敏 Artifact 上传。

| 样本 | 模式 | 冷 OCR | 热 OCR 平均 | 冷 pipeline | 热 pipeline 平均 | 值正确/总数 | confirmed/review/missing | unexpected | wrong confirmed rate | 歧义 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | block | 10.153921 s | 10.969456 s | 17.933786 s | 12.100223 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `standard_10` | full | 28.367157 s | 27.893194 s | 29.318483 s | 28.807959 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `tilted_12` | block | 8.409430 s | 8.730079 s | 9.391315 s | 9.768451 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |
| `tilted_12` | full | 25.954214 s | 26.489778 s | 27.056603 s | 27.532324 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |

在两张合成图上，两种模式字段结果一致，block 热 OCR 分别约比 full 快 `2.54×` 和 `3.03×`，因此继续作为实验默认模式。完整环境、缓存、返回结构、字段语义和限制见 [`REAL_OCR_BENCHMARK.md`](./REAL_OCR_BENCHMARK.md)。

本结论只覆盖两张合成图，不代表多学校真实课表准确率。此前真实 OCR Run 仅保留为历史诊断证据，不再作为性能或环境数据引用来源。

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
- `paddle_cpu.py`：Windows CPU 适配层；基于实际 oneDNN/PIR 故障关闭 MKLDNN。
- `benchmark.py`：阈值校验、全图 token 分配和评估入口。
- `course_evaluation.py`：全局课程匹配、匹配歧义、值准确性、审阅状态、unexpected course 和错误自动确认统计。
- `benchmark_io.py`：bootstrap 指标合并、canonical provenance 和机器报告落盘。
- `benchmark_report.py`：生成带可追溯信息和指标语义的人类可读报告。
- `ground_truth.py`：合成样本机器真值。
- `parse_fields.py`：课程名、教师、地点、周次和单双周解析。
- `pipeline.py`：block/full 管道、报告输出和 Rust 校验。
- `model_bootstrap.py`、`real_benchmark.py`：模型下载、缓存、内存、冷/热推理和汇总。
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

canonical Run 证明 Python 3.13 官方 Windows wheel 可用，无需降级 3.12。PaddleOCR 首次运行会下载模型到用户缓存；本实验不调用云端 OCR API，也不上传输入图片。

PaddlePaddle 3.3.1 在 Windows CPU 默认 oneDNN/PIR 路径上真实触发属性转换异常，因此实验使用 `WindowsCpuPaddleOcrEngine` 显式设置 `enable_mkldnn=False`。该结论有失败日志和成功 canonical Run 支撑。

## 生成合成样本

```powershell
python -m experiments.screenshot_import generate-synthetic `
  --output output\synthetic
```

基础样本：

- `standard_10`：10 节、五个课程块、单双周、教师/地点和缺失地点；
- `tilted_12`：12 节、跨三节课程、缩放和约 1.8° 倾斜。

复杂 fixture 还覆盖弱内部线、同色相邻块、缺失边界、双边框、标题装饰线和额外竖线。对应 `.ocr.json` 只用于测试，不是真实 PaddleOCR 输出。

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

默认值为 `review=0.55`、`high=0.90`，只是实验基线，不是最终产品策略。

## 两种 OCR 模式

### block

每个课程块单独裁剪并调用一次 `predict`。canonical 合成图基准中调用次数为 5 和 4，推理耗时明显低于 full，因此继续作为实验默认值。

### full

对完整表格调用一次 `predict`，再按中心点和重叠比例分配 token。跨块歧义与未归属 token 会进入调试输出，不会静默复制。full 保留用于架构比较和调试。

## 评估语义

- `valueAccuracy`：字段值是完全正确、标准化正确、错误或值缺失；
- `reviewStatus`：证据状态是 `confirmed`、`review` 或 `missing`；
- 可选字段真值为空、预测为空时，值可标准化正确，但状态仍可为 `missing`；
- 未匹配预测课程作为 false positive，非 missing 字段计入错误，confirmed 字段进入 `autoConfirmationErrors` 并计入 `wrongConfirmedRate`；
- 课程匹配使用连通分量内的全局最大匹配；同分最优方案进入 `ambiguousCourseMatches`，不会静默选取并宣布唯一正确。

## 单双周安全规则

- 明确识别“单/双”且解析成功时，按置信度和 warning 判断；
- 图片来源没有明确单双周标记时，`parity=all` 强制进入 `review`；
- 周次解析失败时，weeks 与 parity 均进入 `review`；
- 结构 warning 始终覆盖 OCR 高分。

## 输出

每次运行独立输出：

- `draft.json`：现有 `ImportDraft V2`；
- `grid.json`：网格、课程块、warning 和候选诊断；
- `ocr.json`：token、坐标、置信度、全图分配歧义和未归属 token；
- `overlay.png`：调试图；
- `report.json`：模式、调用次数、耗时、内存、缓存、字段评估和 Rust 校验。

批量基准另生成 `benchmark.json` 与 `REAL_OCR_BENCHMARK.md`。无法获得的指标使用 `null`，不使用 0 冒充未测量结果。

## 测试

不依赖模型的实验测试：

```powershell
python -m pip install -r experiments\screenshot_import\requirements-test.txt
python -m pytest experiments\screenshot_import\tests
```

常规 Validate 还执行版本、time-flow、import-review、DOM lifecycle、PresentationClock、Web build、Rust library tests、ImportDraft 示例、两张基础样本的 block/full fixture 管道和 Windows NSIS。

真实 PaddleOCR 基准不进入常规 Validate，只通过手动 `Real PaddleOCR Benchmark` workflow 执行。工作流在上传前强制校验 source HEAD、16 次运行覆盖和完整评估字段。

## 下一阶段本机真实截图入口

本轮没有运行、上传或分析真实学校课表截图。通过最终外部审计后，用户可以在本机用 2～3 张脱敏标准网格截图进行受控测试；本轮不要求立即执行。

测试前必须检查姓名、学号、班级、手机号和其他个人信息。图片不得提交 Git、不得进入 Artifact、不得写入 fixture；模型、缓存和虚拟环境同样不得提交。文件与报告仅使用 `sample-01`、`sample-02` 等匿名编号，所有识别结果仍需人工核对。

创建隔离环境：

```powershell
py -3.13 -m venv .venv-screenshot-ocr
.\.venv-screenshot-ocr\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r experiments\screenshot_import\requirements.txt
```

将脱敏截图保存在仓库外的本机目录，例如 `D:\screenshot-import-private\inputs\sample-01.png`。为每种模式保留独立输出目录：

```powershell
python -m experiments.screenshot_import recognize `
  --input D:\screenshot-import-private\inputs\sample-01.png `
  --output D:\screenshot-import-private\outputs\sample-01-block `
  --engine paddle `
  --ocr-mode block `
  --repo-root .

python -m experiments.screenshot_import recognize `
  --input D:\screenshot-import-private\inputs\sample-01.png `
  --output D:\screenshot-import-private\outputs\sample-01-full `
  --engine paddle `
  --ocr-mode full `
  --assignment-overlap-threshold 0.35 `
  --repo-root .
```

只汇总 block/full 各自的 `report.json` 和人工核对结果，不上传原图、OCR 明文、模型或缓存。人工核对至少包括课程数、漏课、unexpected course、错误且 confirmed 字段、单双周错误和两种模式差异。