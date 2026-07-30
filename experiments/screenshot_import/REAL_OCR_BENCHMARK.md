# Real Windows CPU PaddleOCR canonical benchmark

本报告是 PR #72 截图课表识别实验的**唯一 canonical benchmark**。数据来自仓库运行时生成的 `standard_10` 与 `tilted_12` 两张合成课表，只用于验证 Windows CPU 环境、OCR 架构、字段评估和自动确认安全性；不代表真实学校课表准确率，也未接入正式应用。

## Canonical 回执

- Workflow：`Real PaddleOCR Benchmark`
- Run ID：`30518750039`
- 基准源 HEAD：`5a81930eecc78854c3a628233fa1d7bbc8e041b9`
- Workflow event SHA：`6524f2f127b0811e474d4f5f416b2933420f2881`
- Artifact ID：`8750145689`
- Artifact：`real-paddleocr-benchmark-5a81930eecc78854c3a628233fa1d7bbc8e041b9`
- GitHub artifact digest：`sha256:fd36deab4509304230665a73c3dba618a7f79f1456a3f607d5a7e6205acdbde0`
- 下载 ZIP SHA-256：`fd36deab4509304230665a73c3dba618a7f79f1456a3f607d5a7e6205acdbde0`
- Artifact 大小：`208,772 bytes`
- 生成时间：`2026-07-30T06:23:33.222244+00:00`
- 到期时间：`2026-08-06T06:23:34Z`
- Artifact 状态：未过期

该 Run 完成了环境安装、Rust 校验器预编译、官方模型 bootstrap、16 次真实 OCR 管道、指标合并、报告渲染、canonical 完整性校验和脱敏 Artifact 上传。此前真实 OCR Run 仅保留为历史诊断证据，不再作为性能或环境数据引用来源。

下载后重新审计确认：Artifact 共 75 个脱敏文件，包含唯一 `benchmark.json`、16 份 `report.json`、16 份 `draft.json`、16 份 `ocr.json` 和 16 份 `grid.json`。`benchmark.json` 可解析，覆盖 `standard_10` / `tilted_12`、block / full、每组一次 cold 和三次 hot，共 16 次真实管道。Artifact 不包含 PNG/JPG 图片、模型、缓存、wheel、虚拟环境、安装包或用户数据。

## 实际安装环境

| 项目 | canonical 数据 |
|---|---|
| 操作系统 | Microsoft Windows NT 10.0.26100.0 / Windows Server 2025 |
| 架构 | X64 / AMD64 |
| Python | 3.13.14 |
| pip | 26.2 |
| PaddlePaddle | 3.3.1 |
| PaddleOCR | 3.7.0 |
| Paddle wheel | `paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl` |
| wheel 大小 | 104,794,530 bytes |
| 依赖安装耗时 | 76.481755 s |
| 隔离虚拟环境 | 849,659,311 bytes |
| oneDNN | 关闭 |

Python 3.13 官方 Windows wheel 可直接安装，没有降级到 Python 3.12，也没有使用未知来源 wheel。

## Windows CPU 后端

PaddlePaddle 3.3.1 默认 oneDNN/PIR 路径在前置真实运行中触发过：

```text
ConvertPirAttribute2RuntimeAttribute not support
pir::ArrayAttribute<pir::DoubleAttribute>
```

实验保留锁定版本，通过 `enable_mkldnn=False` 和 `FLAGS_use_mkldnn=0` 使用标准 CPU kernel。canonical Run 中模型 bootstrap 与全部真实推理成功。该设置只属于实验适配层 `WindowsCpuPaddleOcrEngine`，没有进入正式应用。

## 模型、缓存与资源

