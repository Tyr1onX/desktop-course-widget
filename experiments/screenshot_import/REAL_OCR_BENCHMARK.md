# Real Windows CPU PaddleOCR benchmark

本报告记录截图课表识别实验在真实 Windows x86-64 CPU 环境中的 PaddleOCR 基准结果。结果仅来自仓库运行时生成的 `standard_10` 与 `tilted_12` 两张合成图，不代表真实学校课表的最终准确率，也没有接入正式应用。

## 可复现执行

- GitHub Actions Run：`30512843362`
- 运行 HEAD：`a577c1687cff2f971fef59f6409bb50b09837d5a`
- Artifact ID：`8747962023`
- Artifact：`real-paddleocr-mkldnn-safe-v2-a577c1687cff2f971fef59f6409bb50b09837d5a`
- Artifact SHA-256：`6b2509b86857b70f09556e062b9c131e66374c8a8a325142ecf712ce0123b3f0`
- 运行日期：2026-07-30
- 结果：安装、Rust 预编译、模型 bootstrap、16 次真实 OCR 管道、指标合并和脱敏 Artifact 上传全部成功。

Artifact 不包含合成图片、模型文件、模型缓存、虚拟环境或任何用户课表，只包含安装日志、环境摘要、脱敏返回结构、JSON 报告和文本报告。

## 实际安装环境

| 项目 | 实际值 |
|---|---|
| 操作系统 | Microsoft Windows Server 2025，10.0.26100，x64 |
| Python | 3.13.14，CPython，64-bit AMD64 |
| pip | 26.2 |
| PaddlePaddle | 3.3.1 |
| PaddleOCR | 3.7.0 |
| 安装源 | `https://pypi.org/simple` |
| Paddle wheel | `paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl` |
| wheel tag | `cp313-cp313-win_amd64` |
| wheel 大小 | 104,794,530 bytes |
| 安装耗时 | 71.4094694 s |
| 虚拟环境占用 | 849,741,223 bytes |

实际安装命令等价于：

```powershell
python -m venv <isolated-venv>
python -m pip download --no-deps --only-binary=:all: --index-url https://pypi.org/simple paddlepaddle==3.3.1
python -m pip install --no-cache-dir paddlepaddle-3.3.1-cp313-cp313-win_amd64.whl
python -m pip install --no-cache-dir --index-url https://pypi.org/simple paddleocr==3.7.0 psutil
```

Python 3.13 的官方 Windows wheel 可正常下载和安装，因此没有降级到 Python 3.12。

## Windows CPU 后端审计

目标版本首次真实推理时，PaddlePaddle 3.3.1 的 oneDNN/PIR 路径实际触发：

```text
ConvertPirAttribute2RuntimeAttribute not support
pir::ArrayAttribute<pir::DoubleAttribute>
```

这发生在模型已下载并完成构造之后，不是 DNS、TLS、代理、wheel 缺失或 Python 3.13 不兼容。实验保留锁定版本，通过 `enable_mkldnn=False` 和 `FLAGS_use_mkldnn=0` 选择标准 CPU kernel；之后模型 bootstrap 和全部真实推理成功。

正式应用尚未打包 PaddleOCR。该设置目前只属于实验适配层 `WindowsCpuPaddleOcrEngine`。

## 模型下载与缓存

| 项目 | 实际值 |
|---|---:|
| 模型缓存目录 | `C:\Users\runneradmin\.paddlex` |
| 总缓存占用 | 139,110,993 bytes |
| `PP-OCRv6_medium_det` | 62,273,512 bytes |
| `PP-OCRv6_medium_rec` | 76,837,481 bytes |
| 观察到的缓存写入开始 | 2026-07-30T04:09:25.244889+00:00 |
| 观察到的缓存写入结束 | 2026-07-30T04:09:49.217335+00:00 |
| 模型缓存写入耗时 | 23.9724856 s |
| 首次初始化总耗时 | 57.9035817 s |
| 初始化后 RSS | 427.258 MB |
| bootstrap 峰值内存 | 498.188 MB |
| 首次全图 predict | 28.8927381 s |
| 首次全图 token 数 | 37 |

