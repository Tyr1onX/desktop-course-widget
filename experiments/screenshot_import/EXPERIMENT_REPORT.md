# 截图课表识别实验执行记录

## 当前基线

- 分支：`feat/screenshot-recognition-spike`
- PR：#72，Draft、Open、未合并
- 实验相对最新 `main`：behind 0
- 净 diff：仅实验目录、一个手动真实 OCR workflow、必要 Validate 和 Rust ImportDraft 校验示例
- 正式设置页、图片入口、Excel 导入、事务、课程管理、网站、动画、Nexus 和 NSIS 内容均未接入或修改

## 结果口径

严格区分：

- **fixture pipeline result**：结构检测真实执行，OCR token 来自合成 `.ocr.json`；
- **real PaddleOCR result**：真实调用 PaddleOCR 3.7.0 / PaddlePaddle 3.3.1 CPU 模型；
- **field evaluation**：按机器真值逐字段比较；
- **Rust structural validation**：证明草稿可由现有 Rust 类型解析，并区分结构错误与待人工确认状态。

模型下载、Paddle 初始化、冷/热推理、Rust 首次编译和调试文件写入分别记录，不合并为单一“识别耗时”。

完整真实数据见 [`REAL_OCR_BENCHMARK.md`](./REAL_OCR_BENCHMARK.md)。

## 已完成实验能力

- 标准 7 天网格检测；
- 10～14 节次行；
- 课程块和跨节范围检测；
- 弱边界、缺失边界与颜色连续性；
- 网格候选筛选与歧义诊断；
- PaddleOCR 3.x 返回结构兼容；
- block / full 两种 OCR 模式；
- 全图 token 中心点和重叠比例分配；
- token 跨块歧义与未归属调试输出；
- 课程名、教师、地点、周次、单双周解析；
- ImportDraft V2 映射；
- Rust 结构校验；
- 机器可读 ground truth；
- 字段正确、错误、缺失和 confirmed/review 混淆统计；
- 错误自动确认率；
- 模型下载、缓存、离线启动、冷/热推理、内存和输出大小测量。

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

## 真实 Windows CPU 环境

- Windows Server 2025 x64
- Python 3.13.14
- pip 26.2
- PaddlePaddle 3.3.1
- PaddleOCR 3.7.0
- 官方 PyPI `paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl`
- wheel 大小 104,794,530 bytes
- 安装耗时 71.4094694 s
- 虚拟环境 849,741,223 bytes

Python 3.13 官方 wheel 可用，没有降级 3.12。

PaddlePaddle 3.3.1 默认 oneDNN/PIR 路径在首次真实推理中触发 `pir::ArrayAttribute<pir::DoubleAttribute>` 转换异常。实验使用有真实失败证据支撑的 `enable_mkldnn=False`，随后模型和完整基准均成功；没有更换版本或使用未知 wheel。

## 模型和返回结构

- `PP-OCRv6_medium_det`：62,273,512 bytes
- `PP-OCRv6_medium_rec`：76,837,481 bytes
- 缓存总计：139,110,993 bytes
- 缓存目录：`%USERPROFILE%\.paddlex`
- 观察到的模型缓存写入：23.9724856 s
- 首次初始化总耗时：57.9035817 s
- bootstrap 峰值内存：498.188 MB
- 完全离线缓存初始化和推理：成功

真实 `predict()` 返回：

- 顶层 `list`；
- 单项 `paddlex.inference.pipelines.ocr.result.OCRResult`；
- `.json` 是不可调用的 `dict` 属性；
- 无 `to_dict()`；
- `rec_boxes` 为 shape `[37, 4]`、dtype `int16` 的 NumPy 数组；
- 其余文本、分数和多边形字段为 list。

当前适配器真实覆盖该结构，并保留旧兼容分支。

## block / full 对比

| 样本 | 模式 | predict | 冷 OCR | 热 OCR 平均 | 热管道平均 |
|---|---|---:|---:|---:|---:|
| `standard_10` | block | 5 | 10.402373 s | 10.083595 s | 10.935031 s |
| `standard_10` | full | 1 | 26.631320 s | 29.804321 s | 30.660159 s |
| `tilted_12` | block | 4 | 8.516407 s | 8.016003 s | 8.971746 s |
| `tilted_12` | full | 1 | 25.505942 s | 26.203480 s | 27.420503 s |

两种模式字段输出一致，但 block 热推理快约 2.96～3.27 倍且峰值内存更低。因此保持 block 为实验默认，full 只用于架构对照和未来真实布局验证。

## 字段评估

### `standard_10`

- 5/5 课程；
- 40 个字段；
- 39 个完全正确，1 个可选空地点标准化后正确；
- confirmed 35、review 4、missing 1；
- 错误字段 0；
- 错误且 confirmed 0；
- 错误自动确认率 0。

### `tilted_12`

- 4/4 课程；
- 32 个字段；
- 31 个完全正确，1 个可选空地点标准化后正确；
- confirmed 29、review 2、missing 1；
- 错误字段 0；
- 错误且 confirmed 0；
- 错误自动确认率 0。

每种架构合计 confirmed 64、review 6、missing 2。review 包含 5 个没有显式单双周标记的 `parity=all`，以及裸教师姓名“李明”；missing 仅为两个真值本来为空的可选地点。

## 单双周与自动确认

真实 OCR 正确识别 `(单)`、`(双)` 和周次范围。显式 odd/even 可按置信度确认；图片来源没有明确单双周标记时，`parity=all` 强制 review。周次解析或结构 warning 也始终覆盖 OCR 高分。

两张合成图没有产生“单→旦”“双→又”等自然错误，不能据此推断真实学校截图的发生率。当前没有证据支持放宽自动确认规则，也不把实验阈值宣布为最终产品阈值。

## 自动化与人工边界

常规 Validate 不下载 Paddle 模型，只运行：

- 全部 Python 实验测试；
- 两张样本的 block / full fixture 管道；
- Rust library tests 和 ImportDraft 示例；
- 版本、time-flow、import-review、Edge DOM、presentation clock；
- web build 和 Windows NSIS。

真实模型基准只通过手动 `Real PaddleOCR Benchmark` workflow 执行。

当前已达到 2～3 张受控真实学校截图的下一阶段测试条件，但图片必须只留在用户本机、不进入 Git/Artifact/fixture，提交前检查姓名、学号、班级等个人信息，识别结果仍必须人工审阅。尚未达到正式设置页接入、免审保存或多学校支持声明条件。
