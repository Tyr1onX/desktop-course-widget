# 真实截图本机测试说明

本说明用于下一阶段的 2～3 张标准网格真实课表截图测试。当前实现仍是独立实验，没有接入正式应用，也不能跳过人工核对。

## 隐私与文件边界

测试前先检查并遮盖姓名、学号、班级、手机号、校园账号或其他个人信息。

- 原图只保存在本机，不提交 Git；
- 原图不加入 fixture，不上传 GitHub Actions Artifact；
- 模型目录、Paddle 缓存和虚拟环境不提交、不上传；
- 样本仅使用 `sample-01`、`sample-02`、`sample-03` 等匿名编号；
- 对外汇总只保留脱敏后的 `report.json` 指标和人工核对结论；
- 所有识别字段仍必须人工核对，不能直接保存为正式课表。

## 1. 创建隔离环境

在仓库根目录执行：

```powershell
py -3.13 -m venv .venv-screenshot-ocr
.\.venv-screenshot-ocr\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r experiments\screenshot_import\requirements.txt
```

锁定环境为 Python 3.13、PaddlePaddle CPU 3.3.1、PaddleOCR 3.7.0。首次 PaddleOCR 运行会将官方模型下载到用户缓存；不要复制或提交该缓存。

## 2. 准备本机目录

示例目录：

```text
.local-screenshot-test/
├─ inputs/
│  ├─ sample-01.png
│  ├─ sample-02.png
│  └─ sample-03.png
└─ outputs/
```

`.local-screenshot-test/` 应保持在 Git 忽略范围外，或确认不会被 `git add`。文件名不要包含学校、姓名、班级或学号。

## 3. 分别运行 block 和 full

以 `sample-01.png` 为例：

```powershell
python -m experiments.screenshot_import recognize `
  --input .local-screenshot-test\inputs\sample-01.png `
  --output .local-screenshot-test\outputs\sample-01-block `
  --engine paddle `
  --ocr-mode block `
  --repo-root .
```

```powershell
python -m experiments.screenshot_import recognize `
  --input .local-screenshot-test\inputs\sample-01.png `
  --output .local-screenshot-test\outputs\sample-01-full `
  --engine paddle `
  --ocr-mode full `
  --assignment-overlap-threshold 0.35 `
  --repo-root .
```

每张截图都必须使用独立输出目录，不要让 block 和 full 相互覆盖。

## 4. 人工核对

逐门课程核对：

- 星期、开始节次、结束节次；
- 课程名称；
- 教师和地点；
- 周次范围；
- 单周、双周或每周；
- 是否出现额外课程、漏课或课程匹配歧义；
- `confirmed` 字段是否真的正确。

重点查看各输出目录中的：

```text
draft.json
report.json
grid.json
ocr.json
overlay.png
```

`report.json` 中的 `fieldEvaluation` 只有提供本机 ground truth 时才会生成；没有 ground truth 时，应另行记录人工核对结果，不能把缺失评估误认为通过。

## 5. 最小汇总格式

每个匿名样本只汇总：

```text
sample-01
- 原图尺寸：
- block 是否成功：
- full 是否成功：
- 实际课程数：
- block 识别课程数：
- full 识别课程数：
- 漏课数：
- unexpected course 数：
- 错误且 confirmed 字段数：
- 单双周错误：
- 需要人工修正的字段：
- block/full 主要差异：
```

保留 block/full 各自的 `report.json` 和人工核对表即可。不要上传原图、模型、缓存、虚拟环境或包含个人信息的 OCR 文本。
