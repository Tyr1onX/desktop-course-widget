# 课刻 v0.5.0-beta.4

## 本版重点

本次 Beta 以性能、安全维护和 Windows 发布稳定性为主，不增加新的产品功能，也不改变截图识别规则。

- 截图课表识别的内部处理更高效，减少了重复的课程卡片分析工作。
- Windows 本地 OCR 的 native runtime / build 链路更稳定。
- 更新存在已知安全问题的 npm 间接依赖，并继续对高危、严重依赖风险阻断发布。
- 安装、覆盖升级、卸载、本地数据保留、OCR 资源打包和正式 exe 启动链路继续经过完整验证。

## 体验与可靠性改进

- OCR parser 复用 ownership filtering 阶段已经生成的 card seeds，不再重复执行同一组昂贵分析；现有 heuristic 和输出规则保持不变。
- synthetic Debug benchmark 从 `63.238s/iter` 降至 `39.235s/iter`，耗时约减少 38%，约为原来的 1.61× 速度。
- Windows MSVC 下继续使用 `ocr-rs 2.4.0`，但让 MNN 走源码构建路径，与 Rust 使用一致的 CRT 模式，消除此前可复现的 native link 冲突。
- Windows Release Build 减少无意义的重复 cold compilation，同时保留 Rust tests、release OCR compile/check、真实 MNN inference、NSIS installer、安装/升级/卸载、package、exe、clean-tree 和 artifacts 等正式 release gates。

## 依赖安全

- `postcss 8.5.22 → 8.5.26`
- `nanoid 3.3.16 → 3.3.18`
- 当前 `npm audit` 为 0 已知漏洞。
- Windows release gate 继续在出现 high / critical 级别 npm audit finding 时阻断发布。

## 升级说明

普通覆盖安装和升级会保留课刻的本地课表与设置数据。卸载器默认也会保留应用数据；只有在明确勾选“删除应用数据”时才会清除对应本地数据。

## 已知限制

- 截图识别仍是 Beta 功能，不熟悉的学校课表样式可能需要手动修正。
- 少数可选地点等字段可能为空，但不会阻断课程导入。
- 建议使用包含完整星期栏、节次和全部课程区域的清晰 PNG/JPG 截图。
- 当前 Windows 安装包尚未进行商业代码签名，系统可能显示未知发布者或 SmartScreen 提示。

## 技术说明

Windows native OCR 的 MSVC 构建已不再出现此前的 `LNK4098` / `LIBCMT` CRT conflict。正式 beta.4 candidate 仍需通过完整 Validate 与 Windows Release Build 后才允许发布。
