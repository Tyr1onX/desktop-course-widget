# 桌面课表

一个面向 Windows 的本地桌面课表组件。它可以导入学校教务系统导出的 `.xlsx` 课表，在桌面显示当天课程，并通过独立设置窗口管理多张课表、课程与作息时间。

> 当前开发版本：`v0.3.0`。最新可下载安装版本为 `v0.3.0`；不同学校的 Excel 格式可能存在差异，欢迎通过 Issue 反馈经过隐私处理的样例结构和报错信息。

## 功能

- 桌面课表组件：显示日期、教学周、当天课程和下一节课程。
- 七日课表视图：在设置窗口中查看星期一至星期日的完整周课表。
- 多课表管理：每次导入生成独立课表，可快速切换、激活、编辑和删除。
- 课表信息编辑：支持修改课表名称、第一教学周星期一和总周数。
- 课程编辑：支持手动新增、修改和删除课程。
- 多时间段课程：同一课程可配置多个上课时间和地点。
- 周次设置：支持连续周、单双周和自定义周次。
- 课程信息：支持教师、地点和课程颜色设置。
- 动态作息：可配置 1～24 节课的开始与结束时间。
- Excel 导入：选择 `.xlsx` 后在本机解析并预览后导入。
- 本地数据：课表和设置仅保存在应用专属目录，不上传到服务器。
- 兼容迁移：旧版单课表数据会自动迁移到多课表目录。
- 系统托盘：显示或隐藏组件、打开课表与设置、切换开机启动和退出程序。
- 单实例、窗口位置恢复、DPI 与多显示器适配。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 下载与安装

1. 打开 [桌面课表 v0.3.0 发布页](https://github.com/Tyr1onX/desktop-course-widget/releases/tag/v0.3.0)。
2. 在页面下方展开 **Assets**。
3. 下载 Windows 安装程序：

   ```text
   桌面课表_0.3.0_x64-setup.exe
   ```

   不需要下载 `Source code (zip)` 或 `Source code (tar.gz)`，它们是源代码压缩包，不能直接安装。
4. 双击安装程序并按照安装界面操作。
5. 当前安装包尚未进行商业代码签名。Windows 可能显示“Windows 已保护你的电脑”或“未知发布者”；确认文件来自本仓库 Release 后，可点击“更多信息”→“仍要运行”。
6. 安装完成后启动“桌面课表”。

从旧版本升级时，安装程序可能先显示旧版卸载界面。请勿勾选 **Delete the application data**，课表和设置数据即可保留。

安装包 SHA256：

```text
4A54A97C9DC0799098D123FFA0BA5AE253FE6557E1E8067968706A62404B99B6
```

需要校验安装包时，可在安装包所在目录打开 PowerShell：

```powershell
Get-FileHash ".\桌面课表_0.3.0_x64-setup.exe" -Algorithm SHA256
```

## 首次使用

1. 在学校教务系统中导出 `.xlsx` 格式的课表。
2. 打开“课表与设置”。
3. 点击左上角当前课表选择器，选择“导入新课表”。
4. 选择 Excel 文件并确认第一教学周星期一的日期。
5. 查看导入预览，按需补充缺失的上课地点。
6. 应用课表后，可在周课表中新增、修改或删除课程。
7. 可在“课表与数据”中编辑课表名称、第一教学周和总周数。
8. 按需调整每节课的开始和结束时间。

关闭桌面组件只会将其隐藏到系统托盘。需要再次显示、打开设置或完全退出时，请右键系统托盘中的课表图标。

## 隐私与数据位置

Excel 文件只在本机解析，不会上传。程序不会主动保留姓名和学号；教师名称是否出现取决于课表内容与解析结果。

Windows 数据目录通常为：

```text
%LOCALAPPDATA%\com.coursewidget.desktop\
```

其中可能包含：

- `schedule.json`：供桌面组件使用的当前课表；
- `settings.json`：作息时间与应用设置；
- `schedules/index.json`：多课表索引和当前课表标记；
- `schedules/*.json`：各张独立课表的数据；
- `backups/`：旧课表备份。

公开反馈截图或样例文件前，请遮住姓名、学号、教师、教室和其他个人信息。更完整的说明见 [PRIVACY.md](PRIVACY.md)。

## 当前限制

- 目前仅支持 Windows。
- 目前只提供 `.xlsx` 的正式导入入口；不同教务系统格式可能需要适配。
- 暂不支持手动调整多张课表的排列顺序。
- 暂不支持课程通知、自动更新和云同步。
- 升级安装流程仍会显示旧版卸载界面。
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
npm run check:version
npm run web:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
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