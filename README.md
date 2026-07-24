# 桌面课表

一个面向 Windows 的本地桌面课表组件。它可以导入学校教务系统导出的 `.xlsx` 课表，在桌面显示当天课程，并通过独立设置窗口管理课表与作息时间。

> 当前版本：`v0.1.0` 预发布测试版。不同学校的 Excel 格式可能存在差异，欢迎通过 Issue 反馈经过隐私处理的样例结构和报错信息。

## 功能

- 桌面课表组件：显示日期、教学周、当天课程和下一节课程。
- Excel 导入：选择 `.xlsx` 后在本机解析，确认第一教学周即可应用。
- 导入预览：按教学周查看课程，缺失地点可手动补充，但不会阻止导入。
- 作息设置：逐节调整第 1～10 节的开始和结束时间，修改后自动保存。
- 首次使用引导：全新安装时先打开设置页，导入课表后再显示桌面组件。
- 本地数据：课表和设置保存在应用专属目录，不上传到服务器。
- 安全写入：应用新课表前自动备份旧课表，最多保留 10 份。
- 系统托盘：显示或隐藏组件、打开设置、打开课表位置、切换开机启动和退出程序。
- 单实例、窗口位置恢复、DPI 与多显示器适配。

## 下载与安装

1. 打开 [桌面课表 v0.1.0 发布页](https://github.com/Tyr1onX/desktop-course-widget/releases/tag/v0.1.0)。
2. 在页面下方展开 **Assets**。
3. 下载下面这个 Windows 安装程序：

   ```text
   桌面课表_0.1.0_x64-setup.exe
   ```

   不需要下载 `Source code (zip)` 或 `Source code (tar.gz)`，它们是源代码压缩包，不能直接安装。
4. 双击下载完成的 `.exe` 文件并按照安装界面操作。
5. 当前安装包尚未进行商业代码签名。Windows 可能显示“Windows 已保护你的电脑”或“未知发布者”：确认文件来自本仓库 Release 后，可点击“更多信息”→“仍要运行”。
6. 安装完成后启动“桌面课表”。首次启动会自动打开“课表与设置”。

安装包 SHA256：

```text
11DBC6736EAA5163F6565DB26DD2B4A1805C61C1DE4E1F06402E76BDADA9C114
```

需要校验安装包时，可在安装包所在目录打开 PowerShell：

```powershell
Get-FileHash ".\桌面课表_0.1.0_x64-setup.exe" -Algorithm SHA256
```

## 首次使用

1. 在学校教务系统中导出 `.xlsx` 格式的课表。
2. 打开“课表与设置”，点击选择 Excel 文件。
3. 确认第一教学周星期一的日期。
4. 查看导入预览，并按需补充缺失的上课地点。
5. 点击“直接应用课表”。
6. 按需调整第 1～10 节的开始和结束时间，修改会自动保存。

关闭桌面组件只会将其隐藏到系统托盘。需要再次显示、打开设置或完全退出时，请右键系统托盘中的课表图标。

## 隐私与数据位置

Excel 文件只在本机解析，不会上传。程序不会保留姓名和学号；教师名称是否出现取决于课表内容与解析结果。

Windows 数据目录通常为：

```text
%LOCALAPPDATA%\com.coursewidget.desktop\
```

其中包含：

- `schedule.json`：当前课表；
- `settings.json`：作息与首次使用状态；
- `backups/`：旧课表备份，最多 10 份。

公开反馈截图前，请遮住姓名、学号、教师、教室和其他个人信息。更完整的说明见 [PRIVACY.md](PRIVACY.md)。

## 当前限制

- 目前仅支持 Windows。
- 目前只提供 `.xlsx` 的正式导入入口；不同教务系统格式可能需要适配。
- 暂不支持在设置页中手动新增、删除或批量编辑课程。
- 暂不支持课程通知、自动更新和云同步。
- 安装包暂未进行商业代码签名，Windows 可能显示来源未知提示。

## 本地开发

需要 Node.js、Rust、Windows WebView2 与 MSVC C++ 构建工具。

```powershell
npm install
npm run tauri:dev
```

浏览器界面调试：

```powershell
npm run web:dev
```

质量检查：

```powershell
npm run web:build
cd src-tauri
cargo test --lib
```

生成 Windows NSIS 安装包：

```powershell
npm run tauri:build
```

安装包通常输出到：

```text
src-tauri\target\release\bundle\nsis\
```

## 技术栈

- Tauri 2
- Rust
- Vite
- Vanilla TypeScript
- HTML / CSS
- Calamine（XLSX 解析）

## 开源许可

本项目采用 [MIT License](LICENSE)。