| 项目 | canonical 数据 |
|---|---:|
| 缓存前占用 | 0 bytes |
| 模型缓存总计 | 139,110,993 bytes |
| `PP-OCRv6_medium_det` | 62,273,512 bytes |
| `PP-OCRv6_medium_rec` | 76,837,481 bytes |
| 观察到的缓存写入 | 48.027835 s |
| 首次初始化（含下载） | 55.541439 s |
| 首次完整预测 | 28.924223 s |
| 初始化后 RSS | 427.402 MB |
| bootstrap 峰值内存 | 492.262 MB |

缓存建立后，将代理指向不可访问的 `127.0.0.1:9` 并启用离线标记，仍可完成初始化与推理：

- 初始化：`1.199096 s`
- token：`37`
- 结果：成功

该结果证明“不可访问代理和离线标记下可复用已有缓存”，不等同于测试了所有物理断网、DNS 隔离或企业网络环境。

## PaddleOCR 3.7.0 真实返回结构

- 顶层类型：`builtins.list`
- 顶层项数：1
- 单项类型：`paddlex.inference.pipelines.ocr.result.OCRResult`
- `.json`：存在，是不可调用的 `builtins.dict` 属性
- `to_dict()`：不可调用
- `rec_texts`：list，长度 37
- `rec_scores`：list，长度 37
- `rec_boxes`：NumPy ndarray，shape `[37, 4]`，dtype `int16`
- `rec_polys`：list，长度 37
- `dt_polys`：list，长度 37

当前适配器的真实结构兼容分支与该返回值一致，同时保留其他兼容路径。

## Block 与 full-image OCR

每个样本、每种模式均执行 1 次冷运行和 3 次热运行，共 16 次完整管道。模型下载与 bootstrap 不计入下表 OCR 时间。

| 样本 | 模式 | predict 调用 | 冷 OCR | 热 OCR 平均 | 冷 pipeline | 热 pipeline 平均 | 值正确/总数 | confirmed/review/missing | unexpected | wrong confirmed rate | 匹配歧义 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | block | 5 | 10.153921 s | 10.969456 s | 17.933786 s | 12.100223 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `standard_10` | full | 1 | 28.367157 s | 27.893194 s | 29.318483 s | 28.807959 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `tilted_12` | block | 4 | 8.409430 s | 8.730079 s | 9.391315 s | 9.768451 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |
| `tilted_12` | full | 1 | 25.954214 s | 26.489778 s | 27.056603 s | 27.532324 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |

在这两张合成图上：

- `standard_10` 的 block 热 OCR 约为 full 的 `2.54×` 更快；
- `tilted_12` 的 block 热 OCR 约为 full 的 `3.03×` 更快；
- block 与 full 的最终字段结果一致；
- 两种模式均未产生额外课程、错误自动确认或匹配歧义。

因此实验默认值继续保持 `block`。该结论不能外推到真实学校布局。

## 字段评估与 missing 语义

评估拆分为两套独立维度：

- `valueAccuracy`：`exactlyCorrect`、`normalizedCorrect`、`wrong`、`valueMissing`；
- `reviewStatus`：`confirmed`、`review`、`missing`。

可选字段真值为空、预测为空时，值可以标准化正确，但证据状态仍可为 missing。兼容字段 `counts.missing` 仅表示 `valueAccuracy.valueMissing`，`counts.statusMissing` 才表示 `reviewStatus.missing`。

| 样本 | 课程 expected/predicted/matched | 完全正确 | 标准化正确 | 错误 | 值缺失 | confirmed | review | 状态 missing | unexpected | wrong confirmed | 歧义 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | 5/5/5 | 39 | 1 | 0 | 0 | 35 | 4 | 1 | 0 | 0 | 0 |
| `tilted_12` | 4/4/4 | 31 | 1 | 0 | 0 | 29 | 2 | 1 | 0 | 0 | 0 |

每种 OCR 模式汇总：

- 课程：9 expected / 9 predicted / 9 matched
- 字段值：70 exact + 2 normalized = 72/72 正确
- confirmed：64
- review：6
- review-status missing：2
- value missing：0
- unexpected course：0
- false-positive course：0
- unexpected confirmed field：0
- unexpected review field：0
- 错误且 confirmed：0
- `autoConfirmationErrors`：0
- `wrongConfirmedRate`：`0 / 64 = 0.0`
- `ambiguousCourseMatches`：0

