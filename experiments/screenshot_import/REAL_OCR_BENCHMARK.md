# Real OCR Benchmark

本文件只保留旧标准网格 `block` / `full` 管道的历史性能基线。它不再代表当前默认 OCR-first 架构，也不能用于证明多学校课表的泛化准确率。

## 历史 canonical 环境

- Windows Server 2025 x64
- Python 3.13.14
- PaddlePaddle CPU 3.3.1
- PaddleOCR 3.7.0
- Run ID：30518750039
- Artifact ID：8750145689

旧结果证明了本地模型安装、缓存复用、Windows CPU 推理、ImportDraft 生成和 Rust 结构校验可以运行；两张合成标准网格样本中的字段结果仅用于旧管道回归。

## 当前解释

- `block`：先定位浅色课程块，再逐块 OCR；
- `full`：先定位标准网格和课程块，再整表 OCR 并分配 token；
- `ocr-first`：当前默认路线，先整图 OCR，再用文字和坐标重建课程。

由于 OCR-first 的输入、调用次数和分组策略已经改变，旧 block/full 耗时与准确率不得直接套用到新架构。新的真实 benchmark 必须使用多种本机脱敏课表，并由人工逐项核对；在此之前不发布新的准确率数字。

## 隐私要求

真实截图、课程名、教师、地点和人工真值不得上传到 GitHub、CI Artifact 或 fixture。报告只能提交匿名课程数、错漏类型、耗时和无隐私诊断。