下载时间与后续 OCR 推理时间分开记录。缓存完成后，将 `HTTP_PROXY`、`HTTPS_PROXY` 和 `ALL_PROXY` 指向不可访问的 `127.0.0.1:9`，并启用离线标记，仍可成功初始化和推理：

- 离线初始化：`1.1163202 s`
- 离线 token 数：`37`
- 结果：成功

## PaddleOCR 3.7.0 真实返回结构

实际调用：

```python
PaddleOCR(...).predict(...)
```

脱敏结构摘要：

| 项目 | 实际结构 |
|---|---|
| Python 返回类型 | `builtins.list` |
| 顶层容器 | `list` |
| 顶层项数 | 1 |
| 每项类型 | `paddlex.inference.pipelines.ocr.result.OCRResult` |
| `.json` | 存在，是 `dict` 属性，不可调用 |
| `.json()` | 不适用 |
| `to_dict()` | 不存在 |
| `rec_texts` | `list`，长度 37 |
| `rec_scores` | `list`，长度 37 |
| `rec_boxes` | `numpy.ndarray`，shape `[37, 4]`，dtype `int16` |
| `rec_polys` | `list`，长度 37 |
| `dt_polys` | `list`，长度 37 |

`OCRResult` 同时具有字典式 `get`、`items`、`keys`、`values`，以及 `save_to_json`、`save_to_img` 等公开方法。当前适配器的 `.json` 字典属性、NumPy 数组与 list 兼容分支与真实结构一致，原有 `.json()`、JSON 字符串、`to_dict()` 和直接字典兼容分支继续保留。

## OCR 架构对比

以下“冷启动”指模型已经下载、引擎已经构造后的该组第一次管道运行；模型下载和首次 bootstrap 不计入 OCR 推理时间。每组随后连续执行三次热运行。

| 样本 | 模式 | 课程块 | predict 次数 | 冷 OCR | 三次热 OCR 平均 | 冷管道 | 三次热管道平均 | 峰值内存范围 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `standard_10` | block | 5 | 5 | 10.402373 s | 10.083595 s | 20.170548 s | 10.935031 s | 662.684–684.094 MB |
| `standard_10` | full | 5 | 1 | 26.631320 s | 29.804321 s | 27.465793 s | 30.660159 s | 721.957–865.809 MB |
| `tilted_12` | block | 4 | 4 | 8.516407 s | 8.016003 s | 9.474955 s | 8.971746 s | 716.406–746.734 MB |
| `tilted_12` | full | 4 | 1 | 25.505942 s | 26.203480 s | 26.514705 s | 27.420503 s | 808.988–837.422 MB |

### 性能结论

- `standard_10`：block 热 OCR 比 full 快约 `2.96×`。
- `tilted_12`：block 热 OCR 比 full 快约 `3.27×`。
- full 模式虽然只调用一次 `predict`，但完整大图的检测与识别成本远高于多个小裁剪。
- full 模式还观察到更高的峰值内存。
- 在当前两张合成图上，两种模式的最终字段结果完全一致。

因此实验默认值继续保持 `block`。`full` 保留用于比较、调试，以及未来在不同真实布局上验证 token 分配策略；本轮不把它提升为产品默认方案。

## 全图 token 分配规则

1. token 中心点只位于一个课程块时，分配给该块；
2. 中心点不位于任何块时，计算 token 与各课程块的重叠比例；
3. 达到 `--assignment-overlap-threshold` 才分配；
4. 同时命中多个课程块时记为歧义，不静默复制；
5. 不属于任何课程块的表头、节次等 token 留在 `ocr.json.assignment.unassigned`，不进入课程字段。

本轮 full 模式在两张样本上正确排除了星期表头和节次数字，课程字段结构与 block 模式一致。

## `standard_10` 逐字段评估

- 课程块：预期 5，识别 5
- 字段总数：40
- 完全正确：39
- 标准化后正确：1（真值为空字符串、结果为空值的可选地点）
- 错误：0
- 字段状态：confirmed 35、review 4、missing 1
- 错误且 confirmed：0
- 错误自动确认率：0

