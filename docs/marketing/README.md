# 课刻宣传素材规范

本目录记录课刻对外展示时的统一信息和素材规格，避免每次发布重新设计。

## 核心定位

主标题：

> 把学校教务系统里的课表，放回 Windows 桌面。

辅助说明：

> 当前课程、下一节与完整周课表，抬眼就能看见。无需账号，课表数据只保存在本机。

技术说明只作为补充：

> A local-first Windows timetable and course schedule desktop widget built with Tauri, Rust and TypeScript.

## 15 秒演示脚本

1. **0–3 秒：今天的课程**
   - 展示桌面组件初始状态。
   - 画面中同时出现日期、教学周和今天课程数量。
2. **3–8 秒：正在上课**
   - 使用演示模式推进时间。
   - 当前课程成为视觉中心，进度条和剩余时间自然变化。
3. **8–11 秒：课程交接**
   - 当前课程结束，下一节课程上移。
   - 保留完整动画，不进行剪辑拼接。
4. **11–13 秒：完整周课表**
   - 打开课表与设置，短暂展示完整周课表。
5. **13–15 秒：下载引导**
   - 文案：`免费下载 · Windows 10 / 11 · 数据仅存本机`
   - 结尾保留课刻图标和仓库地址。

## 导出规格

| 用途 | 比例与建议尺寸 | 建议时长 | 格式 |
| --- | --- | --- | --- |
| GitHub README | 16:9，960×540 或 1280×720 | 8–15 秒 | 优先 MP4 链接或经过压缩的 GIF |
| B站 | 16:9，1920×1080 | 30–90 秒 | MP4 |
| 小红书 / 短视频 | 9:16，1080×1920 | 15–30 秒 | MP4 |
| GitHub 社交预览 | 2:1，1280×640 | 静态 | PNG |

静态设计源文件位于：

```text
website/docs/public/social-preview.svg
```

GitHub 仓库的 Social preview 建议从该 SVG 导出为 `1280×640` PNG 后上传。

## 发布标题模板

- `把教务系统 Excel 变成 Windows 桌面课表，我做了一个免费的开源工具`
- `不用反复打开教务系统：课刻把今天的课程留在桌面上`
- `Windows 也可以有一个真正跟着时间变化的桌面课表`
- `课表截图也能导入：课刻的新识别与人工复核流程`

## 隐私检查

发布任何截图、GIF、视频或样例文件前，必须确认：

- 不包含真实姓名和学号；
- 不包含不应公开的教师、班级或联系方式；
- 教室和课程信息已经替换为演示数据；
- 浏览器、文件路径、通知和系统托盘中没有其他私人信息；
- 样例只保留复现兼容性问题所需的最小内容。

## GitHub 仓库设置

推荐 Topics：

```text
timetable
course-schedule
desktop-widget
windows
tauri
rust
typescript
xlsx
student-tools
productivity
offline-first
```

推荐 About 描述：

```text
Windows 本地桌面课表，支持 Excel 导入、截图识别、完整周课表和系统托盘，数据仅保存在本机。
```

推荐 Website：

```text
https://tyr1onx.github.io/desktop-course-widget/
```
