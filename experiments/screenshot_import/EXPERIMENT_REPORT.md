# 截图课表识别实验执行记录

## 当前基线与范围

- 分支：`feat/screenshot-recognition-spike`
- PR：#72，Draft、Open、未合并
- 实验相对最新 `main`：behind 0
- 净 diff 仅允许 `.github/workflows/**`、`experiments/**` 和 `src-tauri/examples/validate_import_draft.rs`
- 正式设置页、图片入口、Excel 导入、事务、课程管理、网站、动画、Nexus 和安装包内容均未接入或修改

本轮没有运行、上传或分析任何真实学校课表截图。

## 唯一 canonical benchmark

- Workflow：`Real PaddleOCR Benchmark`
- Run ID：`30518005940`
- 基准源 HEAD：`486300eded50134e32b98cec631bc944eb4e5bd3`
- Workflow event SHA：`e1c87637ebb50fc4c628b36053783749b7a60a22`
- Artifact ID：`8749892221`
- Artifact：`real-paddleocr-benchmark-486300eded50134e32b98cec631bc944eb4e5bd3`
- GitHub artifact digest：`sha256:591d73f733d7a45705e08f150c1ea52596791b6341db28f99a11e7e70f93904d`
- Artifact 大小：`211,494 bytes`
- 生成时间：`2026-07-30T06:10:02.109262+00:00`
- 到期时间：`2026-08-06T06:10:02Z`

该 Run 的环境安装、Rust 校验器预编译、模型 bootstrap、16 次真实 OCR、指标合并、报告渲染、canonical 完整性门禁和 Artifact 上传全部成功。此前运行只作为历史诊断证据，不再作为环境或性能数据来源。

完整数据见 [`REAL_OCR_BENCHMARK.md`](./REAL_OCR_BENCHMARK.md)。

## 结果口径

严格区分：

- **fixture pipeline result**：结构检测真实执行，OCR token 来自合成 `.ocr.json`；
- **real PaddleOCR result**：真实调用 PaddleOCR 3.7.0 / PaddlePaddle 3.3.1 CPU 模型；
- **valueAccuracy**：字段值完全正确、标准化正确、错误或值缺失；
- **reviewStatus**：字段证据状态 confirmed、review 或 missing；
- **Rust structural validation**：证明草稿可由现有 Rust 类型解析并通过结构校验。

模型下载、初始化、冷/热推理、Rust 冷编译和调试写入分别记录，不合并成单一“识别耗时”。

## 已完成实验能力

- 标准 7 天网格和 10～14 节次行；
- 课程块、跨节范围、弱边界与颜色连续性；
- 网格候选筛选与歧义诊断；
- PaddleOCR 3.x 返回结构兼容；
- block/full 两种 OCR 模式；
- 全图 token 分配、跨块歧义和未归属输出；
- 课程名、教师、地点、周次和单双周解析；
- ImportDraft V2 映射与 Rust 校验；
- 机器可读 ground truth；
- 连通分量内的全局最大课程匹配；
- unexpected course、匹配歧义和错误自动确认统计；
- 模型缓存、网络阻断复用、冷/热推理和内存测量。

## 结构检测结果

| 样本 | 结果 |
|---|---|
| `standard_10` | 7×10，5/5 课程块，网格置信度约 0.9846 |
| `tilted_12` | 7×12，4/4 课程块，约 1.8° 倾斜校正，保留候选歧义 warning |
| `weak_internal_line_10` | 同色连续跨三节块正确合并，弱边界进入 review |
| `similar_adjacent_10` | 同色相邻独立课程保持分离 |
| `distinct_missing_boundary_10` | 异色缺失边界保持分离并警告两侧 |
| `double_border_10` | 从多余边框候选中选择正确内框 |
| `title_decoration_10` | 标题装饰横线未被识别为表头 |
| `extra_vertical_10` | 跳过额外竖线，星期列未偏移 |

结构 warning 会使 weekday、startSection、endSection 进入 review，不被 OCR 高分覆盖。

## Canonical Windows CPU 环境