| 课程 | 结构 | 名称 | 教师 | 地点 | 周次 | 单双周 | 结果 |
|---|---|---|---|---|---|---|---|
| 通信原理 | 周一 1–2 节 | 正确 | 张老师，正确 | A101，正确 | 1–8，正确 | all，正确但 review | 通过 |
| 信息论 | 周三 3–4 节 | 正确 | 李明，正确但 review | 逸夫楼203，正确 | 1–15，正确 | odd，confirmed | 通过 |
| 数字信号处理 | 周五 5–6 节 | 正确 | 王老师，正确 | 可选地点缺失 | 1–16，正确 | even，confirmed | 通过 |
| 计算机网络 | 周二 7–8 节 | 正确 | 赵老师，正确 | B204，正确 | 1–8、10–16，正确 | all，正确但 review | 通过 |
| 电磁场 | 周二 9–10 节 | 正确 | 陈老师，正确 | 实验楼301，正确 | 1–12，正确 | all，正确但 review | 通过 |

教师“李明”没有“老师”后缀，按现有规则保守进入 review；值本身正确。

## `tilted_12` 逐字段评估

- 课程块：预期 4，识别 4
- 字段总数：32
- 完全正确：31
- 标准化后正确：1（可选地点为空）
- 错误：0
- 字段状态：confirmed 29、review 2、missing 1
- 错误且 confirmed：0
- 错误自动确认率：0

| 课程 | 结构 | 名称 | 教师 | 地点 | 周次 | 单双周 | 结果 |
|---|---|---|---|---|---|---|---|
| 高频电子技术 | 周四 2–4 节 | 正确 | 刘老师，正确 | 教学楼C302，正确 | 1–8，正确 | all，正确但 review | 通过 |
| 单片机原理 | 周六 6–8 节 | 正确 | 周老师，正确 | 逸夫楼405，正确 | 1–15，正确 | odd，confirmed | 通过 |
| 数字电路 | 周日 9–10 节 | 正确 | 孙老师，正确 | D101，正确 | 2–16，正确 | even，confirmed | 通过 |
| 通信与网络 | 周一 11–12 节 | 正确 | 吴老师，正确 | 可选地点缺失 | 1–16，正确 | all，正确但 review | 通过 |

## confirmed / review / missing 汇总

每种 OCR 架构的最终汇总相同：

- confirmed：64
- review：6
- missing：2
- 正确且 confirmed：64
- 错误且 confirmed：0
- 正确但 review：6
- 错误且 review：0
- missing：2 个可选地点
- 错误自动确认率：`0 / 64 = 0`

该结果只说明两张合成图没有产生错误自动确认，不能用来宣布真实学校课表的最终阈值。

## 单双周风险审计

真实 OCR 正确识别并解析：

- `1-15周(单)` → odd
- `1-16周(双)` → even
- `2-16周(双)` → even
- `1-8周`、`1-12周`、`1-16周` → all

安全策略已经调整：

- 图片来源存在明确“单/双”标记且解析成功时，按 OCR 分数和其他 warning 判断；
- 图片来源未识别到明确单双周标记时，`parity=all` 强制进入 review，即使 OCR 置信度很高；
- 周次解析错误时，weeks 与 parity 都进入 review；
- 结构 warning 始终覆盖 OCR 高分。

本轮所有显式 odd/even 字段均正确 confirmed；所有 all 字段均正确但进入 review。没有发现单双周错误自动确认。

测试还覆盖标记缺失、括号变化、无效周次和 parity 缺失不会被静默确认。两张合成图没有自然产生“单→旦”“双→又”等错误，因此不能据此判断真实截图上的发生率。

## 自动确认策略结论

- 保留 `high-confidence=0.90`、`review-confidence=0.55` 作为实验默认值，不把两张合成图当作最终产品阈值证据；
- 保留图片来源 `parity=all` 强制 review；
- 保留裸教师姓名 review；
- 教师、地点允许 missing；
- 课程名称、周次、单双周和结构 warning 不因 OCR 高分而绕过复核；
- 未发现需要放宽规则的证据。

## 下一阶段条件

已经达到邀请用户进行少量真实截图测试的技术条件，但仅限受控实验：

- 先使用 2～3 张标准网格课表；
- 图片只保存在用户本机；
- 不提交 Git、不进入 Artifact、不加入 fixture；
- 报告仅使用匿名编号；
- 提供前先检查姓名、学号、班级和其他个人信息；
- 仍要求所有识别结果经过人工审阅。

尚未达到正式应用接入、免审保存或“支持多学校课表”的条件。
