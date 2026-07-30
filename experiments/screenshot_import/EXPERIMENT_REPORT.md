# 实验执行记录

基础执行环境：Python 3.13.5、OpenCV 4.13.0、NumPy 2.3.5、Pillow 12.2.0、pytest 9.0.2。

## 结果口径

本报告严格区分：

- **fixture pipeline result**：网格和课程块真实运行，OCR token 来自合成样本的 `.ocr.json`；
- **real PaddleOCR result**：真实调用本地 PaddleOCR 模型；
- **grid/block detection result**：只评价结构检测；
- **field parsing result**：只评价确定性字段规则；
- **Rust structural validation result**：只证明输出可被现有 Rust `ImportDraft` 反序列化并通过结构校验。

fixture 结果不是 OCR 准确率，Cargo 编译、模型下载、Paddle 初始化、热推理和调试文件写入也不能合并成一个“单图 OCR 耗时”。

## 课程块边界修复

原逻辑在 `not merge` 后要求 `boundary_strength < 0.12`，但 `not merge` 已意味着强度不低于默认 `0.28`，颜色连续性分支不可达。

现逻辑明确区分：

1. 清晰内部横线：始终分离，不受颜色影响；
2. 缺失横线 + 颜色连续：合并；
3. 弱横线 + 颜色连续：合并并产生复核 warning；
4. 缺失/弱横线 + 颜色差异大：保持分离，并将 warning 同时附加到边界两侧课程块。

复杂合成样本结果：

| 场景 | 结构结果 | warning |
|---|---|---|
| `weak_internal_line_10` | 周二，第 2～4 节，1 个块 | 两条弱横线均提示“依据颜色连续性合并” |
| `similar_adjacent_10` | 周三第 4 节、周三第 5 节，2 个块 | 无错误合并 warning |
| `distinct_missing_boundary_10` | 周四第 6 节、周四第 7 节，2 个块 | 两侧均提示“边界缺失但颜色差异较大” |

课程块 warning 会沿用现有字段解析语义，使 `weekday`、`startSection`、`endSection` 进入 `review`，没有放宽 Rust 校验。

## 网格候选诊断

`grid.json` 新增实验调试字段 `candidateDiagnostics`，分别记录横线和竖线的：

- 原始候选数量；
- 最终选择数量和索引；
- 候选组合数量；
- 最佳与次佳得分；
- 得分差；
- 是否发生筛选；
- 是否存在近似最优歧义；
- 前五个候选方案。

额外竖线不再要求只能选择连续候选窗口，检测器可以跳过中间装饰线。候选发生筛选或得分接近时会产生 warning 并降低置信度；无法唯一确定时明确失败。

| 场景 | 候选结果 | 最终网格 | 置信度 |
|---|---|---|---:|
| `double_border_10` | 竖线 11→9，横线 14→12，竖线差值 0.0225 | 7×10，正确内框 | 0.808934 |
| `title_decoration_10` | 横线 13→12 | 7×10，装饰线未成为表头 | 0.950948 |
| `extra_vertical_10` | 竖线 10→9，跳过索引 2 | 7×10，星期列未偏移 | 0.953927 |

基础结构结果：

- `standard_10`：7×10，网格置信度 `0.984558`，课程块 `5/5`；
- `tilted_12`：7×12，网格置信度 `0.876138`，课程块 `4/4`；横线候选差值 `0.0085`，因此明确保留歧义 warning。

## PaddleOCR 适配器测试

测试通过 fake `paddleocr` 模块实际实例化 `PaddleOcrEngine` 并调用 `recognize()`，覆盖：

- `.json` 字典属性；
- `.json()` 方法；
- `.json`/`.json()` 返回 JSON 字符串；
- `to_dict()`；
- `predict()` 直接返回字典；
- NumPy `rec_texts`、`rec_scores`、二维 `rec_boxes`、多边形 `rec_polys`、`dt_polys`；
- 空数组；
- 文本、分数和框数量不一致；
- 缺少坐标时回退到课程区域；
- crop 坐标加回原图偏移；
- 空文本过滤；
- 不支持类型和推理异常转换为明确 `OcrError`。

适配器不再对任何 Paddle/NumPy 数组执行 `value or []` 或其他真假值判断。

## 真实 PaddleOCR 安装与运行状态

本轮在独立虚拟环境 `/mnt/data/paddleocr-spike-venv` 中执行：

```text
python -m venv /mnt/data/paddleocr-spike-venv
/mnt/data/paddleocr-spike-venv/bin/python -m pip install --index-url https://pypi.org/simple paddlepaddle==3.3.1 paddleocr==3.7.0
/mnt/data/paddleocr-spike-venv/bin/python -m pip install --index-url https://www.paddlepaddle.org.cn/packages/stable/cpu/ paddlepaddle==3.3.1
```

两次均在域名解析阶段连续重试后失败：

```text
Failed to establish a new connection: [Errno -3] Temporary failure in name resolution
ERROR: No matching distribution found for paddlepaddle==3.3.1
```

因此：

- PaddlePaddle/PaddleOCR 未安装；
- 模型下载未发生；
- 没有 Paddle/PaddleX 缓存目录或模型占用空间可报告；
- 未运行真实 `PaddleOcrEngine`；
- 没有真实初始化、冷启动或热推理耗时；
- 不报告真实课程名、周次、教师、地点准确率。

## fixture pipeline result

两张基础合成图继续用于 fixture 端到端链路：

- `standard_10`：真实执行预处理、7×10 网格、5 个课程块、字段规则、ImportDraft V2 输出和 Rust 结构校验；
- `tilted_12`：真实执行倾斜校正、7×12 网格、4 个课程块、字段规则、ImportDraft V2 输出和 Rust 结构校验；
- OCR 文本来自合成 `.ocr.json`，不能作为 PaddleOCR 结果。

流水线现在分别记录预处理、网格、课程块、OCR、字段解析、调试文件写入、Rust 校验和总流程。CI 在 fixture 运行前单独预编译 Rust 示例，避免把首次 Cargo 编译计入 `rustValidationSeconds`。

## 自动化测试

Windows GitHub Actions 已在代码修复 HEAD 上运行 **51 项 Python 测试并全部通过**。覆盖现有图片、解析、ImportDraft、Rust/Windows 编码测试，以及新增的课程块边界、网格装饰线和 PaddleOCR 返回格式回归。

最终 Validate Run、最终 HEAD 和 NSIS artifact 以 Draft PR #72 当前描述为准。