- Windows Server 2025 x64
- Python 3.13.14
- pip 26.2
- PaddlePaddle 3.3.1
- PaddleOCR 3.7.0
- 官方 wheel：`paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl`
- wheel：104,794,530 bytes
- 安装：68.105691 s
- 隔离虚拟环境：849,659,311 bytes
- oneDNN：关闭

PaddlePaddle 3.3.1 默认 oneDNN/PIR 路径在前置真实运行中触发 `pir::ArrayAttribute<pir::DoubleAttribute>` 转换异常。实验保留版本，使用 `enable_mkldnn=False` 后 canonical Run 完成全部推理。

## 模型、缓存和返回结构

- `PP-OCRv6_medium_det`：62,273,512 bytes
- `PP-OCRv6_medium_rec`：76,837,481 bytes
- 缓存总计：139,110,993 bytes
- 缓存写入：92.946170 s
- 首次初始化：173.365640 s
- 首次预测：29.287120 s
- 初始化 RSS：419.668 MB
- bootstrap 峰值内存：490.047 MB
- 不可访问代理与离线标记下缓存初始化：0.994001 s，37 token，成功

真实 `predict()` 返回顶层 list、单个 `OCRResult`；`.json` 为 dict 属性，`rec_boxes` 是 shape `[37, 4]`、dtype `int16` 的 NumPy 数组，其余主要字段为 list。

## Block/full canonical 对比

| 样本 | 模式 | predict | 冷 OCR | 热 OCR 平均 | 冷 pipeline | 热 pipeline 平均 | 值正确/总数 | unexpected | wrong confirmed | 歧义 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | block | 5 | 10.384034 s | 11.476607 s | 17.679286 s | 12.345182 s | 40/40 | 0 | 0 | 0 |
| `standard_10` | full | 1 | 33.014611 s | 27.757325 s | 33.874143 s | 28.604932 s | 40/40 | 0 | 0 | 0 |
| `tilted_12` | block | 4 | 8.314605 s | 8.811158 s | 9.218626 s | 9.757986 s | 32/32 | 0 | 0 | 0 |
| `tilted_12` | full | 1 | 26.486853 s | 26.863633 s | 27.470095 s | 27.849931 s | 32/32 | 0 | 0 | 0 |

block 热 OCR 在两张合成图上分别约比 full 快 `2.42×`、`3.05×`，且字段输出一致，因此保持为实验默认值。该结论不代表真实学校布局。

## 字段与审阅状态

### `standard_10`

- 课程：expected/predicted/matched = 5/5/5
- 值：39 完全正确、1 标准化正确、0 错误、0 值缺失
- 状态：confirmed 35、review 4、missing 1
- unexpected 0、错误 confirmed 0、匹配歧义 0

### `tilted_12`

- 课程：expected/predicted/matched = 4/4/4
- 值：31 完全正确、1 标准化正确、0 错误、0 值缺失
- 状态：confirmed 29、review 2、missing 1
- unexpected 0、错误 confirmed 0、匹配歧义 0

两个标准化正确字段都是真值为空、预测为 null 的可选地点；值正确，证据状态仍为 missing。

## 单双周与自动确认

- 明确 odd/even 标记被正确解析；
- 图片来源没有明确单双周标记时，`parity=all` 强制 review；
- 周次解析失败或结构 warning 不因 OCR 高分绕过复核；
- canonical 样本没有单双周错误自动确认。

两张合成图未自然产生“单→旦”“双→又”等错误，不能据此推断真实截图发生率，也没有证据支持放宽阈值。

## 自动化边界

常规 Validate 不下载 Paddle 模型，只运行：

- 全部 Python 实验测试；
- 两张样本的 block/full fixture 管道；
- Rust library tests 和 ImportDraft 示例；
- version、time-flow、import-review、DOM lifecycle、PresentationClock；
- Web build 和 Windows NSIS。

真实模型基准只通过手动 `Real PaddleOCR Benchmark` workflow 执行。工作流在 Artifact 上传前校验源 HEAD、16 次运行覆盖和完整评估字段。

当前仍是独立实验，尚未达到正式设置页接入、免审保存或多学校支持声明条件。
