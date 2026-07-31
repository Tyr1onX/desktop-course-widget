# 课表截图 OCR-first 识别实验

这是 Issue #52 的独立技术实验。当前主流程不再要求先识别完整网格或彩色课程块，而是先在本地执行整图 OCR，保留每段文字及坐标，再根据星期、节次、教学周等文字锚点与空间关系重建课程。

本目录仍未接入正式应用，不提供设置页、图片选择器或剪贴板入口，也不会把 Python、PaddleOCR 和模型打包进安装程序。

## 当前架构

```text
图片预处理
→ 整图本地 OCR（文字 + 坐标）
→ 定位星期表头和节次标签，缩小到主课表范围
→ 从“星期 / 周 / 第X节 / 第X-X周”等文字中提取课程锚点
→ 将同一空间区域内的课程名、教师、周次和地点组成课程记录
→ 网格线、背景颜色和课程块仅作为辅助或回退证据
→ 生成 ImportDraft V2
→ Rust 结构校验与人工复核
```

关键原则：

- OCR 必须先运行；网格或颜色检测失败不能直接阻止 OCR。
- 星期、节次优先从课程文字解析，缺失时才根据坐标或可用网格推断。
- 彩色卡片和黑白合并表格共用同一条 OCR-first 主流程，不建立学校模板分支。
- 顶部导航、学生信息和底部实验/调停课附表通过主课表范围定位排除。
- `block` / `full` 仍保留为旧标准网格实验和回归基线，不再是默认产品方向。

详细设计见 [`OCR_FIRST_ARCHITECTURE.md`](./OCR_FIRST_ARCHITECTURE.md)。

## 模块职责

- `preprocess.py`：EXIF、缩放、灰度、二值化、轻度纠偏和坐标变换。
- `ocr.py` / `paddle_cpu.py`：本地 PaddleOCR 与 Windows CPU 适配。
- `ocr_first.py`：星期表头、节次标签、课程时间锚点和空间分组。
- `ocr_first_fields.py`：组合时间文本、完整地点表达和字段证据修正。
- `ocr_first_pipeline.py`：新的默认识别管道。
- `ocr_first_output.py`：draft、结构诊断、OCR token、overlay 和 report 输出。
- `grid.py` / `blocks.py`：旧标准网格逻辑；现在只作为辅助和回退。
- `parse_fields.py`：旧字段解析基线。
- `draft.py`：映射到 `ImportDraft V2`。
- `rust_validate.py`：复用 Rust 类型与结构校验。

## 依赖

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

输入图片只在本机处理，不调用云端 OCR API。首次运行时 PaddleOCR 会下载模型到用户缓存。

## 运行

默认 OCR-first：

```powershell
python -m experiments.screenshot_import recognize `
  --input path\to\timetable.png `
  --output output\ocr-first `
  --engine paddle `
  --repo-root .
```

也可显式指定：

```powershell
--ocr-mode ocr-first
```

旧标准网格回归模式：

```powershell
--ocr-mode block
--ocr-mode full
```

这些旧模式仍会先检测网格和浅色课程块，不能代表通用识别能力。

## 输出

- `draft.json`：`ImportDraft V2` 草稿；
- `grid.json`：OCR-first 主课表范围、文字锚点、可选网格辅助和课程区域；
- `ocr.json`：整图 OCR token、坐标和置信度；
- `overlay.png`：主表范围与课程记录调试图；
- `report.json`：策略、课程数、字段状态、耗时和 Rust 校验结果。

## 验证范围

现有两张合成标准网格样本和旧 benchmark 继续用于回归，但不能证明多学校泛化能力。新的 OCR-first 测试覆盖两种核心表达：

- 彩色课表中的 `第3-8周, 星期1, 第1节-第2节`；
- 黑白教务表中的 `周三第3,4节（第1-17周）`。

真实学校截图必须留在用户本机，仅提交匿名统计和人工核对结论。不得把姓名、学号、班级、课程截图或本地 ground truth 提交到 Git、CI Artifact 或测试 fixture。

两张本机真实样本已完成一次人工核对：彩色课表识别出 14 门课程；黑白教务长截图识别出 17 门课程。两者的主课表范围与课程空间分组均通过核对，黑白长截图未纳入底部附表。该结果只证明 OCR-first 可在这两种已核对版式上完成受控实验，不构成多学校准确率或免审保存承诺。

黑白长截图中的部分周次、单双周、课程名和教师字段仍保留 `review`，必须结合原图确认。

## 当前限制

- OCR-first 依赖课程区域中至少存在可解析的星期或节次文字；完全不写时间的卡片仍需网格辅助。
- 主课表范围定位目前依赖至少四个同一行的星期表头；无法定位时会退回显式时间文字解析。
- 字段内容正确性仍需人工复核；Rust 校验只证明结构合法，不证明文字与原图一致。
- 已完成两张真实样本的本机受控验证，但尚未覆盖多学校或所有教务系统版式；不得据此接入正式软件或宣称可免审保存。
