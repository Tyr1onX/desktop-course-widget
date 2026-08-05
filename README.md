<div align="center">
  <img src="src-tauri/icons/icon.png" alt="课刻图标" width="112" height="112" />

  <h1>课刻</h1>

  <p><strong>让一天在桌面上缓慢流动。</strong></p>
  <p>从学校教务系统导入课表，在 Windows 桌面查看当前课程、下一节与完整周课表。</p>
  <p><sub>Windows 10 / 11 · 免费开源 · 无需账号 · 数据只保存在本机</sub></p>

  <p>
    <a href="https://github.com/Tyr1onX/desktop-course-widget/releases/latest"><strong>下载 Windows 版</strong></a>
    · <a href="https://tyr1onx.github.io/desktop-course-widget/experience/">产品体验</a>
    · <a href="https://tyr1onx.github.io/desktop-course-widget/guide/getting-started">使用指南</a>
    · <a href="https://github.com/Tyr1onX/desktop-course-widget/issues">反馈问题</a>
  </p>
</div>

---

## 课刻在做什么

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>今天，而不是一整张表</strong><br />
      桌面组件突出当前课程、下一节课程和今天剩余安排，不必反复打开教务系统。
    </td>
    <td width="33%" valign="top">
      <strong>导入后仍然可以修改</strong><br />
      支持编辑课程、周次、地点、教师、颜色和作息，也可以管理多张课表。
    </td>
    <td width="33%" valign="top">
      <strong>本地优先</strong><br />
      无需注册账号。课表文件在本机解析，课程和设置不会上传到服务器。
    </td>
  </tr>
</table>

官网的 [产品体验页](https://tyr1onx.github.io/desktop-course-widget/experience/) 直接运行课刻组件的真实显示逻辑，可以查看一天中不同时间状态下的界面变化。

## 快速开始

1. 前往 [最新 Release](https://github.com/Tyr1onX/desktop-course-widget/releases/latest)，下载名称以 `_x64-setup.exe` 结尾的安装程序。
2. 安装并启动“课刻”，打开“课表与设置”。
3. 从学校教务系统导出 `.xlsx` 课表并导入，确认第一教学周星期一。
4. 检查导入预览，应用后即可在桌面查看当天课程。

> 当前安装包尚未进行商业代码签名。Windows 可能显示“Windows 已保护你的电脑”或“未知发布者”。确认安装包来自本仓库 Release 后，可选择“更多信息”→“仍要运行”。

## 核心功能

- **桌面时间流课表**：显示日期、教学周、当前课程、下一节课程和当天剩余安排。
- **完整周课表**：在独立窗口查看星期一至星期日，并手动新增、修改或删除课程。
- **Excel 导入**：本机解析教务系统导出的 `.xlsx`，预览确认后再写入课表。
- **截图导入**：`main` 开发版已接入 PNG/JPG 课表识别与人工复核流程，将在后续正式版本中提供。
- **多课表管理**：保存不同学期或不同版本的课表，并快速切换当前课表。
- **灵活课程规则**：支持连续周、单双周、自定义周次、多时间段、教师、地点和颜色。
- **动态作息**：可配置 1～24 节课的开始与结束时间。
- **桌面应用能力**：系统托盘、开机启动、单实例、窗口位置恢复、DPI 和多显示器适配。
- **本地数据**：课程、设置和导入文件均不上传，旧版数据可自动迁移并保留备份。

版本变化见 [CHANGELOG.md](CHANGELOG.md)。

## 帮助课刻支持更多学校

不同学校和教务系统导出的课表结构可能不同。遇到无法识别、字段错位或课程缺失时，请提交一份经过隐私处理的反馈：

[提交课表兼容性反馈](https://github.com/Tyr1onX/desktop-course-widget/issues/new?template=school-format.yml)

提交前请遮住或删除姓名、学号、教师、教室以及其他个人信息。只保留能够复现版式或解析问题的最小样例即可。

## 数据与隐私

课表文件只在本机处理。程序不会主动收集或上传课程数据，也不要求登录账号。Windows 数据目录通常为：

```text
%LOCALAPPDATA%\com.coursewidget.desktop\
```

其中可能包含：

- `schedule.json`：桌面组件使用的当前课表；
- `settings.json`：作息时间和应用设置；
- `schedules/index.json`：多课表索引和当前课表标记；
- `schedules/*.json`：各张独立课表的数据；
- `backups/`：数据迁移或覆盖时留下的备份。

完整说明见 [PRIVACY.md](PRIVACY.md)。

## 当前限制

- 目前仅支持 Windows 10 和 Windows 11。
- 最新正式安装版以 `.xlsx` 导入为稳定入口；截图导入目前位于开发版。
- 不同教务系统格式可能需要单独适配。
- 暂不支持课程通知、云同步和应用内自动更新。
- 安装包暂未进行商业代码签名。

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

主要质量检查：

```powershell
npm run check:version
npm run check:time-flow
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

## 开发与贡献

课刻当前处于快速产品迭代阶段。功能范围、缺陷优先级、安全停止条件、版本号、PR、测试、隐私与发布决策统一遵循 [课刻开发与发布规范](docs/DEVELOPMENT_POLICY.md)。

该规范的核心原则是优先持续交付用户可感知的新能力，同时立即处理 P0、修复阻断当前版本的 P1，并避免让 P2、P3 或没有明确风险假设的泛化审计无限阻塞主线。

## 技术栈

Tauri 2 · Rust · Vite · Vanilla TypeScript · HTML / CSS · Calamine

## 开源许可

本项目采用 [MIT License](LICENSE)。