## unexpected course 规则

没有匹配任何 ground truth 的预测课程不会再被忽略：

1. 整门课程进入 `unexpectedCourses` 和 `falsePositiveCourseCount`；
2. 所有非 missing 字段计入错误；
3. confirmed 字段进入 `autoConfirmationErrors`、`confusion.wrongConfirmed` 和 `wrongConfirmedRate` 分子；
4. review 字段进入 `confusion.wrongReview`；
5. missing 字段单独进入 `unexpectedMissingFieldCount`。

本次两张合成图实际 unexpected course 数为 0，但该错误路径已有独立自动化测试覆盖。

## 课程匹配算法

课程匹配不再按预测遍历顺序执行逐门贪心。当前实现：

1. 根据 weekday、startSection、endSection 与名称相似度建立候选边；
2. 按候选图连通分量执行动态规划全局最大匹配；
3. 对预测课程使用字段指纹稳定排序；
4. 多个同分全局最优方案进入 `ambiguousCourseMatches`；
5. 无法唯一匹配时不会静默宣布唯一正确。

测试覆盖结构正确但 OCR 名称错误、预测顺序变化、贪心局部最优失败场景和同分歧义。

## 单双周安全审计

| 样本 | truth course | expected | actual | review status | classification |
|---|---:|---|---|---|---|
| `standard_10` | 0 | all | all | review | correctReview |
| `standard_10` | 1 | odd | odd | confirmed | correctConfirmed |
| `standard_10` | 2 | even | even | confirmed | correctConfirmed |
| `standard_10` | 3 | all | all | review | correctReview |
| `standard_10` | 4 | all | all | review | correctReview |
| `tilted_12` | 0 | all | all | review | correctReview |
| `tilted_12` | 1 | odd | odd | confirmed | correctConfirmed |
| `tilted_12` | 2 | even | even | confirmed | correctConfirmed |
| `tilted_12` | 3 | all | all | review | correctReview |

所有显式 odd/even 均正确 confirmed；所有没有显式单双周标记的 all 均正确但保守进入 review。没有单双周错误自动确认，也没有因两张合成图结果良好而放宽策略。

## Canonical 完整性门禁

正式工作流在上传 Artifact 前强制验证：

1. `provenance.benchmarkHead` 与实际 checkout 的源 HEAD 一致；
2. 恰好存在 16 次完整运行；
3. 覆盖两张样本、block/full、冷/热组合；
4. 每次运行均包含 `valueAccuracy`、`reviewStatus`、`unexpectedCourseCount` 和 `ambiguousCourseMatches`；
5. 报告渲染、bootstrap 指标合并与 Artifact 上传全部成功。

## 结论与边界

已确认：

- Windows CPython 3.13 官方 wheel 可安装；
- PaddleOCR 3.7.0 在 Windows CPU、oneDNN 关闭时可完成完整基准；
- 模型缓存可在受控网络阻断测试中复用；
- 两张合成样本的结构、字段、单双周和自动确认结果符合预期；
- block 在当前样本上明显快于 full；
- Artifact 的 `benchmark.json`、16 份 `report.json`、本报告和 README 使用同一套 Run `30518750039` 数据。

仍不能声称：

- 已具备多学校真实课表准确率；
- 已覆盖暗色、无网格、严重透视、长截图、多表或复杂真实配色；
- GitHub Hosted Runner 性能代表普通用户电脑；
- 已达到正式应用接入或免审保存条件。

本轮没有运行、上传或分析任何真实学校课表截图，也没有修改正式产品代码。通过外部审计后，功能上已具备邀请用户在本机测试 2～3 张脱敏标准网格截图的条件；所有识别结果仍需人工核对。