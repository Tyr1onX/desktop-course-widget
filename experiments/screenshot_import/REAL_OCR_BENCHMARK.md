# Real Windows CPU PaddleOCR canonical benchmark

本报告是 PR #72 截图课表识别实验的**唯一 canonical benchmark**。数据来自仓库运行时生成的 `standard_10` 与 `tilted_12` 两张合成课表，只用于验证 Windows CPU 环境、OCR 架构、字段评估和自动确认安全性；不代表真实学校课表准确率，也未接入正式应用。

## Canonical 回执

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

该 Run 完成了环境安装、Rust 校验器预编译、官方模型 bootstrap、16 次真实 OCR 管道、指标合并、报告渲染、canonical 完整性校验和脱敏 Artifact 上传。此前真实 OCR Run 仅保留为历史诊断证据，不再作为性能或环境数据引用来源。

Artifact 不包含图片像素、模型文件、模型缓存、虚拟环境或用户课表，只包含安装日志、环境摘要、脱敏返回结构以及 JSON/Markdown 报告。

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
| 依赖安装耗时 | 68.105691 s |
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
| 观察到的缓存写入 | 92.946170 s |
| 首次初始化（含下载） | 173.365640 s |
| 首次完整预测 | 29.287120 s |
| 初始化后 RSS | 419.668 MB |
| bootstrap 峰值内存 | 490.047 MB |

缓存建立后，将代理指向不可访问的 `127.0.0.1:9` 并启用离线标记，仍可完成初始化与推理：

- 初始化：`0.994001 s`
- token：`37`
- 结果：成功

该结果证明“网络被阻断且启用离线标记时可复用缓存”，不等同于测试了所有物理断网环境。

## PaddleOCR 3.7.0 真实返回结构

- 顶层类型：`builtins.list`
- 顶层项数：1
- 单项类型：`paddlex.inference.pipelines.ocr.result.OCRResult`
- `.json`：存在，是不可调用的 `dict` 属性
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
| `standard_10` | block | 5 | 10.384034 s | 11.476607 s | 17.679286 s | 12.345182 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `standard_10` | full | 1 | 33.014611 s | 27.757325 s | 33.874143 s | 28.604932 s | 40/40 | 35/4/1 | 0 | 0.0 | 0 |
| `tilted_12` | block | 4 | 8.314605 s | 8.811158 s | 9.218626 s | 9.757986 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |
| `tilted_12` | full | 1 | 26.486853 s | 26.863633 s | 27.470095 s | 27.849931 s | 32/32 | 29/2/1 | 0 | 0.0 | 0 |

在这两张合成图上：

- `standard_10` 的 block 热 OCR 约为 full 的 `2.42×` 更快；
- `tilted_12` 的 block 热 OCR 约为 full 的 `3.05×` 更快；
- block 与 full 的最终字段结果一致；
- 两种模式均未产生额外课程、错误自动确认或匹配歧义。

因此实验默认值继续保持 `block`。该结论不能外推到真实学校布局。

## 字段评估

评估使用连通分量内的全局最大匹配，不依赖预测课程顺序；同分最优方案会进入 `ambiguousCourseMatches`，未匹配预测课程会作为 false positive 进入错误与自动确认统计。

| 样本 | 课程 expected/predicted/matched | 完全正确 | 标准化正确 | 错误 | 值缺失 | confirmed | review | 状态 missing | unexpected | wrong confirmed | 歧义 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | 5/5/5 | 39 | 1 | 0 | 0 | 35 | 4 | 1 | 0 | 0 | 0 |
| `tilted_12` | 4/4/4 | 31 | 1 | 0 | 0 | 29 | 2 | 1 | 0 | 0 | 0 |

两个“标准化正确”字段都是真值为空、预测为 `null` 的可选地点；字段值正确，但证据状态仍为 `missing`。`valueAccuracy` 与 `reviewStatus` 是独立维度，不能把状态缺失误写成字段值错误。

## 单双周安全审计

- 明确 `(单)` / `(双)` 的课程被正确解析为 odd/even，并可按置信度确认；
- 图片来源没有明确单双周标记时，`parity=all` 强制进入 review；
- 周次解析失败或存在结构 warning 时，不因 OCR 高分绕过复核；
- canonical 样本中没有单双周错误自动确认。

两张合成图没有自然产生“单→旦”“双→又”等错误，不能据此推断真实截图发生率。

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
- block 在当前样本上明显快于 full。

仍不能声称：

- 已具备多学校真实课表准确率；
- 已覆盖暗色、无网格、严重透视、长截图、多表或复杂真实配色；
- GitHub Hosted Runner 性能代表普通用户电脑；
- 已达到正式应用接入或免审保存条件。

本轮没有运行、上传或分析任何真实学校课表截图，也没有修改正式产品代码。
