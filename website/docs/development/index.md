# 本地开发

桌面课表由 Tauri、Rust、Vite 和 Vanilla TypeScript 构建。网站文档使用 VitePress，并放在独立的 `website/` 目录中。

## 运行桌面应用

需要安装 Node.js、Rust、Windows WebView2 和 MSVC C++ 构建工具。

```powershell
npm install
npm run tauri:dev
```

只调试浏览器界面时：

```powershell
npm run web:dev
```

## 运行文档网站

```powershell
cd website
npm install
npm run docs:dev
```

构建静态网站：

```powershell
npm run docs:build
```

构建结果位于：

```text
website/docs/.vitepress/dist/
```

## 部署方式

合并到 `main` 后，GitHub Actions 会构建 VitePress 网站并部署到 GitHub Pages。仓库需要在 **Settings → Pages → Build and deployment** 中将 Source 设置为 **GitHub Actions**。

预期地址：

```text
https://tyr1onx.github.io/desktop-course-widget/
```

## 贡献

提交问题或改进前，可以先查看现有的 [Issues](https://github.com/Tyr1onX/desktop-course-widget/issues)。涉及课表文件时，请先移除姓名、学号、教师、教室等个人信息。
